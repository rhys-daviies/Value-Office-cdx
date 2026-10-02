import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createReview, finaliseReview, upsertValuePositions } from "@/server/commands/assurance";
import { recordEvidence } from "@/server/commands/evidence";
import { COMMANDS } from "@/server/commands/names";
import { issueRecommendation, removeScenario, saveRecommendation, upsertScenario } from "@/server/commands/options";
import type { Actor } from "@/server/commands/run";
import { addStakeholder, setValueCaseOwner } from "@/server/commands/stakeholders";
import {
  removeForecastPoint,
  removePlanPoint,
  removeScenarioPoint,
  setForecastPoint,
  setPlanPoint,
  setScenarioPoint,
  setVersionBasis,
} from "@/server/commands/trajectory";
import {
  addValueDriver,
  authoriseInitialVersion,
  createDraftVersion,
  proposeVersion,
  returnVersionToDraft,
  updateDriverVersion,
} from "@/server/commands/value-case";
import { authoriseValueChange, createValueChange, proposeValueChange } from "@/server/commands/value-change";
import { db, schema } from "@/server/db/client";
import { getScenarioTrajectories, getValueTrajectory } from "@/server/queries/trajectory";

import { asCommand, expectDomainError, newActor, newProject, proposedV1, sql } from "../support/fixtures";

// Phase 4D.9C: governed Value Trajectory domain. Contract: docs/architecture.md.

const today = new Date().toISOString().slice(0, 10);
const START = "2026-01-01";
const END = "2028-12-31";

/** A project with a VCO and a DRAFT V1 (VD-01 $1.0m, VD-02 $0.5m, VD-03 non-financial). */
async function draftV1(actor: Actor) {
  const { project } = await newProject(actor);
  const { person: vco } = await addStakeholder(actor, { projectId: project.id, name: "Val Owner" });
  await setValueCaseOwner(actor, { projectId: project.id, personId: vco.id });
  const v1 = await createDraftVersion(actor, { projectId: project.id, title: "Re-Qualified Value Case" });
  const a = await addValueDriver(actor, {
    versionId: v1.id,
    code: "VD-01",
    name: "Alpha",
    financialValue: "1000000.00",
  });
  const b = await addValueDriver(actor, { versionId: v1.id, code: "VD-02", name: "Beta", financialValue: "500000.00" });
  await addValueDriver(actor, { versionId: v1.id, code: "VD-03", name: "Gamma" });
  const evidence = await recordEvidence(actor, { projectId: project.id, code: "E-AUTH", title: "Authorisation" });
  return { project, vco, v1, A: a.driver.id, B: b.driver.id, evidence };
}

/** Classified cumulative V1 with a reconciled plan, proposed and authorised. */
async function authorisedPlanned(actor: Actor) {
  const ctx = await draftV1(actor);
  await setVersionBasis(actor, {
    versionId: ctx.v1.id,
    valueBasisKind: "cumulative_benefit",
    valuePeriodStart: START,
    valuePeriodEnd: END,
  });
  await setPlanPoint(actor, { versionId: ctx.v1.id, asOf: "2027-06-30", value: "500000.00" });
  await setPlanPoint(actor, { versionId: ctx.v1.id, asOf: END, value: "1500000.00" });
  await proposeVersion(actor, { versionId: ctx.v1.id });
  await authoriseInitialVersion(actor, {
    versionId: ctx.v1.id,
    authorisedByPersonId: ctx.vco.id,
    authorisedOn: today,
    authorisationEvidenceId: ctx.evidence.id,
  });
  return ctx;
}

/** Authorised planned V1 + a draft review with complete forecast ($0.9m + $0.4m = $1.3m). */
async function draftReview(actor: Actor) {
  const ctx = await authorisedPlanned(actor);
  const review = await createReview(actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate: today });
  await upsertValuePositions(actor, {
    reviewId: review.id,
    positions: [
      { valueDriverId: ctx.A, currentForecast: "900000.00", realisedValue: "100000.00" },
      { valueDriverId: ctx.B, currentForecast: "400000.00", realisedValue: "50000.00" },
    ],
  });
  const gamma = (
    await db().select().from(schema.valueDriver).where(eq(schema.valueDriver.projectId, ctx.project.id))
  ).find((d) => d.code === "VD-03")!;
  await upsertValuePositions(actor, {
    reviewId: review.id,
    positions: [{ valueDriverId: gamma.id, forecastRationale: "On track" }],
  });
  return { ...ctx, review };
}

