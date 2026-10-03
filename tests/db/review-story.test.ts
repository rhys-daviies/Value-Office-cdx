import { and, eq } from "drizzle-orm";
import { todayIso } from "@/domain/attention";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { realisedPositionComplete } from "@/domain/trajectory";
import { seedCompactDecision, seedCompactTrajectory } from "@/fixtures/compact";
import { createReview, upsertValuePositions } from "@/server/commands/assurance";
import { recordEvidence } from "@/server/commands/evidence";
import { assessLeakage } from "@/server/commands/leakage";
import { assessMatterWorking, createMatter, setMatterStage } from "@/server/commands/matters";
import { upsertScenario } from "@/server/commands/options";
import { setScenarioPoint } from "@/server/commands/trajectory";
import { authoriseValueChange, createValueChange, proposeValueChange } from "@/server/commands/value-change";
import { db, schema } from "@/server/db/client";
import { getReviewStory } from "@/server/queries/review-story";
import { getAlternativeValueTrajectories, getValueTrajectoryChart } from "@/server/queries/trajectory";
import { ReviewStory } from "@/ui/assurance/story";
import { DraftTrajectoryPreview, ReviewOptionsVisual } from "@/ui/trajectory/alternatives";
import { buildTrajectoryPresentation, epoch } from "@/ui/trajectory/model";

import { newActor, uid } from "../support/fixtures";

// Phase 4D.9G: the review story (Assurance matter → driver → leakage → options → recommendation → decision → Value
// Change), the draft (non-governed) trajectory preview, and the Value Change trajectory marker.

const TODAY = "2027-03-15";
const strip = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
const storyText = (story: NonNullable<Awaited<ReturnType<typeof getReviewStory>>>) =>
  strip(renderToStaticMarkup(createElement(ReviewStory, { story, currency: "USD", base: "/projects/x" })));

/** Trajectory Executive: Review #2 (30 Sep 2026) finalised with VL-001, options, recommendation and decision. */
async function executive() {
  const actor = await newActor();
  const x = await seedCompactTrajectory(actor, { code: `TX-${uid()}`, name: "Trajectory Executive", formal: true });
  return { actor, ...x };
}

async function driverId(projectId: string, code: string) {
  const [d] = await db()
    .select()
    .from(schema.valueDriver)
    .where(and(eq(schema.valueDriver.projectId, projectId), eq(schema.valueDriver.code, code)));
  return d!.id;
}

describe("4D.9F product decisions (locked)", () => {
  it("1/2. partly attributed + unattributed realised stays incomplete; all-unattributed is complete", () => {
    const base = { financialDriverCount: 3, realisedTotal: "1000000.00" };
    expect(realisedPositionComplete({ ...base, realisedAssessed: 2, unattributedRealised: "200000.00" })).toBe(false);
    expect(realisedPositionComplete({ ...base, realisedAssessed: 0, unattributedRealised: "1000000.00" })).toBe(true);
    expect(realisedPositionComplete({ ...base, realisedAssessed: 3, unattributedRealised: null })).toBe(true);
    expect(realisedPositionComplete({ ...base, realisedAssessed: 3, unattributedRealised: "100000.00" })).toBe(true);
    expect(
      realisedPositionComplete({ ...base, realisedAssessed: 0, unattributedRealised: null, realisedTotal: null }),
    ).toBe(false);
  });
});

