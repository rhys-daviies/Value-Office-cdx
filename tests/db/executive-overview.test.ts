import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { firstNeedingAttention, todayIso, type AttentionItem } from "@/domain/attention";
import { formatDate } from "@/ui/format";
import { CANONICAL } from "@/fixtures/canonical";
import { seedCompactEvolution, seedCompactTrajectory, seedCompactTrajectoryDraft } from "@/fixtures/compact";
import { createReview, finaliseReview, upsertValuePositions } from "@/server/commands/assurance";
import { recordEvidence } from "@/server/commands/evidence";
import { issueRecommendation, saveRecommendation, upsertScenario } from "@/server/commands/options";
import { setPlanPoint, setVersionBasis } from "@/server/commands/trajectory";
import { authoriseInitialVersion, proposeVersion } from "@/server/commands/value-case";
import { db, schema } from "@/server/db/client";
import { getExecutiveOverview, type ExecutiveOverview } from "@/server/queries/overview";
import { ValueAttention } from "@/ui/overview/attention";
import { LatestValueDecision } from "@/ui/overview/decision";
import { ExecutivePosition } from "@/ui/overview/position";
import { ValueCaseSummary } from "@/ui/value-case/summary";

import { newActor, uid } from "../support/fixtures";

// Phase 4D.9I: the executive Overview composition and its states. Today is injected for determinism.

const TODAY = "2027-03-15";
const strip = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
const render = (o: ExecutiveOverview) =>
  strip(
    renderToStaticMarkup(
      createElement("div", null, [
        o.authorised ? createElement(ExecutivePosition, { key: "p", o, base: "/p" }) : null,
        createElement(ValueAttention, { key: "a", o, base: "/p" }),
        createElement(LatestValueDecision, { key: "d", o, base: "/p" }),
        createElement(ValueCaseSummary, { key: "s", summary: o.valueCase, base: "/p" }),
      ]),
    ),
  );

/** Authorised V1 ($30m) on a cumulative basis; optional plan; optional finalised review with options. */
async function authorisedProject(opts: { plan?: boolean; review?: "none" | "recommended" } = {}) {
  const actor = await newActor();
  const d = await seedCompactTrajectoryDraft(actor, { code: `EO-${uid()}`, name: "Executive states" });
  await setVersionBasis(actor, {
    versionId: d.v1.id,
    valueBasisKind: "cumulative_benefit",
    valuePeriodStart: "2026-01-01",
    valuePeriodEnd: "2028-12-31",
  });
  if (opts.plan) await setPlanPoint(actor, { versionId: d.v1.id, asOf: "2028-12-31", value: "30000000.00" });
  await proposeVersion(actor, { versionId: d.v1.id });
  const ev = await recordEvidence(actor, { projectId: d.project.id, code: "E-1", title: "Authorisation" });
  await authoriseInitialVersion(actor, {
    versionId: d.v1.id,
    authorisedByPersonId: d.vco.id,
    authorisedOn: "2026-01-15",
    authorisationEvidenceId: ev.id,
  });
  if (opts.review === "recommended") {
    const drivers = await db().select().from(schema.valueDriver).where(eq(schema.valueDriver.projectId, d.project.id));
    const r = await createReview(actor, { projectId: d.project.id, trigger: "ad_hoc", reviewDate: "2026-09-30" });
    await upsertValuePositions(actor, {
      reviewId: r.id,
      positions: drivers.map((x, i) => ({
        forecastRationale: "Synthetic test rationale",
        valueDriverId: x.id,
        currentForecast: i === 0 ? "19000000.00" : "9000000.00",
        realisedValue: "500000.00",
      })),
    });
    const s = await upsertScenario(actor, {
      reviewId: r.id,
      label: "Act now",
      kind: "recommended",
      totalValue: "29000000.00",
    });
    await saveRecommendation(actor, { reviewId: r.id, scenarioId: s.id, narrative: "Act" });
    await issueRecommendation(actor, { reviewId: r.id });
    await finaliseReview(actor, { reviewId: r.id });
  }
  return d;
}