const pointsOf = (column: "valueCaseVersionId" | "assuranceReviewId" | "scenarioId", id: string) =>
  db().select().from(schema.valueTrajectoryPoint).where(eq(schema.valueTrajectoryPoint[column], id));

describe("A. basis kinds", () => {
  it("cumulative and run-rate accept plan points; NPV, other and unclassified reject them", async () => {
    const actor = await newActor();
    for (const kind of ["cumulative_benefit", "annual_run_rate"] as const) {
      const { v1 } = await draftV1(actor);
      await setVersionBasis(actor, {
        versionId: v1.id,
        valueBasisKind: kind,
        valuePeriodStart: START,
        valuePeriodEnd: END,
      });
      await setPlanPoint(actor, { versionId: v1.id, asOf: END, value: "1500000.00" });
      expect(await pointsOf("valueCaseVersionId", v1.id)).toHaveLength(1);
    }
    for (const kind of ["net_present_value", "other", null] as const) {
      const { v1 } = await draftV1(actor);
      await setVersionBasis(actor, {
        versionId: v1.id,
        valueBasisKind: kind,
        valuePeriodStart: START,
        valuePeriodEnd: END,
      });
      await expectDomainError(
        setPlanPoint(actor, { versionId: v1.id, asOf: END, value: "1500000.00" }),
        "VO_TRAJECTORY_BASIS",
      );
    }
  });
});

describe("B. version basis and period", () => {
  it("valid dates; rejects end before start; locks at proposal; legacy null stays valid", async () => {
    const actor = await newActor();
    const { v1 } = await draftV1(actor);
    await expectDomainError(
      setVersionBasis(actor, {
        versionId: v1.id,
        valueBasisKind: "cumulative_benefit",
        valuePeriodStart: END,
        valuePeriodEnd: START,
      }),
      "VO_INVALID_INPUT",
    );
    // Beneath the command layer, the check constraint holds too.
    await expectDomainError(
      asCommand(actor, COMMANDS.setVersionBasis, (tx) =>
        tx
          .update(schema.valueCaseVersion)
          .set({ valuePeriodStart: END, valuePeriodEnd: START })
          .where(eq(schema.valueCaseVersion.id, v1.id)),
      ),
      "VO_CHECK_VIOLATION",
    );
    // Legacy: an unclassified version with no period proposes and authorises exactly as before.
    const legacy = await proposedV1(actor);
    expect(legacy.v1.valueBasisKind).toBeNull();
    await authoriseInitialVersion(actor, {
      versionId: legacy.v1.id,
      authorisedByPersonId: legacy.vco.id,
      authorisedOn: today,
      authorisationEvidenceId: legacy.evidence.id,
    });
    // Locked from proposal: neither the command nor a raw write can change it.
    await expectDomainError(
      setVersionBasis(actor, {
        versionId: legacy.v1.id,
        valueBasisKind: "cumulative_benefit",
        valuePeriodStart: START,
        valuePeriodEnd: END,
      }),
      "VO_VERSION_IMMUTABLE",
    );
    await expectDomainError(
      asCommand(actor, COMMANDS.setVersionBasis, (tx) =>
        tx
          .update(schema.valueCaseVersion)
          .set({ valueBasisKind: "cumulative_benefit" })
          .where(eq(schema.valueCaseVersion.id, legacy.v1.id)),
      ),
      "VO_VERSION_IMMUTABLE",
    );
  });

  it("basis fields change only through valueCase.setVersionBasis; V0 cannot carry them", async () => {
    const actor = await newActor();
    const { v1 } = await draftV1(actor);
    await expectDomainError(
      asCommand(actor, COMMANDS.updateVersionDetails, (tx) =>
        tx
          .update(schema.valueCaseVersion)
          .set({ valueBasisKind: "cumulative_benefit" })
          .where(eq(schema.valueCaseVersion.id, v1.id)),
      ),
      "VO_WRONG_COMMAND",
    );
    // A version created with a basis outside valueChange.create — and V0 never carries one.
    await expectDomainError(
      asCommand(actor, COMMANDS.createInheritedBusinessCase, (tx) =>
        tx.insert(schema.valueCaseVersion).values({
          valueCaseId: v1.valueCaseId,
          projectId: v1.projectId,
          versionNumber: 0,
          kind: "inherited_business_case",
          title: "V0",
          createdBy: actor.userId,
          valueBasisKind: "cumulative_benefit",
        }),
      ),
      "VO_WRONG_COMMAND",
    );
  });
});