describe("review story", () => {
  it("9/11–16. canonical: matter → driver movement → leakage; recommendation and the differing decision", async () => {
    const x = await executive();
    const s = (await getReviewStory(x.project.id, x.review.id))!;
    expect(s).toMatchObject({
      governed: true,
      matterBasis: "snapshot",
      review: { sequence: 2, date: "2026-09-30", trigger: "material_evidence_change", againstVersionNumber: 1 },
      evidence: [{ code: "E-002", title: "Revised mobilisation plan", trigger: true }],
    });
    expect(s.matters).toEqual([
      {
        id: expect.any(String),
        code: "VL-001",
        title: "Vendor sequencing risk",
        status: "open",
        stage: "escalated",
        ownerName: "Test Delivery Lead",
        raisedInThisReview: false, // raised in Continuous Assurance, formally assessed here
        drivers: [
          {
            code: "VD-01",
            name: "Procurement Savings",
            previousForecast: "14000000.00",
            currentForecast: "13000000.00",
            movement: "-1000000.00",
          },
        ],
        leakage: { total: "700000.00", recoverable: "450000.00", unrecoverable: "250000.00" },
      },
    ]);
    // 12. Value Gap stays distinct from Value Leakage.
    expect(s.position).toEqual({
      authorisedTotal: "30000000.00",
      forecastTotal: "26000000.00",
      valueGap: "4000000.00",
      realisedTotal: "4000000.00",
      realisedComplete: true,
    });
    expect(s.recommendation).toEqual({ issued: true, label: "Act now", totalValue: "29000000.00", milestones: 2 });
    expect(s.decision).toMatchObject({
      label: "Delay 3 months",
      totalValue: "27000000.00",
      milestones: 3,
      deciderName: "Test VCO",
      decidedOn: todayIso(), // after the recommendation was issued (4D.9K temporal order)
      rationale: "Synthetic: delay to align with the budget cycle",
      differenceFromRecommendation: "-2000000.00",
    });
    expect(s.valueChanges).toEqual([]);

    const text = storyText(s);
    expect(text).toContain("Why the value position moved");
    expect(text).toContain("Total Value Leakage $700,000 = Recoverable $450,000 + Unrecoverable $250,000");
    expect(text).toContain("Value Leakage is assessed per matter; it is not the Value Gap.");
    expect(text).toContain("VD-01 Procurement Savings: forecast $14.0m → $13.0m (-$1.0m)");
    expect(text).toContain("Cardaxia recommendation: Act now");
    expect(text).toContain("Client selected: Delay 3 months");
    expect(text).toContain("-$2.0m vs recommendation");
    expect(text).toContain("Value Gap $4.0m");
    // 18. Forecast movement alone never implies a Value Change.
    expect(text).toContain("No Value Change linked to this review.");
  });

  it("4. no client decision: no decision difference anywhere", async () => {
    const actor = await newActor();
    const x = await seedCompactTrajectory(actor, { code: `TJ-${uid()}`, name: "Trajectory Compact" }); // draft review
    const s = (await getReviewStory(x.project.id, x.review.id))!;
    expect(s.decision).toBeNull();
    expect(storyText(s)).toContain("No client decision recorded.");
    const a = (await getAlternativeValueTrajectories(x.project.id, x.review.id))!;
    expect(a.decisionComparison).toBeNull();
  });

  it("10/18. no invented relationships: a later matter and an unlinked Value Change stay out of the finalised story", async () => {
    const x = await executive();
    await createMatter(x.actor, {
      projectId: x.project.id,
      code: "VL-002",
      title: "Later supplier issue",
      identifiedOn: "2026-10-01",
      driverIds: [await driverId(x.project.id, "VD-02")],
    });
    await createValueChange(x.actor, {
      projectId: x.project.id,
      code: "VC-001",
      reason: "Unrelated re-phasing",
      statedChangeAmount: "0.00",
    });
    const s = (await getReviewStory(x.project.id, x.review.id))!;
    expect(s.matters.map((m) => m.code)).toEqual(["VL-001"]);
    expect(s.valueChanges).toEqual([]);
  });

  it("17/21. Value Change shown only where linked; the trajectory marks the authorised change that created V2", async () => {
    const x = await executive();
    const [decision] = await db()
      .select()
      .from(schema.decision)
      .where(eq(schema.decision.assuranceReviewId, x.review.id));
    const { change } = await createValueChange(x.actor, {
      projectId: x.project.id,
      code: "VC-001",
      reason: "Adopt the delayed plan",
      statedChangeAmount: "0.00",
      assuranceReviewId: x.review.id,
      decisionId: decision!.id,
    });
    let s = (await getReviewStory(x.project.id, x.review.id))!;
    expect(s.valueChanges).toEqual([
      {
        id: change.id,
        code: "VC-001",
        status: "draft",
        fromVersionNumber: 1,
        toVersionNumber: 2,
        authorisedOn: null,
        linkedBy: ["review", "decision"],
      },
    ]);
    // A draft change is not an authorised event: no marker.
    expect((await getValueTrajectoryChart(x.project.id, { today: TODAY })).versionChange).toBeNull();

    await proposeValueChange(x.actor, { changeId: change.id });
    const ev = await recordEvidence(x.actor, { projectId: x.project.id, code: "E-VC1", title: "VCO approval" });
    await authoriseValueChange(x.actor, {
      changeId: change.id,
      authorisedByPersonId: x.vco.id,
      authorisedOn: "2026-10-01",
      authorisationEvidenceId: ev.id,
    });
    s = (await getReviewStory(x.project.id, x.review.id))!;
    expect(s.valueChanges[0]).toMatchObject({ status: "authorised", authorisedOn: "2026-10-01" });
    expect(storyText(s)).toContain("VC-001 · V1 → V2 · authorised 1 Oct 2026");

    const c = await getValueTrajectoryChart(x.project.id, { today: TODAY });
    expect(c.versionChange).toEqual({ code: "VC-001", versionNumber: 2, authorisedOn: "2026-10-01", inPeriod: true });
    const p = buildTrajectoryPresentation(c, "USD")!;
    expect(p.versionChange).toMatchObject({ t: epoch("2026-10-01"), label: "V2 authorised (VC-001)" });
    // Three markers, three distinct label slots (never merged, never overlapping on one row and side).
    const slots = [p.checkpoint!, p.versionChange!, p.today!].map((m) => `${m.align}/${m.row}`);
    expect(new Set(slots).size).toBe(3);
  });

  it("19/20. working Assurance changes never alter the governed trajectory or the finalised story", async () => {
    const x = await executive();
    const [before, altBefore, storyBefore] = await Promise.all([
      getValueTrajectoryChart(x.project.id, { today: TODAY }),
      getAlternativeValueTrajectories(x.project.id, x.review.id),
      getReviewStory(x.project.id, x.review.id),
    ]);
    const matter = storyBefore!.matters[0]!;
    await assessMatterWorking(x.actor, { matterId: matter.id, workingTotalAmount: "1500000.00" });
    await setMatterStage(x.actor, { matterId: matter.id, stage: "remediation" });
    // The finalised review's formal assessment is immutable.
    await expect(
      assessLeakage(x.actor, { leakageId: matter.id, reviewId: x.review.id, totalAmount: "900000.00" }),
    ).rejects.toThrow();
    expect(await getValueTrajectoryChart(x.project.id, { today: TODAY })).toEqual(before);
    expect(await getAlternativeValueTrajectories(x.project.id, x.review.id)).toEqual(altBefore);
    const after = (await getReviewStory(x.project.id, x.review.id))!;
    expect(after.matters[0]).toMatchObject({
      stage: "escalated",
      leakage: { total: "700000.00", recoverable: "450000.00", unrecoverable: "250000.00" },
    });
  });

  it("22/23. legacy review (unclassified, endpoint-only outcomes) still renders its story and outcomes", async () => {
    const actor = await newActor();
    const { project } = await seedCompactDecision(actor, { code: `DC-${uid()}`, name: "Decision Compact" });
    const [review] = await db()
      .select()
      .from(schema.assuranceReview)
      .where(eq(schema.assuranceReview.projectId, project.id));
    const s = (await getReviewStory(project.id, review!.id))!;
    expect(s.governed).toBe(true);
    expect(s.decision).not.toBeNull();
    expect(storyText(s)).toContain("Why the value position moved");
    const a = (await getAlternativeValueTrajectories(project.id, review!.id))!;
    expect(a.status).toBe("basis_not_classified");
    const html = strip(renderToStaticMarkup(createElement(ReviewOptionsVisual, { data: a })));
    expect(html).toContain("Alternative Value Outcomes");
  });
});

