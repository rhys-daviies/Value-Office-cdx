import { and, eq } from "drizzle-orm";
import { issueAfterInternalReview } from "@/fixtures/recommendation";
import { describe, expect, it } from "vitest";

import { clientElectedDifference, leakageAmounts } from "@/domain/response";
import { seedCompactAuthorised } from "@/fixtures/compact";
import { HORIZON, seedHorizon } from "@/fixtures/horizon";
import { createReview, finaliseReview, updateReview, upsertValuePositions } from "@/server/commands/assurance";
import { recordEvidence } from "@/server/commands/evidence";
import { assessLeakage, createLeakage, setLeakageDrivers, updateLeakage } from "@/server/commands/leakage";
import { COMMANDS } from "@/server/commands/names";
import { recordDecision, saveRecommendation, upsertScenario } from "@/server/commands/options";
import type { Actor } from "@/server/commands/run";
import { addStakeholder } from "@/server/commands/stakeholders";
import { updateDriverVersion } from "@/server/commands/value-case";
import {
  authoriseValueChange,
  createValueChange,
  proposeValueChange,
  rejectValueChange,
  returnValueChange,
  withdrawValueChange,
} from "@/server/commands/value-change";
import { db, schema } from "@/server/db/client";
import { getAssuranceWorkspace, getValuePositionSummary } from "@/server/queries/assurance";
import { getReviewResponse, getValueChangeDetail } from "@/server/queries/response";

import { asCommand, expectDomainError, newActor, sql, uid } from "../support/fixtures";

const today = new Date().toISOString().slice(0, 10);

/** Synthetic Authorised V1: VD-01 $1.0m, VD-02 $0.5m, VD-03 non-financial. */
async function compact(actor?: Actor) {
  actor ??= await newActor();
  const code = `C-${uid()}`;
  const { project } = await seedCompactAuthorised(actor, { code, name: `Compact ${code}` });
  const drivers = await db()
    .select({ id: schema.valueDriver.id, code: schema.valueDriver.code })
    .from(schema.valueDriver)
    .where(eq(schema.valueDriver.projectId, project.id));
  const id = (c: string) => drivers.find((d) => d.code === c)!.id;
  const [valueCase] = await db().select().from(schema.valueCase).where(eq(schema.valueCase.projectId, project.id));
  const [v1] = await db()
    .select()
    .from(schema.valueCaseVersion)
    .where(and(eq(schema.valueCaseVersion.projectId, project.id), eq(schema.valueCaseVersion.versionNumber, 1)));
  const evidence = await recordEvidence(actor, { projectId: project.id, code: `E-${uid()}`, title: "Evidence" });
  return {
    actor,
    project,
    vco: valueCase!.vcoPersonId!,
    v1: v1!,
    A: id("VD-01"),
    B: id("VD-02"),
    C: id("VD-03"),
    evidence,
  };
}
type Ctx = Awaited<ReturnType<typeof compact>>;

async function draftReview(ctx: Ctx, positions = true) {
  const review = await createReview(ctx.actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate: today });
  if (positions) {
    await upsertValuePositions(ctx.actor, {
      reviewId: review.id,
      positions: [
        { forecastRationale: "Synthetic test rationale", valueDriverId: ctx.A, currentForecast: "900000.00" },
        { forecastRationale: "Synthetic test rationale", valueDriverId: ctx.B, currentForecast: "400000.00" },
        { valueDriverId: ctx.C, forecastRationale: "On track" },
      ],
    });
  }
  return review;
}

/** Review with options current $1.3m / recommended $1.5m / alternative $1.4m, recommendation issued, finalised. */
async function reviewWithOptions(ctx: Ctx) {
  const review = await draftReview(ctx);
  const current = await upsertScenario(ctx.actor, {
    reviewId: review.id,
    label: "Current",
    kind: "current",
    totalValue: "1300000.00",
  });
  const recommended = await upsertScenario(ctx.actor, {
    reviewId: review.id,
    label: "Act now",
    kind: "recommended",
    totalValue: "1500000.00",
  });
  const delay = await upsertScenario(ctx.actor, {
    reviewId: review.id,
    label: "Delay one quarter",
    kind: "alternative",
    totalValue: "1400000.00",
  });
  await saveRecommendation(ctx.actor, { reviewId: review.id, scenarioId: recommended.id, narrative: "Act now" });
  await issueAfterInternalReview(ctx.actor, { reviewId: review.id });
  const finalised = await finaliseReview(ctx.actor, { reviewId: review.id });
  return { review: finalised, current, recommended, delay };
}