describe("C. plan points", () => {
  it("draft create, update, remove; duplicate date updates; outside period rejected", async () => {
    const actor = await newActor();
    const { v1 } = await draftV1(actor);
    await setVersionBasis(actor, {
      versionId: v1.id,
      valueBasisKind: "cumulative_benefit",
      valuePeriodStart: START,
      valuePeriodEnd: END,
    });
    const p = await setPlanPoint(actor, { versionId: v1.id, asOf: "2027-06-30", value: "400000.00", note: "Go-live" });
    const same = await setPlanPoint(actor, { versionId: v1.id, asOf: "2027-06-30", value: "450000.00" });
    expect(same.id).toBe(p.id);
    expect(same.value).toBe("450000.00");
    expect(await pointsOf("valueCaseVersionId", v1.id)).toHaveLength(1);
    // The unique index blocks a raw duplicate.
    await expectDomainError(
      asCommand(actor, COMMANDS.setPlanPoint, (tx) =>
        tx.insert(schema.valueTrajectoryPoint).values({
          projectId: v1.projectId,
          valueCaseVersionId: v1.id,
          asOf: "2027-06-30",
          value: "1.00",
          createdBy: actor.userId,
        }),
      ),
      "VO_UNIQUE_VIOLATION",
    );
    await expectDomainError(
      setPlanPoint(actor, { versionId: v1.id, asOf: "2029-01-01", value: "1.00" }),
      "VO_TRAJECTORY_DATE",
    );
    await expectDomainError(
      setPlanPoint(actor, { versionId: v1.id, asOf: "2025-12-31", value: "1.00" }),
      "VO_TRAJECTORY_DATE",
    );
    await removePlanPoint(actor, { pointId: p.id });
    expect(await pointsOf("valueCaseVersionId", v1.id)).toHaveLength(0);
  });

  it("V0 is rejected", async () => {
    const actor = await newActor();
    const { v1 } = await draftV1(actor);
    const [v0] = await asCommand(actor, COMMANDS.createInheritedBusinessCase, (tx) =>
      tx
        .insert(schema.valueCaseVersion)
        .values({
          valueCaseId: v1.valueCaseId,
          projectId: v1.projectId,
          versionNumber: 0,
          kind: "inherited_business_case",
          title: "Inherited",
          createdBy: actor.userId,
        })
        .returning(),
    );
    await expectDomainError(
      setPlanPoint(actor, { versionId: v0!.id, asOf: END, value: "1.00" }),
      "VO_TRAJECTORY_INHERITED_CASE",
    );
    await expectDomainError(
      setVersionBasis(actor, {
        versionId: v0!.id,
        valueBasisKind: "cumulative_benefit",
        valuePeriodStart: START,
        valuePeriodEnd: END,
      }),
      "VO_TRAJECTORY_INHERITED_CASE",
    );
  });

  it("proposal requires the period-end point to equal the version total; editable again if returned", async () => {
    const actor = await newActor();
    const { v1 } = await draftV1(actor);
    await setVersionBasis(actor, {
      versionId: v1.id,
      valueBasisKind: "cumulative_benefit",
      valuePeriodStart: START,
      valuePeriodEnd: END,
    });
    await setPlanPoint(actor, { versionId: v1.id, asOf: "2027-06-30", value: "500000.00" });
    await expectDomainError(proposeVersion(actor, { versionId: v1.id }), "VO_TRAJECTORY_NOT_RECONCILED"); // no end point
    await setPlanPoint(actor, { versionId: v1.id, asOf: END, value: "1499999.99" });
    await expectDomainError(proposeVersion(actor, { versionId: v1.id }), "VO_TRAJECTORY_NOT_RECONCILED"); // off by 0.01
    await setPlanPoint(actor, { versionId: v1.id, asOf: END, value: "1500000.00" });
    await proposeVersion(actor, { versionId: v1.id });
    // Frozen while proposed …
    await expectDomainError(
      setPlanPoint(actor, { versionId: v1.id, asOf: "2027-06-30", value: "1.00" }),
      "VO_TRAJECTORY_LOCKED",
    );
    // … editable again once returned to draft.
    await returnVersionToDraft(actor, { versionId: v1.id });
    await setPlanPoint(actor, { versionId: v1.id, asOf: "2027-06-30", value: "600000.00" });
  });

  it("authorisation re-checks reconciliation; an authorised plan is immutable", async () => {
    const actor = await newActor();
    const ctx = await authorisedPlanned(actor);
    const [end] = (await pointsOf("valueCaseVersionId", ctx.v1.id)).filter((p) => p.asOf === END);
    await expectDomainError(removePlanPoint(actor, { pointId: end!.id }), "VO_TRAJECTORY_LOCKED");
    await expectDomainError(
      asCommand(actor, COMMANDS.setPlanPoint, (tx) =>
        tx
          .update(schema.valueTrajectoryPoint)
          .set({ value: "1.00" })
          .where(eq(schema.valueTrajectoryPoint.id, end!.id)),
      ),
      "VO_TRAJECTORY_LOCKED",
    );
    // Authorisation gate: a proposed version whose plan no longer reconciles (raw write beneath the guards) is refused.
    const other = await draftV1(actor);
    await setVersionBasis(actor, {
      versionId: other.v1.id,
      valueBasisKind: "cumulative_benefit",
      valuePeriodStart: START,
      valuePeriodEnd: END,
    });
    await setPlanPoint(actor, { versionId: other.v1.id, asOf: END, value: "1500000.00" });
    await proposeVersion(actor, { versionId: other.v1.id });
    // Beneath every guard (transaction-local; triggers skipped for this write only).
    await asCommand(actor, COMMANDS.setPlanPoint, async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx
        .update(schema.valueTrajectoryPoint)
        .set({ value: "1.00" })
        .where(eq(schema.valueTrajectoryPoint.valueCaseVersionId, other.v1.id));
    });
    await expectDomainError(
      authoriseInitialVersion(actor, {
        versionId: other.v1.id,
        authorisedByPersonId: other.vco.id,
        authorisedOn: today,
        authorisationEvidenceId: other.evidence.id,
      }),
      "VO_TRAJECTORY_NOT_RECONCILED",
    );
  });

  it("phasing is optional: a classified version with no points proposes and authorises", async () => {
    const actor = await newActor();
    const { v1, vco, evidence, project } = await draftV1(actor);
    await setVersionBasis(actor, {
      versionId: v1.id,
      valueBasisKind: "annual_run_rate",
      valuePeriodStart: START,
      valuePeriodEnd: END,
    });
    await proposeVersion(actor, { versionId: v1.id });
    await authoriseInitialVersion(actor, {
      versionId: v1.id,
      authorisedByPersonId: vco.id,
      authorisedOn: today,
      authorisationEvidenceId: evidence.id,
    });
    const t = await getValueTrajectory(project.id);
    expect(t).toMatchObject({ status: "phasing_not_entered", measure: "run_rate", realised: [], realisedOrigin: null });
  });
});

