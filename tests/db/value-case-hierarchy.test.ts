import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { seedCompactEvolution, seedCompactTrajectory, seedCompactTrajectoryDraft } from "@/fixtures/compact";
import { createReview, upsertValuePositions } from "@/server/commands/assurance";
import { recordEvidence } from "@/server/commands/evidence";
import { upsertScenario } from "@/server/commands/options";
import type { Actor } from "@/server/commands/run";
import { setScenarioPoint, setVersionBasis } from "@/server/commands/trajectory";
import { authoriseInitialVersion, proposeVersion } from "@/server/commands/value-case";
import { authoriseValueChange, createValueChange, proposeValueChange } from "@/server/commands/value-change";
import { db, schema } from "@/server/db/client";
import { getValueCaseEvolution } from "@/server/queries/evolution";
import { getAlternativeValueTrajectories, getValueTrajectoryChart } from "@/server/queries/trajectory";
import { getValueCaseSummary } from "@/server/queries/value-case-summary";
import { scenarioKindLabel } from "@/ui/labels";
import { DraftTrajectoryPreview, ReviewOptionsVisual } from "@/ui/trajectory/alternatives";
import { buildAlternativePresentation } from "@/ui/trajectory/alternatives-model";
import { epoch } from "@/ui/trajectory/model";
import { ValueCaseSummary } from "@/ui/value-case/summary";

import { newActor, uid } from "../support/fixtures";

// Phase 4D.9H: draft preview refinements, the Overview Value Case summary and the current-authorised-version rules.

const strip = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
const TODAY = "2027-03-15";

async function summaryOf(projectId: string) {
  return getValueCaseSummary(projectId, await getValueCaseEvolution(projectId));
}

/** Value Change from the version in force, optionally proposed and authorised (re-phasing at unchanged total). */
async function change(actor: Actor, projectId: string, vcoId: string, code: string, authorise: boolean) {
  const { change: c, version } = await createValueChange(actor, {
    projectId,
    code,
    reason: "Re-phase",
    statedChangeAmount: "0.00",
  });
  if (authorise) {
    await proposeValueChange(actor, { changeId: c.id });
    const ev = await recordEvidence(actor, { projectId, code: `E-${code}`, title: "VCO approval" });
    await authoriseValueChange(actor, {
      changeId: c.id,
      authorisedByPersonId: vcoId,
      authorisedOn: "2026-10-01",
      authorisationEvidenceId: ev.id,
    });
  }
  return { change: c, version };
}