async function decided(ctx: Ctx) {
  const opts = await reviewWithOptions(ctx);
  const decision = await recordDecision(ctx.actor, {
    reviewId: opts.review.id,
    selectedScenarioId: opts.delay.id,
    decidedByPersonId: ctx.vco,
    decidedOn: today,
    rationale: "Budget timing",
  });
  return { ...opts, decision };
}

// ---------------------------------------------------------------------------

describe("A1 — unattributed realised value", () => {
  it("adds to attributed realised value without allocating it to any driver", async () => {
    const ctx = await compact();
    const review = await draftReview(ctx);
    await upsertValuePositions(ctx.actor, {
      reviewId: review.id,
      positions: [{ valueDriverId: ctx.A, realisedValue: "100000.00" }],
    });
    await updateReview(ctx.actor, {
      reviewId: review.id,
      unattributedRealisedValue: "250000.00",
      unattributedRealisedRationale: "Finance confirmed savings at programme level only",
    });
    const ws = await getAssuranceWorkspace(ctx.project.id, review.id);
    expect(ws!.totals).toMatchObject({
      realisedAttributedTotal: "100000.00",
      unattributedRealised: "250000.00",
      realisedTotal: "350000.00",
      realisedAssessed: 1,
    });
    expect(ws!.rows.find((r) => r.valueDriverId === ctx.B)!.realisedValue).toBeNull();
  });

  it("requires a rationale for any unattributed amount", async () => {
    const ctx = await compact();
    const review = await draftReview(ctx);
    await expectDomainError(
      updateReview(ctx.actor, { reviewId: review.id, unattributedRealisedValue: "1.00" }),
      "VO_CHECK_VIOLATION",
    );
  });

  it("is immutable once the review is finalised", async () => {
    const ctx = await compact();
    const review = await draftReview(ctx);
    await updateReview(ctx.actor, {
      reviewId: review.id,
      unattributedRealisedValue: "1.00",
      unattributedRealisedRationale: "x",
    });
    await finaliseReview(ctx.actor, { reviewId: review.id });
    await expectDomainError(
      updateReview(ctx.actor, { reviewId: review.id, unattributedRealisedValue: "2.00" }),
      "VO_REVIEW_IMMUTABLE",
    );
  });
});

describe("A3 — finalising with a missing financial forecast", () => {
  it("blocks finalisation when a financial driver's forecast is simply blank", async () => {
    const ctx = await compact();
    const review = await draftReview(ctx, false);
    await upsertValuePositions(ctx.actor, {
      reviewId: review.id,
      positions: [
        { forecastRationale: "Synthetic test rationale", valueDriverId: ctx.A, currentForecast: "900000.00" },
        { valueDriverId: ctx.B },
        { valueDriverId: ctx.C },
      ],
    });
    const err = await expectDomainError(finaliseReview(ctx.actor, { reviewId: review.id }), "VO_FORECAST_MISSING");
    expect(err.message).toMatch(/1 financial Value Driver/);
  });

  it("allows an explicit Not Assessed with rationale, and reports the project forecast as incomplete", async () => {
    const ctx = await compact();
    const review = await draftReview(ctx, false);
    await upsertValuePositions(ctx.actor, {
      reviewId: review.id,
      positions: [
        { forecastRationale: "Synthetic test rationale", valueDriverId: ctx.A, currentForecast: "900000.00" },
        { valueDriverId: ctx.B, forecastNotAssessed: true, forecastRationale: "Vendor data not yet received" },
        { valueDriverId: ctx.C },
      ],
    });
    await finaliseReview(ctx.actor, { reviewId: review.id });
    const ws = await getAssuranceWorkspace(ctx.project.id, review.id);
    expect(ws!.totals.forecastTotal).toBeNull();
    expect(ws!.totals.valueGap).toBeNull();
    expect(ws!.totals.forecastBlockers).toEqual([{ code: "VD-02", name: "Beta Revenue", notAssessed: true }]);
  });

  it("requires a rationale for Not Assessed, and rejects Not Assessed with a forecast", async () => {
    const ctx = await compact();
    const review = await draftReview(ctx, false);
    await expectDomainError(
      upsertValuePositions(ctx.actor, {
        reviewId: review.id,
        positions: [{ valueDriverId: ctx.B, forecastNotAssessed: true }],
      }),
      "VO_CHECK_VIOLATION",
    );
    await expectDomainError(
      upsertValuePositions(ctx.actor, {
        reviewId: review.id,
        positions: [
          { valueDriverId: ctx.B, forecastNotAssessed: true, currentForecast: "1.00", forecastRationale: "x" },
        ],
      }),
      "VO_INVALID_INPUT",
    );
  });

  it("does not require a forecast for non-financial drivers", async () => {
    const ctx = await compact();
    const review = await draftReview(ctx); // VD-03 has only a note
    expect((await finaliseReview(ctx.actor, { reviewId: review.id })).status).toBe("finalised");
  });
});