describe("D. formal forecast points", () => {
  it("draft editing; on/before review date and outside period rejected; terminal must equal the formal forecast", async () => {
    const actor = await newActor();
    const { review } = await draftReview(actor);
    await expectDomainError(
      setForecastPoint(actor, { reviewId: review.id, asOf: today, value: "1.00" }),
      "VO_TRAJECTORY_DATE",
    );
    await expectDomainError(
      setForecastPoint(actor, { reviewId: review.id, asOf: "2029-06-30", value: "1.00" }),
      "VO_TRAJECTORY_DATE",
    );
    const mid = await setForecastPoint(actor, { reviewId: review.id, asOf: "2027-12-31", value: "700000.00" });
    await setForecastPoint(actor, { reviewId: review.id, asOf: END, value: "1200000.00" });
    await expectDomainError(finaliseReview(actor, { reviewId: review.id }), "VO_TRAJECTORY_NOT_RECONCILED");
    await setForecastPoint(actor, { reviewId: review.id, asOf: END, value: "1300000.00" });
    await removeForecastPoint(actor, { pointId: mid.id });
    await finaliseReview(actor, { reviewId: review.id });
    // Immutable after finalisation.
    await expectDomainError(
      setForecastPoint(actor, { reviewId: review.id, asOf: "2027-12-31", value: "1.00" }),
      "VO_TRAJECTORY_LOCKED",
    );
  });

  it("an incomplete formal forecast cannot keep points; without points the review finalises as today", async () => {
    const actor = await newActor();
    const ctx = await draftReview(actor);
    await setForecastPoint(actor, { reviewId: ctx.review.id, asOf: END, value: "1300000.00" });
    await upsertValuePositions(actor, {
      reviewId: ctx.review.id,
      positions: [{ valueDriverId: ctx.B, forecastNotAssessed: true, forecastRationale: "Awaiting data" }],
    });
    await expectDomainError(finaliseReview(actor, { reviewId: ctx.review.id }), "VO_TRAJECTORY_FORECAST_INCOMPLETE");
    const [pt] = await pointsOf("assuranceReviewId", ctx.review.id);
    await removeForecastPoint(actor, { pointId: pt!.id });
    await finaliseReview(actor, { reviewId: ctx.review.id });
  });

  it("forecast points need a trajectory-capable measured-against version", async () => {
    const actor = await newActor();
    const legacy = await proposedV1(actor);
    await authoriseInitialVersion(actor, {
      versionId: legacy.v1.id,
      authorisedByPersonId: legacy.vco.id,
      authorisedOn: today,
      authorisationEvidenceId: legacy.evidence.id,
    });
    const review = await createReview(actor, { projectId: legacy.project.id, trigger: "ad_hoc", reviewDate: today });
    await expectDomainError(
      setForecastPoint(actor, { reviewId: review.id, asOf: "2027-12-31", value: "1.00" }),
      "VO_TRAJECTORY_BASIS",
    );
  });
});