describe("draft preview refinements", () => {
  it("1/2. the draft preview shows the draft's explicit forecast milestones, labelled not governed", async () => {
    const actor = await newActor();
    const x = await seedCompactTrajectory(actor, { code: `TJ-${uid()}`, name: "Trajectory Compact" });
    const a = (await getAlternativeValueTrajectories(x.project.id, x.review.id))!;
    expect(a.draftForecast!.points.map((p) => [p.asOf, p.value])).toEqual([
      ["2027-12-31", "16000000.00"],
      ["2028-12-31", "26000000.00"],
    ]);
    const p = buildAlternativePresentation(a, "USD")!;
    expect(p.rows.filter((r) => r.draftForecast !== null).map((r) => [r.t, r.draftForecast])).toEqual([
      [epoch("2027-12-31"), 16000000],
      [epoch("2028-12-31"), 26000000],
    ]);
    expect(p.rows.find((r) => r.t === epoch("2027-12-31"))!.tip).toContain(
      "Draft Formal Forecast (not governed): $16.0m",
    );
    expect(p.labels.find((l) => l.key === "draftForecast")!.lines).toEqual([
      "$26.0m Draft Formal Forecast",
      "Not governed",
    ]);
    const html = strip(renderToStaticMarkup(createElement(DraftTrajectoryPreview, { data: a })));
    expect(html).toContain("Draft · Not governed");
    expect(html).toContain("Draft Formal Forecast (not governed)");
    expect(html).not.toMatch(/(^|[^t] )Formal Forecast: /); // never the governed forecast wording
  });

  it("3. no draft forecast phasing → no invented line, and the reason is stated; governed reviews never get one", async () => {
    const actor = await newActor();
    const x = await seedCompactTrajectory(actor, { code: `TX-${uid()}`, name: "Trajectory Executive", formal: true });
    expect((await getAlternativeValueTrajectories(x.project.id, x.review.id))!.draftForecast).toBeNull();
    const [d1] = await db().select().from(schema.valueDriver).where(eq(schema.valueDriver.projectId, x.project.id));
    const draft = await createReview(actor, { projectId: x.project.id, trigger: "ad_hoc", reviewDate: "2027-03-31" });
    await upsertValuePositions(actor, {
      reviewId: draft.id,
      positions: [{ valueDriverId: d1!.id, currentForecast: "13000000.00" }],
    });
    const s = await upsertScenario(actor, {
      reviewId: draft.id,
      label: "Recover",
      kind: "recommended",
      totalValue: "28000000.00",
    });
    await setScenarioPoint(actor, { scenarioId: s.id, asOf: "2028-12-31", value: "28000000.00" });
    const a = (await getAlternativeValueTrajectories(x.project.id, draft.id))!;
    expect(a.draftForecast).toBeNull();
    expect(a.notes).toContain("draft_forecast_phasing_not_entered");
    expect(buildAlternativePresentation(a, "USD")!.rows.every((r) => r.draftForecast === null)).toBe(true);
    const html = strip(renderToStaticMarkup(createElement(DraftTrajectoryPreview, { data: a })));
    expect(html).toContain("Draft Formal Forecast phasing not entered, so no forecast baseline is shown.");
    // 4. A "recommended" option kind is a proposal until the recommendation is issued.
    expect(html).toContain("Proposed recommendation");
    expect(html).not.toContain("Recommended");
  });

  it("4/5. option-kind wording: Proposed recommendation until issued, then the governed wording", async () => {
    expect(scenarioKindLabel("recommended", false)).toBe("Proposed recommendation");
    expect(scenarioKindLabel("recommended", true)).toBe("Recommended");
    expect(scenarioKindLabel("alternative", false)).toBe("Alternative");
    const actor = await newActor();
    const x = await seedCompactTrajectory(actor, { code: `TX-${uid()}`, name: "Trajectory Executive", formal: true });
    const html = strip(
      renderToStaticMarkup(
        createElement(ReviewOptionsVisual, {
          data: (await getAlternativeValueTrajectories(x.project.id, x.review.id))!,
        }),
      ),
    );
    expect(html).toContain("Cardaxia recommendation");
    expect(html).not.toContain("Proposed recommendation");
  });
});