describe("Value Leakage", () => {
  it("belongs to its review/project and derives recoverable = total − unrecoverable", async () => {
    const ctx = await compact();
    const review = await draftReview(ctx);
    const vl = await createLeakage(ctx.actor, {
      reviewId: review.id,
      code: "VL-001",
      title: "Vendor delay",
      driverIds: [ctx.A, ctx.B],
    });
    expect(vl).toMatchObject({ projectId: ctx.project.id, identifiedInReviewId: review.id, status: "open" });
    await assessLeakage(ctx.actor, {
      leakageId: vl.id,
      reviewId: review.id,
      totalAmount: "700000.00",
      unrecoverableAmount: "250000.00",
      unrecoverableRationale: "Go-live slipped; Q1 savings evidenced as lost",
    });
    const resp = await getReviewResponse(ctx.project.id, review.id);
    expect(resp.leakage[0]!.thisReview!.amounts).toEqual({
      total: "700000.00",
      unrecoverable: "250000.00",
      recoverable: "450000.00",
    });
    expect(resp.leakageSummary).toMatchObject({
      total: "700000.00",
      recoverable: "450000.00",
      unrecoverable: "250000.00",
    });
    expect(resp.leakage[0]!.drivers.map((d) => d.code)).toEqual(["VD-01", "VD-02"]);
    expect(leakageAmounts("0.10", "0.00").recoverable).toBe("0.10");
  });

  it("defaults to recoverable and records the validating consultant", async () => {
    const ctx = await compact();
    const review = await draftReview(ctx);
    const vl = await createLeakage(ctx.actor, { reviewId: review.id, code: "VL-001", title: "X" });
    const a = await assessLeakage(ctx.actor, { leakageId: vl.id, reviewId: review.id, totalAmount: "100.00" });
    expect(a).toMatchObject({ unrecoverableAmount: "0.00", unrecoverableValidatedBy: null });
    const b = await assessLeakage(ctx.actor, {
      leakageId: vl.id,
      reviewId: review.id,
      totalAmount: "100.00",
      unrecoverableAmount: "40.00",
      unrecoverableRationale: "Evidence of loss",
    });
    expect(b.unrecoverableValidatedBy).toBe(ctx.actor.userId);
  });

  it("rejects unrecoverable above total, negatives, and unrecoverable without rationale/validation", async () => {
    const ctx = await compact();
    const review = await draftReview(ctx);
    const vl = await createLeakage(ctx.actor, { reviewId: review.id, code: "VL-001", title: "X" });
    await expectDomainError(
      assessLeakage(ctx.actor, {
        leakageId: vl.id,
        reviewId: review.id,
        totalAmount: "100.00",
        unrecoverableAmount: "150.00",
        unrecoverableRationale: "r",
      }),
      "VO_CHECK_VIOLATION",
    );
    await expectDomainError(
      assessLeakage(ctx.actor, { leakageId: vl.id, reviewId: review.id, totalAmount: "-1.00" }),
      "VO_CHECK_VIOLATION",
    );
    await expectDomainError(
      assessLeakage(ctx.actor, {
        leakageId: vl.id,
        reviewId: review.id,
        totalAmount: "100.00",
        unrecoverableAmount: "10.00",
      }),
      "VO_INVALID_INPUT",
    );
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.assessLeakage, (tx) =>
        tx.insert(schema.leakageAssessment).values({
          valueLeakageId: vl.id,
          assuranceReviewId: review.id,
          projectId: ctx.project.id,
          totalAmount: "100.00",
          unrecoverableAmount: "10.00",
          unrecoverableRationale: "r",
        }),
      ),
      "VO_ACTOR_MISMATCH", // unrecoverable without the acting consultant's validation
    );
  });

  it("keeps affected drivers and the response owner within the project", async () => {
    const ctx = await compact();
    const other = await compact(ctx.actor);
    const review = await draftReview(ctx);
    const vl = await createLeakage(ctx.actor, { reviewId: review.id, code: "VL-001", title: "X" });
    await expectDomainError(
      setLeakageDrivers(ctx.actor, { leakageId: vl.id, driverIds: [other.A] }),
      "VO_REFERENCE_VIOLATION",
    );
    const { person: outsider } = await addStakeholder(ctx.actor, { projectId: other.project.id, name: "Outsider" });
    await expectDomainError(
      updateLeakage(ctx.actor, { leakageId: vl.id, responseOwnerPersonId: outsider.id }),
      "VO_REFERENCE_VIOLATION",
    );
    const owner = await updateLeakage(ctx.actor, { leakageId: vl.id, responseOwnerPersonId: ctx.vco });
    expect(owner.responseOwnerPersonId).toBe(ctx.vco);
  });

  it("freezes assessments with their finalised review; reassessment happens in a later review", async () => {
    const ctx = await compact();
    const r1 = await draftReview(ctx);
    const vl = await createLeakage(ctx.actor, { reviewId: r1.id, code: "VL-001", title: "X" });
    await assessLeakage(ctx.actor, { leakageId: vl.id, reviewId: r1.id, totalAmount: "100.00" });
    await finaliseReview(ctx.actor, { reviewId: r1.id });
    await expectDomainError(
      assessLeakage(ctx.actor, { leakageId: vl.id, reviewId: r1.id, totalAmount: "200.00" }),
      "VO_REVIEW_IMMUTABLE",
    );
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.assessLeakage, (tx) =>
        tx.delete(schema.leakageAssessment).where(eq(schema.leakageAssessment.valueLeakageId, vl.id)),
      ),
      "VO_REVIEW_IMMUTABLE",
    );
    const r2 = await draftReview(ctx);
    await assessLeakage(ctx.actor, { leakageId: vl.id, reviewId: r2.id, totalAmount: "200.00" });
    const resp = await getReviewResponse(ctx.project.id, r2.id);
    expect(resp.leakage[0]!.assessments.map((a) => a.totalAmount)).toEqual(["100.00", "200.00"]);
    expect(resp.leakage[0]!.latestFinalised!.amounts.total).toBe("100.00");
  });

  it("is independent of Value Gap", async () => {
    const ctx = await compact();
    const review = await draftReview(ctx); // gap 1.5 − 1.3 = 0.2m
    const vl = await createLeakage(ctx.actor, { reviewId: review.id, code: "VL-001", title: "X" });
    await assessLeakage(ctx.actor, { leakageId: vl.id, reviewId: review.id, totalAmount: "700000.00" });
    const ws = await getAssuranceWorkspace(ctx.project.id, review.id);
    expect(ws!.totals.valueGap).toBe("200000.00"); // unchanged by leakage of 0.7m
    await finaliseReview(ctx.actor, { reviewId: review.id });
  });
});