describe("E. option points", () => {
  it("terminal reconciliation at recommendation issue, then frozen; re-checked at finalisation", async () => {
    const actor = await newActor();
    const { review } = await draftReview(actor);
    const act = await upsertScenario(actor, {
      reviewId: review.id,
      label: "Act now",
      kind: "recommended",
      totalValue: "1450000.00",
    });
    const delay = await upsertScenario(actor, {
      reviewId: review.id,
      label: "Delay 3 months",
      kind: "alternative",
      totalValue: "1350000.00",
    });
    await setScenarioPoint(actor, { scenarioId: act.id, asOf: "2027-12-31", value: "900000.00" });
    await setScenarioPoint(actor, { scenarioId: act.id, asOf: END, value: "1400000.00" });
    await saveRecommendation(actor, { reviewId: review.id, scenarioId: act.id, narrative: "Act now" });
    await expectDomainError(issueRecommendation(actor, { reviewId: review.id }), "VO_TRAJECTORY_NOT_RECONCILED");
    await setScenarioPoint(actor, { scenarioId: act.id, asOf: END, value: "1450000.00" });
    await issueRecommendation(actor, { reviewId: review.id });
    await expectDomainError(
      setScenarioPoint(actor, { scenarioId: delay.id, asOf: END, value: "1350000.00" }),
      "VO_RECOMMENDATION_ISSUED",
    );
    const [pt] = await pointsOf("scenarioId", act.id);
    await expectDomainError(removeScenarioPoint(actor, { pointId: pt!.id }), "VO_RECOMMENDATION_ISSUED");
    await finaliseReview(actor, { reviewId: review.id });

    const paths = (await getScenarioTrajectories(review.projectId, review.id))!;
    expect(paths.options.map((o) => [o.label, o.recommended, o.points.length])).toEqual([
      ["Act now", true, 2],
      ["Delay 3 months", false, 0],
    ]);
  });

  it("finalisation enforces option reconciliation where no recommendation was issued; removing an option removes its path", async () => {
    const actor = await newActor();
    const { review } = await draftReview(actor);
    const opt = await upsertScenario(actor, {
      reviewId: review.id,
      label: "No action",
      kind: "no_action",
      totalValue: "1100000.00",
    });
    await setScenarioPoint(actor, { scenarioId: opt.id, asOf: END, value: "1000000.00" });
    await expectDomainError(finaliseReview(actor, { reviewId: review.id }), "VO_TRAJECTORY_NOT_RECONCILED");
    await removeScenario(actor, { scenarioId: opt.id });
    expect(await pointsOf("scenarioId", opt.id)).toHaveLength(0);
    await finaliseReview(actor, { reviewId: review.id });
  });
});