describe("Value Case governance summary and current authorised version", () => {
  it("9/15/16. A: authorised V1, no Value Changes, no Original Business Case", async () => {
    const actor = await newActor();
    const x = await seedCompactTrajectory(actor, { code: `TX-${uid()}`, name: "Trajectory Executive", formal: true });
    const s = await summaryOf(x.project.id);
    expect(s).toEqual({
      currency: "USD",
      current: { versionNumber: 1, authorisedValue: "30000000.00", authorisedOn: "2026-01-15" },
      originalBusinessCase: null,
      authorisedChangeCount: 0,
      latestAuthorisedChange: null,
      pending: [],
    });
    const html = strip(renderToStaticMarkup(createElement(ValueCaseSummary, { summary: s, base: "/projects/x" })));
    expect(html).toContain("$30.0m V1 · authorised 15 Jan 2026");
    expect(html).toContain("Original Business Case Not recorded");
    expect(html).toContain("View Value Case history →");
    expect(renderToStaticMarkup(createElement(ValueCaseSummary, { summary: s, base: "/projects/x" }))).toContain(
      'href="/projects/x/value-case#evolution"',
    );
  });

  it("10–14. B → C: V2 through a Value Change stays current while a draft V3 is pending; the plan line stays V2", async () => {
    const actor = await newActor();
    const x = await seedCompactTrajectory(actor, { code: `TX-${uid()}`, name: "Trajectory Executive", formal: true });
    await change(actor, x.project.id, x.vco.id, "VC-001", true);
    let s = await summaryOf(x.project.id);
    expect(s).toMatchObject({
      current: { versionNumber: 2, authorisedValue: "30000000.00", authorisedOn: "2026-10-01" },
      authorisedChangeCount: 1,
      latestAuthorisedChange: { code: "VC-001", versionNumber: 2, authorisedOn: "2026-10-01" },
      pending: [],
    });
    const { version: v3 } = await change(actor, x.project.id, x.vco.id, "VC-002", false);
    s = await summaryOf(x.project.id);
    expect(s.current!.versionNumber).toBe(2); // 11. a draft V3 never becomes current
    // A re-phasing draft at an unchanged total: the provisional change is exactly zero.
    expect(s.pending).toEqual([
      { id: expect.any(String), code: "VC-002", status: "draft", toVersionNumber: 3, proposedChange: "0.00" },
    ]);
    expect(strip(renderToStaticMarkup(createElement(ValueCaseSummary, { summary: s, base: "/p" })))).toContain(
      "Proposed change $0 · Draft — not in force",
    );
    // 12. The primary trajectory's plan is the version in force (V2), never the draft V3.
    const c = await getValueTrajectoryChart(x.project.id, { today: TODAY });
    expect(c.version!.versionNumber).toBe(2);
    const v3Points = await db()
      .select()
      .from(schema.valueTrajectoryPoint)
      .where(eq(schema.valueTrajectoryPoint.valueCaseVersionId, v3.id));
    expect(v3Points.length).toBeGreaterThan(0); // the draft carries copied plan points...
    expect(c.plan.every((p) => !v3Points.some((d) => d.id === p.id))).toBe(true); // ...which are not drawn
    // 13. Evolution keeps the governed history (V1 superseded, V2 authorised), and no draft version.
    const e = await getValueCaseEvolution(x.project.id);
    expect(e.authorisedVersions.map((v) => [v.versionNumber, v.status, v.valueChangeCode])).toEqual([
      [1, "superseded", null],
      [2, "authorised", "VC-001"],
    ]);
  });

  it("17/19. D: legacy unclassified project keeps its full Evolution and a summary without trajectory adoption", async () => {
    const actor = await newActor();
    const { project } = await seedCompactEvolution(actor, { code: `EV-${uid()}`, name: "Evolution Compact" });
    expect((await getValueTrajectoryChart(project.id)).status).toBe("basis_not_classified");
    const e = await getValueCaseEvolution(project.id);
    expect(e.events.map((x) => x.kind)).toEqual([
      "original",
      "authorisation",
      "review",
      "review",
      "authorisation",
      "review",
    ]);
    const s = await getValueCaseSummary(project.id, e);
    expect(s).toMatchObject({
      current: { versionNumber: 2, authorisedValue: "1300000.00" },
      originalBusinessCase: { value: "2000000.00" },
      authorisedChangeCount: 1,
      latestAuthorisedChange: { code: "VC-001", versionNumber: 2 },
      pending: [{ code: "VC-002", status: "draft", toVersionNumber: 3 }],
    });
  });

  it("18. missing Value Period: Evolution and summary still render from the authorised version", async () => {
    const actor = await newActor();
    const d = await seedCompactTrajectoryDraft(actor, { code: `TD-${uid()}`, name: "No period" });
    await setVersionBasis(actor, {
      versionId: d.v1.id,
      valueBasisKind: "cumulative_benefit",
      valuePeriodStart: null,
      valuePeriodEnd: null,
    });
    await proposeVersion(actor, { versionId: d.v1.id });
    const ev = await recordEvidence(actor, { projectId: d.project.id, code: "E-1", title: "Authorisation" });
    await authoriseInitialVersion(actor, {
      versionId: d.v1.id,
      authorisedByPersonId: d.vco.id,
      authorisedOn: "2026-01-15",
      authorisationEvidenceId: ev.id,
    });
    expect((await getValueTrajectoryChart(d.project.id)).status).toBe("period_not_set");
    const e = await getValueCaseEvolution(d.project.id);
    expect(e.authorisedVersions.map((v) => v.versionNumber)).toEqual([1]);
    expect((await getValueCaseSummary(d.project.id, e)).current!.authorisedValue).toBe("30000000.00");
  });
});