describe("options, recommendation and decision", () => {
  it("stores scenario values exactly and derives differences without deriving the values", async () => {
    const ctx = await compact();
    const review = await draftReview(ctx);
    await upsertScenario(ctx.actor, {
      reviewId: review.id,
      label: "Current",
      kind: "current",
      totalValue: "14700000.01",
    });
    await upsertScenario(ctx.actor, {
      reviewId: review.id,
      label: "Act now",
      kind: "recommended",
      totalValue: "15300000.00",
    });
    await upsertScenario(ctx.actor, {
      reviewId: review.id,
      label: "Delay 2Q",
      kind: "alternative",
      totalValue: "14500000.00",
    });
    await upsertScenario(ctx.actor, {
      reviewId: review.id,
      label: "No action",
      kind: "no_action",
      totalValue: "14000000.00",
    });
    const { scenarios } = await getReviewResponse(ctx.project.id, review.id);
    expect(scenarios.map((s) => [s.totalValue, s.vsCurrent, s.vsRecommended])).toEqual([
      ["14700000.01", "0.00", "-599999.99"],
      ["15300000.00", "599999.99", "0.00"],
      ["14500000.00", "-200000.01", "-800000.00"],
      ["14000000.00", "-700000.01", "-1300000.00"],
    ]);
    await expectDomainError(
      upsertScenario(ctx.actor, { reviewId: review.id, label: "Second current", kind: "current", totalValue: "1.00" }),
      "VO_UNIQUE_VIOLATION",
    );
  });

  it("keeps the issued recommendation unchanged after the client decides differently", async () => {
    const ctx = await compact();
    const { review, recommended, delay, decision } = await decided(ctx);
    const resp = await getReviewResponse(ctx.project.id, review.id);
    expect(resp.recommendation!.scenarioId).toBe(recommended.id);
    expect(resp.decision!.selectedScenarioId).toBe(delay.id);
    expect(resp.decision!.clientElectedDifference).toBe("-100000.00");
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.recordDecision, (tx) =>
        tx
          .update(schema.recommendation)
          .set({ scenarioId: delay.id })
          .where(eq(schema.recommendation.assuranceReviewId, review.id)),
      ),
      "VO_RECOMMENDATION_ISSUED",
    );
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.recordDecision, (tx) =>
        tx.update(schema.decision).set({ rationale: "rewritten" }).where(eq(schema.decision.id, decision.id)),
      ),
      "VO_DECISION_IMMUTABLE",
    );
  });

  it("freezes options once the recommendation is issued", async () => {
    const ctx = await compact();
    const review = await draftReview(ctx);
    const rec = await upsertScenario(ctx.actor, {
      reviewId: review.id,
      label: "Act now",
      kind: "recommended",
      totalValue: "1.00",
    });
    await saveRecommendation(ctx.actor, { reviewId: review.id, scenarioId: rec.id, narrative: "n" });
    await issueAfterInternalReview(ctx.actor, { reviewId: review.id });
    await expectDomainError(
      upsertScenario(ctx.actor, {
        reviewId: review.id,
        scenarioId: rec.id,
        label: "Act now",
        kind: "recommended",
        totalValue: "2.00",
      }),
      "VO_RECOMMENDATION_ISSUED",
    );
  });

  it("requires the recommendation to use the recommended scenario, and a decision to follow an issued recommendation", async () => {
    const ctx = await compact();
    const review = await draftReview(ctx);
    const alt = await upsertScenario(ctx.actor, {
      reviewId: review.id,
      label: "Alt",
      kind: "alternative",
      totalValue: "1.00",
    });
    await expectDomainError(
      saveRecommendation(ctx.actor, { reviewId: review.id, scenarioId: alt.id, narrative: "n" }),
      "VO_RECOMMENDATION_SCENARIO",
    );
    await expectDomainError(
      recordDecision(ctx.actor, {
        reviewId: review.id,
        selectedScenarioId: alt.id,
        decidedByPersonId: ctx.vco,
        decidedOn: today,
      }),
      "VO_RECOMMENDATION_REQUIRED",
    );
  });

  it("requires the selected scenario to belong to the same review", async () => {
    const ctx = await compact();
    const first = await reviewWithOptions(ctx);
    const second = await draftReview(ctx);
    const rec2 = await upsertScenario(ctx.actor, {
      reviewId: second.id,
      label: "Act",
      kind: "recommended",
      totalValue: "1.00",
    });
    await saveRecommendation(ctx.actor, { reviewId: second.id, scenarioId: rec2.id, narrative: "n" });
    await issueAfterInternalReview(ctx.actor, { reviewId: second.id });
    await expectDomainError(
      recordDecision(ctx.actor, {
        reviewId: second.id,
        selectedScenarioId: first.delay.id,
        decidedByPersonId: ctx.vco,
        decidedOn: today,
      }),
      "VO_REFERENCE_VIOLATION",
    );
  });

  it("computes client-elected difference exactly (Horizon: 14.9 − 15.3 = −0.4m)", () => {
    expect(clientElectedDifference("14900000.00", "15300000.00")).toBe("-400000.00");
    expect(clientElectedDifference("0.30", "0.10")).toBe("0.20");
  });

  it("has no automatic cost-of-delay calculation: scenario totals are only ever what the consultant entered", async () => {
    const ctx = await compact();
    const review = await draftReview(ctx);
    await upsertScenario(ctx.actor, { reviewId: review.id, label: "Delay", kind: "alternative", totalValue: "123.45" });
    const [row] = await db().select().from(schema.scenario).where(eq(schema.scenario.assuranceReviewId, review.id));
    expect(row!.totalValue).toBe("123.45");
    const columns = Object.keys(row!);
    expect(columns.some((c) => /delay|cost/i.test(c))).toBe(false);
  });
});