describe("F. Value Change", () => {
  it("copies basis, period and plan; earlier version unchanged; phasing-only $0 change authorises", async () => {
    const actor = await newActor();
    const ctx = await authorisedPlanned(actor);
    const before = await pointsOf("valueCaseVersionId", ctx.v1.id);
    const { change, version: v2 } = await createValueChange(actor, {
      projectId: ctx.project.id,
      code: "VC-001",
      reason: "Re-phase delivery",
      statedChangeAmount: "0.00",
    });
    expect(v2).toMatchObject({ valueBasisKind: "cumulative_benefit", valuePeriodStart: START, valuePeriodEnd: END });
    const copied = await pointsOf("valueCaseVersionId", v2.id);
    expect(copied.map((p) => [p.asOf, p.value])).toEqual(before.map((p) => [p.asOf, p.value]));
    expect(copied.every((p) => !before.some((b) => b.id === p.id))).toBe(true);

    // Re-phase only: same total, earlier delivery point moved.
    const mid = copied.find((p) => p.asOf === "2027-06-30")!;
    await removePlanPoint(actor, { pointId: mid.id });
    await setPlanPoint(actor, { versionId: v2.id, asOf: "2027-09-30", value: "350000.00" });
    await proposeValueChange(actor, { changeId: change.id });
    const ev = await recordEvidence(actor, { projectId: ctx.project.id, code: "E-VC1", title: "VCO approval" });
    await authoriseValueChange(actor, {
      changeId: change.id,
      authorisedByPersonId: ctx.vco.id,
      authorisedOn: today,
      authorisationEvidenceId: ev.id,
    });
    // V1's plan is untouched and still visible as history.
    const after = await pointsOf("valueCaseVersionId", ctx.v1.id);
    expect(after.map((p) => [p.id, p.asOf, p.value])).toEqual(before.map((p) => [p.id, p.asOf, p.value]));
    const t = await getValueTrajectory(ctx.project.id);
    expect(t.status).toBe("ready");
    expect(t.plans.map((p) => [p.versionNumber, p.status, p.points.map((x) => x.asOf)])).toEqual([
      [2, "authorised", ["2027-09-30", END]],
      [1, "superseded", ["2027-06-30", END]],
    ]);
  });

  it("a classified basis kind cannot change; the period may change; a legacy case adopts through a Value Change", async () => {
    const actor = await newActor();
    const ctx = await authorisedPlanned(actor);
    const { version: v2 } = await createValueChange(actor, { projectId: ctx.project.id, code: "VC-001", reason: "x" });
    await expectDomainError(
      setVersionBasis(actor, {
        versionId: v2.id,
        valueBasisKind: "net_present_value",
        valuePeriodStart: START,
        valuePeriodEnd: END,
      }),
      "VO_VALUE_BASIS_KIND_CHANGE",
    );
    await expectDomainError(
      setVersionBasis(actor, { versionId: v2.id, valueBasisKind: null, valuePeriodStart: START, valuePeriodEnd: END }),
      "VO_VALUE_BASIS_KIND_CHANGE",
    );
    // Extending the period is a governed change on the draft (plan must then reconcile on the new end).
    await setVersionBasis(actor, {
      versionId: v2.id,
      valueBasisKind: "cumulative_benefit",
      valuePeriodStart: START,
      valuePeriodEnd: "2029-06-30",
    });
    expect((await pointsOf("valueCaseVersionId", ctx.v1.id)).length).toBe(2);

    // Legacy: authorised unclassified V1 → V2 classifies, phases and authorises with a $0 stated change.
    const legacy = await proposedV1(actor);
    await authoriseInitialVersion(actor, {
      versionId: legacy.v1.id,
      authorisedByPersonId: legacy.vco.id,
      authorisedOn: today,
      authorisationEvidenceId: legacy.evidence.id,
    });
    const adopt = await createValueChange(actor, {
      projectId: legacy.project.id,
      code: "VC-001",
      reason: "Adopt trajectory",
      statedChangeAmount: "0.00",
    });
    expect(adopt.version.valueBasisKind).toBeNull();
    await setVersionBasis(actor, {
      versionId: adopt.version.id,
      valueBasisKind: "cumulative_benefit",
      valuePeriodStart: START,
      valuePeriodEnd: END,
    });
    await setPlanPoint(actor, { versionId: adopt.version.id, asOf: END, value: "4800000.00" });
    await proposeValueChange(actor, { changeId: adopt.change.id });
    const ev = await recordEvidence(actor, { projectId: legacy.project.id, code: "E-VC1", title: "VCO approval" });
    await authoriseValueChange(actor, {
      changeId: adopt.change.id,
      authorisedByPersonId: legacy.vco.id,
      authorisedOn: today,
      authorisationEvidenceId: ev.id,
    });
    const [v1After] = await db()
      .select()
      .from(schema.valueCaseVersion)
      .where(eq(schema.valueCaseVersion.id, legacy.v1.id));
    expect(v1After).toMatchObject({ status: "superseded", valueBasisKind: null, valuePeriodStart: null });
    expect(await pointsOf("valueCaseVersionId", legacy.v1.id)).toHaveLength(0);
    expect((await getValueTrajectory(legacy.project.id)).status).toBe("ready");
  });

  it("a driver-level change still needs its plan to reconcile to the new total", async () => {
    const actor = await newActor();
    const ctx = await authorisedPlanned(actor);
    const { change, version: v2 } = await createValueChange(actor, {
      projectId: ctx.project.id,
      code: "VC-001",
      reason: "Rebase Alpha",
      statedChangeAmount: "-100000.00",
    });
    const [alpha] = await db()
      .select()
      .from(schema.valueDriverVersion)
      .where(
        and(
          eq(schema.valueDriverVersion.valueCaseVersionId, v2.id),
          eq(schema.valueDriverVersion.valueDriverId, ctx.A),
        ),
      );
    await updateDriverVersion(actor, { driverVersionId: alpha!.id, financialValue: "900000.00" });
    await expectDomainError(proposeValueChange(actor, { changeId: change.id }), "VO_TRAJECTORY_NOT_RECONCILED");
    await setPlanPoint(actor, { versionId: v2.id, asOf: END, value: "1400000.00" });
    await proposeValueChange(actor, { changeId: change.id });
  });
});