describe("attention selection rule (existing conditions, no materiality score)", () => {
  const m = (code: string, kinds: AttentionItem["kind"][]) => ({
    code,
    attention: kinds.map((kind) => ({ kind, label: kind })),
    needsAttention: kinds.some((k) => k !== "unquantified"),
  });
  it("picks the most pressing existing condition first, ties by the given (code) order, ignores unquantified-only", () => {
    expect(firstNeedingAttention([m("VL-1", ["awaiting_evidence"]), m("VL-2", ["escalated"])])!.code).toBe("VL-2");
    expect(firstNeedingAttention([m("VL-1", ["no_owner"]), m("VL-2", ["no_owner"])])!.code).toBe("VL-1");
    expect(firstNeedingAttention([m("VL-1", ["unquantified"])])).toBeNull();
    expect(
      firstNeedingAttention([m("VL-1", ["unquantified", "monitor_ending"]), m("VL-2", ["decision_overdue"])])!.code,
    ).toBe("VL-2");
  });
});

describe("executive Overview", () => {
  it("1/2/7/8/10/13/14. canonical: position with as-at date, the matter needing attention, the decision, the summary", async () => {
    const actor = await newActor();
    const x = await seedCompactTrajectory(actor, { code: `TX-${uid()}`, name: "Trajectory Executive", formal: true });
    const o = await getExecutiveOverview(x.project.id, TODAY);
    expect(o.authorised).toEqual({ versionNumber: 1, total: "30000000.00" });
    expect(o.formal).toMatchObject({ sequence: 2, date: "2026-09-30", againstVersionNumber: 1 });
    expect(o.formal!.totals).toMatchObject({
      forecastTotal: "26000000.00",
      realisedTotal: "4000000.00",
      valueGap: "4000000.00",
    });
    expect(o.attention).toMatchObject({
      openCount: 1,
      needsAttentionCount: 1,
      matter: {
        code: "VL-001",
        title: "Vendor sequencing risk",
        ownerName: "Test Delivery Lead",
        drivers: [{ code: "VD-01", name: "Procurement Savings" }],
        conditions: [{ kind: "escalated", label: "Escalated — decision required" }],
        formal: {
          reviewSequence: 2,
          amounts: { total: "700000.00", recoverable: "450000.00", unrecoverable: "250000.00" },
        },
        working: null,
      },
    });
    expect(o.decision.recorded!.differenceFromRecommendation).toBe("-2000000.00");
    expect(o.decision.awaiting).toBeNull();
    expect(o.trajectory.status).toBe("ready"); // 6. Today stays distinct on the chart (4D.9E/F tests)
    expect(o.trajectory.today.asOf).not.toBe(o.trajectory.latestFormal!.reviewDate);

    const text = render(o);
    expect(text).toContain("Formal position as at 30 Sept 2026 · Review #2");
    expect(text).toMatch(/Authorised Value \$30\.0m Authorised V1 Realised \$4\.0m Formal Forecast \$26\.0m/);
    expect(text).toContain("Value Gap $4.0m Authorised − Formal Forecast");
    expect(text).toContain("Vendor sequencing risk VL-001 · VD-01 Procurement Savings Escalated — decision required");
    expect(text).toContain("Total Value Leakage $700,000 Recoverable $450,000 Unrecoverable $250,000");
    expect(text).toContain("is not the Value Gap"); // 8. Value Leakage is distinct from the gap
    expect(text).toContain("Cardaxia recommendation Act now · $29.0m");
    expect(text).toContain("Management selected Delay 3 months · $27.0m");
    expect(text).toContain("Difference -$2.0m");
    expect(text).toContain(`Decision ${formatDate(CANONICAL.journeyDate)} · Test VCO`); // fixed governance date (4D.9N.1C)
    expect(text).toContain("View Value Case history →");
  });

  it("3/9/12/21. authorised V1 without reviews or phasing: commitment only, nothing invented", async () => {
    const d = await authorisedProject();
    const o = await getExecutiveOverview(d.project.id, TODAY);
    expect(o).toMatchObject({
      formal: null,
      decision: { recorded: null, awaiting: null },
      attention: { openCount: 0, matter: null },
    });
    expect(o.trajectory.status).toBe("phasing_not_entered");
    const text = render(o);
    expect(text).toContain("No formal Assurance position yet.");
    expect(text).not.toMatch(/Realised|Formal Forecast|Value Gap/);
    expect(text).toContain("No active Value Assurance matters requiring attention.");
    expect(text).not.toMatch(/value decision/i); // nothing to say before a formal review
    expect(text).toContain("Authorised Value Changes 0 None"); // 19. no Value Changes
  });

  it("11/13. recommendation issued but no decision: awaiting decision, no difference", async () => {
    const d = await authorisedProject({ plan: true, review: "recommended" });
    const o = await getExecutiveOverview(d.project.id, TODAY);
    expect(o.decision.recorded).toBeNull(); // a recommendation is not a recorded management decision
    expect(o.decision.awaiting!.recommendation).not.toBeNull();
    expect(o.decision.awaiting!.differenceFromRecommendation).toBeNull();
    const text = render(o);
    expect(text).toContain("Recommendation awaiting management decision");
    expect(text).not.toContain("Latest recorded value decision");
    expect(text).toContain("Cardaxia recommendation Act now · $29.0m");
    expect(text).toContain("Management selected Awaiting management decision");
    expect(text).not.toContain("Difference");
  });

  it("4D.9L. a later review's recommendation awaiting decision does not displace or become the recorded decision", async () => {
    const actor = await newActor();
    const x = await seedCompactTrajectory(actor, { code: `TA-${uid()}`, name: "Awaiting", formal: true });
    const drivers = await db().select().from(schema.valueDriver).where(eq(schema.valueDriver.projectId, x.project.id));
    const r3 = await createReview(actor, { projectId: x.project.id, trigger: "ad_hoc", reviewDate: todayIso() });
    await upsertValuePositions(actor, {
      reviewId: r3.id,
      positions: drivers.map((d, i) => ({
        forecastRationale: "Synthetic test rationale",
        valueDriverId: d.id,
        currentForecast: i === 0 ? "14000000.00" : i === 1 ? "8000000.00" : "4000000.00",
        realisedValue: i === 0 ? "4500000.00" : "0.00",
      })),
    });
    const sc = await upsertScenario(actor, {
      reviewId: r3.id,
      label: "Re-tender",
      kind: "recommended",
      totalValue: "28000000.00",
    });
    await saveRecommendation(actor, { reviewId: r3.id, scenarioId: sc.id, narrative: "Re-tender" });
    await issueRecommendation(actor, { reviewId: r3.id });
    await finaliseReview(actor, { reviewId: r3.id });

    const o = await getExecutiveOverview(x.project.id, TODAY);
    expect(o.formal!.sequence).toBe(3);
    expect(o.decision.recorded!.review.sequence).toBe(2); // the decision stays Review #2's
    expect(o.decision.awaiting!.review.sequence).toBe(3);
    expect(o.decision.awaiting!.decision).toBeNull();
    const text = render(o);
    expect(text).toContain(
      "Latest recorded value decision View Assurance decision → Source: Review #2 · formal position as at 30 Sept 2026",
    );
    expect(text).toContain("Management selected Delay 3 months · $27.0m");
    expect(text).toContain("has an issued Cardaxia recommendation (Re-tender · $28.0m) awaiting management decision.");
    expect(text).not.toContain("Source: Review #3");
  });

  it("12/15/16/20. legacy V2 + draft V3, no recommendation at the latest review: provisional change amount", async () => {
    const actor = await newActor();
    const { project } = await seedCompactEvolution(actor, { code: `EV-${uid()}`, name: "Evolution Compact" });
    const o = await getExecutiveOverview(project.id, TODAY);
    expect(o.trajectory.status).toBe("basis_not_classified");
    expect(o.authorised!.versionNumber).toBe(2); // V3 draft never current
    // Latest review (#3) has no options; the latest recorded decision is Review #2's, identified as such (4D.9L).
    expect(o.decision.recorded!.review.sequence).toBe(2);
    expect(o.valueCase.pending).toEqual([
      {
        id: expect.any(String),
        code: "VC-002",
        status: "draft",
        toVersionNumber: 3,
        proposedChange: "450000.00",
        statedChange: null, // nothing stated, so nothing to reconcile
        reconciled: null,
      },
    ]);
    const text = render(o);
    expect(text).toContain("Proposed change +$450k · Draft — not in force"); // 4D.9J: never "+$0.5m"
    expect(text).toContain(
      "Latest recorded value decision View Assurance decision → Source: Review #2 · formal position as at 30 Jun 2026",
    );
    expect(text).toContain("Recorded at Review #2. The latest formal position (Review #3");
    expect(text).toContain("records no Cardaxia recommendation or management decision.");
    expect(text).toContain("Authorised Value $1.3m Authorised V2");
  });

  it("4. pre-authorisation: no executive position", async () => {
    const actor = await newActor();
    const d = await seedCompactTrajectoryDraft(actor, { code: `PA-${uid()}`, name: "Pre-auth" });
    const o = await getExecutiveOverview(d.project.id, TODAY);
    expect(o).toMatchObject({ authorised: null, formal: null, decision: { recorded: null, awaiting: null } });
    expect(o.valueCase.current).toBeNull();
  });
});