describe("Value Change → V2", () => {
  async function changeReady(ctx: Ctx) {
    const { review, decision } = await decided(ctx);
    const { change, version } = await createValueChange(ctx.actor, {
      projectId: ctx.project.id,
      code: "VC-001",
      statedChangeAmount: "-100000.00",
      reason: "Client elected to delay",
      assuranceReviewId: review.id,
      decisionId: decision.id,
    });
    const [vA] = await db()
      .select()
      .from(schema.valueDriverVersion)
      .where(
        and(
          eq(schema.valueDriverVersion.valueCaseVersionId, version.id),
          eq(schema.valueDriverVersion.valueDriverId, ctx.A),
        ),
      );
    return { review, decision, change, v2: version, v2DriverA: vA! };
  }

  it("copies V1 forward into a draft V2 and never rewrites V1", async () => {
    const ctx = await compact();
    const { v2, v2DriverA } = await changeReady(ctx);
    expect(v2).toMatchObject({ versionNumber: 2, status: "draft", basedOnVersionId: ctx.v1.id });
    const v2Drivers = await db()
      .select()
      .from(schema.valueDriverVersion)
      .where(eq(schema.valueDriverVersion.valueCaseVersionId, v2.id));
    expect(v2Drivers).toHaveLength(3);
    await updateDriverVersion(ctx.actor, { driverVersionId: v2DriverA.id, financialValue: "900000.00" });
    const [v1A] = await db()
      .select()
      .from(schema.valueDriverVersion)
      .where(
        and(
          eq(schema.valueDriverVersion.valueCaseVersionId, ctx.v1.id),
          eq(schema.valueDriverVersion.valueDriverId, ctx.A),
        ),
      );
    expect(v1A!.financialValue).toBe("1000000.00");
  });

  it("authorises V2 atomically: V1 superseded, V2 the only authorised version, new reviews against V2, old reviews still V1", async () => {
    const ctx = await compact();
    const { review, change, v2, v2DriverA } = await changeReady(ctx);
    await updateDriverVersion(ctx.actor, { driverVersionId: v2DriverA.id, financialValue: "900000.00" });
    await proposeValueChange(ctx.actor, { changeId: change.id });
    const authorised = await authoriseValueChange(ctx.actor, {
      changeId: change.id,
      authorisedByPersonId: ctx.vco,
      authorisedOn: today,
      authorisationEvidenceId: ctx.evidence.id,
    });
    expect(authorised.status).toBe("authorised");
    const versions = await db()
      .select({ n: schema.valueCaseVersion.versionNumber, s: schema.valueCaseVersion.status })
      .from(schema.valueCaseVersion)
      .where(eq(schema.valueCaseVersion.projectId, ctx.project.id))
      .orderBy(schema.valueCaseVersion.versionNumber);
    expect(versions).toEqual([
      { n: 1, s: "superseded" },
      { n: 2, s: "authorised" },
    ]);
    const summary = await getValuePositionSummary(ctx.project.id);
    expect(summary.authorised!.id).toBe(v2.id);
    expect(summary.authorisedTotal).toBe("1400000.00");

    const next = await createReview(ctx.actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate: today });
    expect(next.againstVersionId).toBe(v2.id);
    const [old] = await db().select().from(schema.assuranceReview).where(eq(schema.assuranceReview.id, review.id));
    expect(old!.againstVersionId).toBe(ctx.v1.id);

    // V1 stays immutable after being superseded
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.updateDriverVersion, (tx) =>
        tx.update(schema.valueCaseVersion).set({ title: "x" }).where(eq(schema.valueCaseVersion.id, ctx.v1.id)),
      ),
      "VO_VERSION_IMMUTABLE",
    );
  });

  it("rejects authorisation by a non-VCO and without evidence, rolling back completely", async () => {
    const ctx = await compact();
    const { change, v2DriverA } = await changeReady(ctx);
    await updateDriverVersion(ctx.actor, { driverVersionId: v2DriverA.id, financialValue: "900000.00" });
    await proposeValueChange(ctx.actor, { changeId: change.id });
    const { person: other } = await addStakeholder(ctx.actor, { projectId: ctx.project.id, name: "Not the VCO" });
    await expectDomainError(
      authoriseValueChange(ctx.actor, {
        changeId: change.id,
        authorisedByPersonId: other.id,
        authorisedOn: today,
        authorisationEvidenceId: ctx.evidence.id,
      }),
      "VO_NOT_VCO",
    );
    // Beneath the command layer: the DB refuses a non-VCO, and missing evidence.
    const attempt = (values: Record<string, unknown>) =>
      asCommand(ctx.actor, COMMANDS.authoriseValueChange, async (tx) => {
        await tx
          .update(schema.valueChange)
          .set({
            status: "authorised",
            authorisedOn: today,
            authorisationRecordedBy: ctx.actor.userId,
            authorisationRecordedAt: new Date(),
            ...values,
          })
          .where(eq(schema.valueChange.id, change.id));
        await tx
          .update(schema.valueCaseVersion)
          .set({ status: "superseded", supersededAt: new Date() })
          .where(eq(schema.valueCaseVersion.id, ctx.v1.id));
        throw new Error("should not reach");
      });
    await expectDomainError(
      attempt({ authorisedByPersonId: other.id, authorisationEvidenceId: ctx.evidence.id }),
      "VO_NOT_VCO",
    );
    await expectDomainError(attempt({ authorisedByPersonId: ctx.vco }), "VO_CHECK_VIOLATION");
    // A failure after partial writes rolls everything back.
    await expect(
      asCommand(ctx.actor, COMMANDS.authoriseValueChange, async (tx) => {
        await tx
          .update(schema.valueChange)
          .set({
            status: "authorised",
            authorisedOn: today,
            authorisedByPersonId: ctx.vco,
            authorisationEvidenceId: ctx.evidence.id,
            authorisationRecordedBy: ctx.actor.userId,
            authorisationRecordedAt: new Date(),
          })
          .where(eq(schema.valueChange.id, change.id));
        await tx
          .update(schema.valueCaseVersion)
          .set({ status: "superseded", supersededAt: new Date() })
          .where(eq(schema.valueCaseVersion.id, ctx.v1.id));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const states = await db()
      .select({ n: schema.valueCaseVersion.versionNumber, s: schema.valueCaseVersion.status })
      .from(schema.valueCaseVersion)
      .where(eq(schema.valueCaseVersion.projectId, ctx.project.id))
      .orderBy(schema.valueCaseVersion.versionNumber);
    expect(states).toEqual([
      { n: 1, s: "authorised" },
      { n: 2, s: "proposed" },
    ]);
    const [c] = await db().select().from(schema.valueChange).where(eq(schema.valueChange.id, change.id));
    expect(c!.status).toBe("proposed");
  });

  it("cannot authorise V2 except through an approved Value Change", async () => {
    const ctx = await compact();
    const { change, v2, v2DriverA } = await changeReady(ctx);
    await updateDriverVersion(ctx.actor, { driverVersionId: v2DriverA.id, financialValue: "900000.00" });
    await proposeValueChange(ctx.actor, { changeId: change.id });
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.authoriseValueChange, async (tx) => {
        await tx
          .update(schema.valueCaseVersion)
          .set({ status: "superseded", supersededAt: new Date() })
          .where(eq(schema.valueCaseVersion.id, ctx.v1.id));
      }),
      "VO_VALUE_CHANGE_REQUIRED",
    );
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.authoriseInitialVersion, (tx) =>
        tx
          .update(schema.valueCaseVersion)
          .set({
            status: "authorised",
            authorisedOn: today,
            authorisedByPersonId: ctx.vco,
            authorisationEvidenceId: ctx.evidence.id,
            authorisationRecordedBy: ctx.actor.userId,
            authorisationRecordedAt: new Date(),
          })
          .where(eq(schema.valueCaseVersion.id, v2.id)),
      ),
      "VO_VALUE_CHANGE_REQUIRED",
    );
  });

  it("requires the proposed drivers to reconcile to the stated change", async () => {
    const ctx = await compact();
    const { change } = await changeReady(ctx); // stated −0.1m, drivers unchanged
    await proposeValueChange(ctx.actor, { changeId: change.id });
    const err = await expectDomainError(
      authoriseValueChange(ctx.actor, {
        changeId: change.id,
        authorisedByPersonId: ctx.vco,
        authorisedOn: today,
        authorisationEvidenceId: ctx.evidence.id,
      }),
      "VO_CHANGE_NOT_RECONCILED",
    );
    expect(err.message).toMatch(/states -100000/);
  });

  it("supports return, rejection and withdrawal, preserving closed changes and versions", async () => {
    const ctx = await compact();
    const { change, v2 } = await changeReady(ctx);
    await proposeValueChange(ctx.actor, { changeId: change.id });
    await returnValueChange(ctx.actor, { changeId: change.id });
    await proposeValueChange(ctx.actor, { changeId: change.id });
    await rejectValueChange(ctx.actor, { changeId: change.id, closureNote: "VCO declined" });
    const [v] = await db().select().from(schema.valueCaseVersion).where(eq(schema.valueCaseVersion.id, v2.id));
    expect(v!.status).toBe("rejected");
    await expectDomainError(
      withdrawValueChange(ctx.actor, { changeId: change.id, closureNote: "x" }),
      "VO_INVALID_TRANSITION",
    );

    // A new change can follow; withdrawing it closes its draft version too.
    const second = await createValueChange(ctx.actor, { projectId: ctx.project.id, code: "VC-002" });
    expect(second.version.versionNumber).toBe(3);
    await withdrawValueChange(ctx.actor, { changeId: second.change.id, closureNote: "Superseded by events" });
    const [v3] = await db()
      .select()
      .from(schema.valueCaseVersion)
      .where(eq(schema.valueCaseVersion.id, second.version.id));
    expect(v3!.status).toBe("withdrawn");
  });

  it("keeps Value Change codes unique per Value Case, and one open change at a time", async () => {
    const ctx = await compact();
    const { change } = await changeReady(ctx);
    await expectDomainError(
      createValueChange(ctx.actor, { projectId: ctx.project.id, code: "VC-009" }),
      "VO_VALUE_CHANGE_OPEN",
    );
    await withdrawValueChange(ctx.actor, { changeId: change.id, closureNote: "x" });
    await expectDomainError(
      createValueChange(ctx.actor, { projectId: ctx.project.id, code: "VC-001" }),
      "VO_UNIQUE_VIOLATION",
    );
  });

  it("records audit events for the Value Change lifecycle", async () => {
    const ctx = await compact();
    const { change, v2DriverA } = await changeReady(ctx);
    await updateDriverVersion(ctx.actor, { driverVersionId: v2DriverA.id, financialValue: "900000.00" });
    await proposeValueChange(ctx.actor, { changeId: change.id });
    await authoriseValueChange(ctx.actor, {
      changeId: change.id,
      authorisedByPersonId: ctx.vco,
      authorisedOn: today,
      authorisationEvidenceId: ctx.evidence.id,
    });
    const events = await db()
      .select({ command: schema.auditEvent.command, table: schema.auditEvent.tableName })
      .from(schema.auditEvent)
      .where(
        sql`${schema.auditEvent.command} = 'valueChange.authorise' and coalesce(${schema.auditEvent.newRow}, ${schema.auditEvent.oldRow})->>'project_id' = ${ctx.project.id}`,
      );
    expect(events.map((e) => e.table).sort()).toEqual(["value_case_version", "value_case_version", "value_change"]);
  });
});