describe("G. audit and direct-write protection", () => {
  it("points are audited and refused outside the trajectory commands", async () => {
    const actor = await newActor();
    const { v1 } = await draftV1(actor);
    await setVersionBasis(actor, {
      versionId: v1.id,
      valueBasisKind: "cumulative_benefit",
      valuePeriodStart: START,
      valuePeriodEnd: END,
    });
    const p = await setPlanPoint(actor, { versionId: v1.id, asOf: END, value: "1500000.00" });
    const audit = await db()
      .select()
      .from(schema.auditEvent)
      .where(and(eq(schema.auditEvent.tableName, "value_trajectory_point"), eq(schema.auditEvent.rowId, p.id)));
    expect(audit.map((a) => [a.action, a.command])).toEqual([["INSERT", "trajectory.setPlanPoint"]]);

    const raw = {
      projectId: v1.projectId,
      valueCaseVersionId: v1.id,
      asOf: "2027-01-31",
      value: "1.00",
      createdBy: actor.userId,
    };
    await expectDomainError(
      asCommand(actor, COMMANDS.addValueDriver, (tx) => tx.insert(schema.valueTrajectoryPoint).values(raw)),
      "VO_WRONG_COMMAND",
    );
    await expectDomainError(
      asCommand(actor, COMMANDS.setForecastPoint, (tx) => tx.insert(schema.valueTrajectoryPoint).values(raw)),
      "VO_WRONG_COMMAND",
    );
    await expectDomainError(
      asCommand(actor, COMMANDS.setPlanPoint, (tx) =>
        tx.insert(schema.valueTrajectoryPoint).values({ ...raw, assuranceReviewId: v1.id }),
      ),
      "VO_CHECK_VIOLATION",
    ); // two parents
    await expectDomainError(
      asCommand(actor, COMMANDS.setPlanPoint, (tx) =>
        tx
          .update(schema.valueTrajectoryPoint)
          .set({ asOf: "2027-02-28" })
          .where(eq(schema.valueTrajectoryPoint.id, p.id)),
      ),
      "VO_FIELD_IMMUTABLE",
    );
    const err = await db()
      .insert(schema.valueTrajectoryPoint)
      .values(raw)
      .then(
        () => null,
        (e: Error & { cause?: Error }) => String(e.cause?.message ?? e.message),
      );
    expect(err).toMatch(/VO_NO_COMMAND_CONTEXT|VO_WRONG_COMMAND/);
  });
});