describe("draft trajectory preview", () => {
  it("6/7. a draft review's option paths render only as a non-governed preview", async () => {
    const actor = await newActor();
    const x = await seedCompactTrajectory(actor, { code: `TJ-${uid()}`, name: "Trajectory Compact" });
    const a = (await getAlternativeValueTrajectories(x.project.id, x.review.id))!;
    expect(a).toMatchObject({
      governed: false,
      available: true,
      anchor: null,
      history: null,
      decisionComparison: null,
    });
    expect(a.notes).toContain("draft_no_anchor");
    // Saved but not issued: never a governed recommendation role.
    expect(a.options.find((o) => o.label === "Act now")).toMatchObject({
      recommended: false,
      pendingRecommendation: true,
    });

    const html = strip(renderToStaticMarkup(createElement(DraftTrajectoryPreview, { data: a })));
    expect(html).toContain("Alternative Value Trajectories — preview");
    expect(html).toContain("Draft · Not governed");
    expect(html).toContain("Draft recommendation (not issued): Act now.");
    expect(html).toContain("Not a formal value position");
    expect(html).not.toContain("🔒");
    expect(html).not.toContain("Cardaxia recommendation");
    // 4D.9N.1B: a draft has no formal forecast, so no Formal Forecast context line.
    expect(html).not.toContain("Current expected outcome before the assessed management interventions.");
    expect(renderToStaticMarkup(createElement(DraftTrajectoryPreview, { data: a }))).toContain('data-governed="false"');
    // The governed visual refuses a draft.
    expect(() => renderToStaticMarkup(createElement(ReviewOptionsVisual, { data: a }))).toThrow();

    const s = (await getReviewStory(x.project.id, x.review.id))!;
    expect(s).toMatchObject({ governed: false, matterBasis: "working" });
    const text = storyText(s);
    expect(text).toContain("Working Assurance context");
    expect(text).toContain("Not yet a formal position");
    expect(text).toContain("Draft recommendation (not issued): Act now");
  });

  it("8. a finalised review is governed; a later draft previews over governed history without a draft anchor", async () => {
    const x = await executive();
    const governed = (await getAlternativeValueTrajectories(x.project.id, x.review.id))!;
    expect(governed.governed).toBe(true);
    expect(renderToStaticMarkup(createElement(DraftTrajectoryPreview, { data: governed }))).toBe("");
    expect(strip(renderToStaticMarkup(createElement(ReviewOptionsVisual, { data: governed })))).not.toContain(
      "Not governed",
    );

    const draft = await createReview(x.actor, { projectId: x.project.id, trigger: "ad_hoc", reviewDate: "2027-03-31" });
    await upsertValuePositions(x.actor, {
      reviewId: draft.id,
      positions: [
        {
          valueDriverId: await driverId(x.project.id, "VD-01"),
          currentForecast: "13000000.00",
          realisedValue: "4000000.00",
        },
      ],
    });
    const s = await upsertScenario(x.actor, {
      reviewId: draft.id,
      label: "Recover",
      kind: "alternative",
      totalValue: "28000000.00",
    });
    await setScenarioPoint(x.actor, { scenarioId: s.id, asOf: "2028-12-31", value: "28000000.00" });
    const a = (await getAlternativeValueTrajectories(x.project.id, draft.id))!;
    expect(a).toMatchObject({ governed: false, anchor: null });
    expect(a.history!.checkpoints.map((c) => c.sequence)).toEqual([1, 2]); // governed history only
  });
});