describe("Project Horizon Phase 3 acceptance", () => {
  it("records the known options, decision and proposed VC-002 without inventing missing facts", async () => {
    const actor = await newActor();
    const { project, review, valueChange, v1 } = await seedHorizon(actor, { projectCode: `HORIZON-${uid()}` });
    const resp = await getReviewResponse(project.id, review.id);
    const byKind = Object.fromEntries(resp.scenarios.map((s) => [s.kind, s.totalValue]));
    expect(byKind).toEqual({ current: "14700000.00", recommended: "15300000.00", alternative: "14900000.00" });
    expect(resp.recommendation!.issuedAt).not.toBeNull();
    expect(resp.recommendation!.scenario!.totalValue).toBe("15300000.00");
    expect(resp.decision!.scenario!.totalValue).toBe("14900000.00");
    expect(resp.decision!.clientElectedDifference).toBe(HORIZON.response.clientElectedDifference);

    // Vendor sequencing leakage: recorded, labelled, and deliberately unassessed.
    expect(resp.leakage).toHaveLength(1);
    expect(resp.leakage[0]!.leakage).toMatchObject({ code: "VL-001", title: "Vendor sequencing" });
    // Phase 4D.1: finalising Review 1 snapshotted the open matter — with no formal amounts (not yet quantified).
    expect(resp.leakage[0]!.assessments).toHaveLength(1);
    expect(resp.leakage[0]!.assessments[0]).toMatchObject({ totalAmount: null, unrecoverableAmount: null });
    expect(resp.leakage[0]!.thisReview!.amounts).toBeNull();
    expect(resp.leakageBasis).toBe("snapshot");
    expect(resp.leakage[0]!.leakage.description).toMatch(/\[FIXTURE PLACEHOLDER\].*do not reconcile/);

    // VC-002: proposed, −$0.6m against V1 $15.5m → $14.9m if authorised; not yet reconcilable.
    const d = await getValueChangeDetail(project.id, valueChange.id);
    expect(d!.change).toMatchObject({ code: "VC-002", status: "proposed", statedChangeAmount: "-600000.00" });
    expect(d!.fromVersion.id).toBe(v1.id);
    expect(d!.fromTotal).toBe("15500000.00");
    expect(d!.projectedFromStated).toBe(HORIZON.response.valueChange.v2IfAuthorised);
    expect(d!.reconciled).toBe(false);
    expect(d!.toTotal).toBe("15500000.00"); // no per-driver allocation invented
    const evidence = await recordEvidence(actor, {
      projectId: project.id,
      code: "E-VC002",
      title: "Test authorisation record",
    });
    const err = await expectDomainError(
      authoriseValueChange(actor, {
        changeId: valueChange.id,
        authorisedByPersonId: d!.vco!.id,
        authorisedOn: today,
        authorisationEvidenceId: evidence.id,
      }),
      "VO_CHANGE_NOT_RECONCILED",
    );
    expect(err.message).toMatch(/changes the financial total by 0.00 but the Value Change states -600000.00/);
    // V1 remains the version in force; the historical review stays on V1.
    const summary = await getValuePositionSummary(project.id);
    expect(summary.authorised!.id).toBe(v1.id);
    expect(review.againstVersionId).toBe(v1.id);
  });
});