describe("H. legacy compatibility", () => {
  it("unclassified projects read safely and reviews without points finalise as before", async () => {
    const actor = await newActor();
    const legacy = await proposedV1(actor);
    expect((await getValueTrajectory(legacy.project.id)).status).toBe("no_authorised_version");
    await authoriseInitialVersion(actor, {
      versionId: legacy.v1.id,
      authorisedByPersonId: legacy.vco.id,
      authorisedOn: today,
      authorisationEvidenceId: legacy.evidence.id,
    });
    const review = await createReview(actor, { projectId: legacy.project.id, trigger: "ad_hoc", reviewDate: today });
    await upsertValuePositions(actor, {
      reviewId: review.id,
      positions: [{ valueDriverId: legacy.driver.id, currentForecast: "4500000.00", realisedValue: "10000.00" }],
    });
    await finaliseReview(actor, { reviewId: review.id });
    const t = await getValueTrajectory(legacy.project.id);
    expect(t).toMatchObject({
      status: "basis_not_classified",
      measure: null,
      realised: [],
      realisedOrigin: null,
      latestFormal: { sequence: 1, forecastTotal: "4500000.00", points: [], comparable: false },
    });
    expect(t.plans).toEqual([{ ...t.plans[0], points: [] }]);
  });

  it("read model: cumulative history, realised from comparable reviews, latest formal checkpoint distinct from today", async () => {
    const actor = await newActor();
    const { project, review } = await draftReview(actor);
    await setForecastPoint(actor, { reviewId: review.id, asOf: END, value: "1300000.00" });
    await finaliseReview(actor, { reviewId: review.id });
    const t = await getValueTrajectory(project.id);
    expect(t).toMatchObject({
      status: "ready",
      measure: "cumulative",
      inForce: {
        versionNumber: 1,
        valueBasisKind: "cumulative_benefit",
        valuePeriodStart: START,
        valuePeriodEnd: END,
        total: "1500000.00",
      },
      realisedOrigin: { asOf: START, value: "0.00" },
      realised: [{ sequence: 1, date: today, value: "150000.00", complete: true }],
      latestFormal: { sequence: 1, reviewDate: today, forecastTotal: "1300000.00", comparable: true },
    });
    expect(t.plans[0]!.points.map((p) => [p.asOf, p.value])).toEqual([
      ["2027-06-30", "500000.00"],
      [END, "1500000.00"],
    ]);
    expect(t.latestFormal!.points.map((p) => p.value)).toEqual(["1300000.00"]);
    expect(t.today).toBe(today);
  });
});
