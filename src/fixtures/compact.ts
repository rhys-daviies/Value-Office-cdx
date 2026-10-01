import { and, eq } from "drizzle-orm";

import { createReview, finaliseReview, upsertValuePositions } from "@/server/commands/assurance";
import { createEmergingDriver } from "@/server/commands/drivers";
import { recordEvidence } from "@/server/commands/evidence";
import { documentMatterEvidence, requestMatterEvidence } from "@/server/commands/matter-evidence";
import { assessMatterWorking, createMatter, setMatterRemediation, setMatterStage } from "@/server/commands/matters";
import { issueRecommendation, recordDecision, saveRecommendation, upsertScenario } from "@/server/commands/options";
import { createProject } from "@/server/commands/project";
import type { Actor } from "@/server/commands/run";
import { addStakeholder, setValueCaseOwner } from "@/server/commands/stakeholders";
import {
  addValueDriver,
  authoriseInitialVersion,
  createDraftVersion,
  createInheritedBusinessCase,
  proposeVersion,
  recordInheritedBusinessCase,
  updateDriverVersion,
} from "@/server/commands/value-case";
import {
  authoriseValueChange,
  createValueChange,
  includeDriverInValueChange,
  proposeValueChange,
} from "@/server/commands/value-change";
import { db, schema } from "@/server/db/client";

// A small synthetic engagement at Authorised V1 with no Assurance Reviews, for
// exercising the Value Assurance workflow. Not client data; not Horizon.

export async function seedCompactAuthorised(actor: Actor, opts: { code?: string; name?: string } = {}) {
  const { project } = await createProject(actor, {
    newClientName: "Synthetic Test Client",
    code: opts.code ?? "COMPACT",
    name: opts.name ?? "Assurance Compact",
    currency: "USD",
    valueBasisDescription: "Synthetic test basis",
  });
  const { person: vco } = await addStakeholder(actor, {
    projectId: project.id,
    name: "Test VCO",
    roleDescription: "Value Case Owner",
  });
  await setValueCaseOwner(actor, { projectId: project.id, personId: vco.id });
  const v1 = await createDraftVersion(actor, { projectId: project.id, title: "Re-Qualified Value Case" });
  await addValueDriver(actor, {
    versionId: v1.id,
    code: "VD-01",
    name: "Alpha Savings",
    financialValue: "1000000.00",
    sortOrder: 1,
  });
  await addValueDriver(actor, {
    versionId: v1.id,
    code: "VD-02",
    name: "Beta Revenue",
    financialValue: "500000.00",
    sortOrder: 2,
  });
  await addValueDriver(actor, { versionId: v1.id, code: "VD-03", name: "Gamma Experience", sortOrder: 3 });
  await proposeVersion(actor, { versionId: v1.id });
  const auth = await recordEvidence(actor, {
    projectId: project.id,
    code: "E-001",
    title: "Synthetic authorisation record",
  });
  const today = new Date().toISOString().slice(0, 10);
  await authoriseInitialVersion(actor, {
    versionId: v1.id,
    authorisedByPersonId: vco.id,
    authorisedOn: today,
    authorisationEvidenceId: auth.id,
  });
  // Recorded after authorisation, so it counts as a material evidence change for Assurance.
  await recordEvidence(actor, {
    projectId: project.id,
    code: "E-002",
    title: "Quarterly benefits report",
    isMaterialChange: true,
    materialChangeNote: "Beta volumes below plan",
  });
  return { project };
}

/**
 * Phase 4D.3 journey fixture: the compact engagement with one finalised review and a recorded client
 * decision, so a Value Change can be prepared the usual way (from the decision). Synthetic only.
 */
export async function seedCompactDecided(actor: Actor, opts: { code: string; name: string }) {
  const { project } = await seedCompactAuthorised(actor, opts);
  const drivers = await db()
    .select({ id: schema.valueDriver.id, code: schema.valueDriver.code })
    .from(schema.valueDriver)
    .where(eq(schema.valueDriver.projectId, project.id));
  const id = (c: string) => drivers.find((d) => d.code === c)!.id;
  const [valueCase] = await db().select().from(schema.valueCase).where(eq(schema.valueCase.projectId, project.id));
  const today = new Date().toISOString().slice(0, 10);
  const review = await createReview(actor, { projectId: project.id, trigger: "ad_hoc", reviewDate: today });
  await upsertValuePositions(actor, {
    reviewId: review.id,
    positions: [
      { valueDriverId: id("VD-01"), currentForecast: "900000.00" },
      { valueDriverId: id("VD-02"), currentForecast: "500000.00" },
      { valueDriverId: id("VD-03"), forecastRationale: "On track" },
    ],
  });
  await upsertScenario(actor, { reviewId: review.id, label: "Current", kind: "current", totalValue: "1400000.00" });
  const pursue = await upsertScenario(actor, {
    reviewId: review.id,
    label: "Pursue new opportunity",
    kind: "recommended",
    totalValue: "1700000.00",
  });
  await saveRecommendation(actor, { reviewId: review.id, scenarioId: pursue.id, narrative: "Pursue it" });
  await issueRecommendation(actor, { reviewId: review.id });
  await finaliseReview(actor, { reviewId: review.id });
  await recordDecision(actor, {
    reviewId: review.id,
    selectedScenarioId: pursue.id,
    decidedByPersonId: valueCase!.vcoPersonId!,
    decidedOn: today,
    rationale: "Synthetic decision",
  });
  return { project };
}

/**
 * Phase 4D.4 "daily Value Office" fixture: a formal Review #1 (forecast $1.4m), and live Continuous
 * Assurance work — an escalated quantified matter, an unquantified matter awaiting evidence with
 * working evidence and an open request, and an emerging driver. Synthetic only.
 */
export async function seedCompactOperating(actor: Actor, opts: { code: string; name: string }) {
  const { project } = await seedCompactAuthorised(actor, opts);
  const drivers = await db()
    .select({ id: schema.valueDriver.id, code: schema.valueDriver.code })
    .from(schema.valueDriver)
    .where(eq(schema.valueDriver.projectId, project.id));
  const id = (c: string) => drivers.find((d) => d.code === c)!.id;
  const [vco] = await db()
    .select({ id: schema.valueCase.vcoPersonId })
    .from(schema.valueCase)
    .where(eq(schema.valueCase.projectId, project.id));
  const today = new Date().toISOString().slice(0, 10);
  const review = await createReview(actor, { projectId: project.id, trigger: "ad_hoc", reviewDate: today });
  await upsertValuePositions(actor, {
    reviewId: review.id,
    positions: [
      { valueDriverId: id("VD-01"), currentForecast: "900000.00" },
      { valueDriverId: id("VD-02"), currentForecast: "500000.00" },
      { valueDriverId: id("VD-03"), forecastRationale: "On track" },
    ],
  });
  await finaliseReview(actor, { reviewId: review.id });

  const escalated = await createMatter(actor, {
    projectId: project.id,
    code: "VL-101",
    title: "Budget freeze on cutover",
    responseOwnerPersonId: vco!.id!,
    driverIds: [id("VD-01")],
  });
  await setMatterStage(actor, { matterId: escalated.id, stage: "escalated" });
  await assessMatterWorking(actor, { matterId: escalated.id, workingTotalAmount: "300000.00" });

  const awaiting = await createMatter(actor, {
    projectId: project.id,
    code: "VL-102",
    title: "Supplier capacity unconfirmed",
    driverIds: [id("VD-02")],
  });
  await setMatterStage(actor, { matterId: awaiting.id, stage: "awaiting_evidence" });
  await documentMatterEvidence(actor, { matterId: awaiting.id, code: "E-003", title: "Supplier status letter" });
  await requestMatterEvidence(actor, {
    matterId: awaiting.id,
    newRequestTitle: "Assurance evidence",
    description: "Supplier capacity plan",
  });
  await setMatterRemediation(actor, { matterId: awaiting.id, remediationPlan: "Secondary supplier on standby" });

  await createEmergingDriver(actor, {
    projectId: project.id,
    code: "VD-04",
    name: "Automation Opportunity",
    workingEstimate: "200000.00",
    originValueLeakageId: awaiting.id,
  });
  return { project };
}

/**
 * Phase 4D.5 "Value Case Evolution" fixture. Synthetic only; dates are fixture dates, not client facts.
 *   V0  Original Business Case $2.0m (stated headline, no governed date)
 *   V1  $1.5m authorised 15 Jan 2026
 *   Review #1 31 Mar 2026 vs V1: forecast $1.4m, realised $0 (recorded as zero)
 *   Review #2 30 Jun 2026 vs V1: forecast $1.3m, realised $0.3m — client decision → VC-001
 *   V2  $1.3m authorised 15 Jul 2026 (VD-01 $1.0m → $0.8m)
 *   Review #3 30 Sep 2026 vs V2: forecast $1.2m, realised $0.6m
 * Not governed, so never plotted: VC-002 draft adding emerging VD-04 ($0.2m working estimate;
 * $0.45m in the draft V3, so V3 would total $1.75m), and a quantified working matter VL-201 ($0.45m).
 */
export async function seedCompactEvolution(actor: Actor, opts: { code: string; name: string }) {
  const { project } = await createProject(actor, {
    newClientName: "Synthetic Test Client",
    code: opts.code,
    name: opts.name,
    currency: "USD",
    valueBasisDescription: "Synthetic test basis",
  });
  const { person: vco } = await addStakeholder(actor, {
    projectId: project.id,
    name: "Test VCO",
    roleDescription: "Value Case Owner",
  });
  await setValueCaseOwner(actor, { projectId: project.id, personId: vco.id });
  const v0 = await createInheritedBusinessCase(actor, {
    projectId: project.id,
    title: "Original Business Case",
    statedTotalValue: "2000000.00",
  });
  await recordInheritedBusinessCase(actor, { versionId: v0.id });

  const v1 = await createDraftVersion(actor, {
    projectId: project.id,
    title: "Re-Qualified Value Case",
    basedOnVersionId: v0.id,
  });
  await addValueDriver(actor, {
    versionId: v1.id,
    code: "VD-01",
    name: "Alpha Savings",
    financialValue: "1000000.00",
    sortOrder: 1,
  });
  await addValueDriver(actor, {
    versionId: v1.id,
    code: "VD-02",
    name: "Beta Revenue",
    financialValue: "500000.00",
    sortOrder: 2,
  });
  await proposeVersion(actor, { versionId: v1.id });
  const auth1 = await recordEvidence(actor, { projectId: project.id, code: "E-001", title: "V1 authorisation" });
  await authoriseInitialVersion(actor, {
    versionId: v1.id,
    authorisedByPersonId: vco.id,
    authorisedOn: "2026-01-15",
    authorisationEvidenceId: auth1.id,
  });
  const drivers = await db()
    .select({ id: schema.valueDriver.id, code: schema.valueDriver.code })
    .from(schema.valueDriver)
    .where(eq(schema.valueDriver.projectId, project.id));
  const id = (c: string) => drivers.find((d) => d.code === c)!.id;

  const formal = async (
    reviewDate: string,
    positions: { code: string; forecast: string; realised: string }[],
    decide?: (reviewId: string) => Promise<void>,
  ) => {
    const review = await createReview(actor, { projectId: project.id, trigger: "ad_hoc", reviewDate });
    await upsertValuePositions(actor, {
      reviewId: review.id,
      positions: positions.map((p) => ({
        valueDriverId: id(p.code),
        currentForecast: p.forecast,
        realisedValue: p.realised,
      })),
    });
    if (decide) await decide(review.id);
    await finaliseReview(actor, { reviewId: review.id });
    return review;
  };

  await formal("2026-03-31", [
    { code: "VD-01", forecast: "900000.00", realised: "0.00" },
    { code: "VD-02", forecast: "500000.00", realised: "0.00" },
  ]);
  let scenarioId = "";
  const review2 = await formal(
    "2026-06-30",
    [
      { code: "VD-01", forecast: "800000.00", realised: "200000.00" },
      { code: "VD-02", forecast: "500000.00", realised: "100000.00" },
    ],
    async (reviewId) => {
      await upsertScenario(actor, { reviewId, label: "Current", kind: "current", totalValue: "1300000.00" });
      const rebase = await upsertScenario(actor, {
        reviewId,
        label: "Rebase Alpha Savings",
        kind: "recommended",
        totalValue: "1300000.00",
      });
      scenarioId = rebase.id;
      await saveRecommendation(actor, { reviewId, scenarioId: rebase.id, narrative: "Rebase the commitment" });
      await issueRecommendation(actor, { reviewId });
    },
  );
  const decision = await recordDecision(actor, {
    reviewId: review2.id,
    selectedScenarioId: scenarioId,
    decidedByPersonId: vco.id,
    decidedOn: "2026-07-01",
    rationale: "Synthetic decision",
  });

  const { change, version: v2 } = await createValueChange(actor, {
    projectId: project.id,
    code: "VC-001",
    reason: "Rebase Alpha Savings to $0.8m",
    statedChangeAmount: "-200000.00",
    assuranceReviewId: review2.id,
    decisionId: decision.id,
  });
  const [alphaInV2] = await db()
    .select({ id: schema.valueDriverVersion.id })
    .from(schema.valueDriverVersion)
    .where(
      and(
        eq(schema.valueDriverVersion.valueCaseVersionId, v2.id),
        eq(schema.valueDriverVersion.valueDriverId, id("VD-01")),
      ),
    );
  await updateDriverVersion(actor, { driverVersionId: alphaInV2!.id, financialValue: "800000.00" });
  await proposeValueChange(actor, { changeId: change.id });
  const auth2 = await recordEvidence(actor, { projectId: project.id, code: "E-002", title: "V2 authorisation" });
  await authoriseValueChange(actor, {
    changeId: change.id,
    authorisedByPersonId: vco.id,
    authorisedOn: "2026-07-15",
    authorisationEvidenceId: auth2.id,
  });

  await formal("2026-09-30", [
    { code: "VD-01", forecast: "700000.00", realised: "400000.00" },
    { code: "VD-02", forecast: "500000.00", realised: "200000.00" },
  ]);

  // Working / pending — must never reach the governed evolution.
  const matter = await createMatter(actor, {
    projectId: project.id,
    code: "VL-201",
    title: "Supplier slippage",
    driverIds: [id("VD-02")],
  });
  await assessMatterWorking(actor, { matterId: matter.id, workingTotalAmount: "450000.00" });
  const { driver: emerging } = await createEmergingDriver(actor, {
    projectId: project.id,
    code: "VD-04",
    name: "Automation Opportunity",
    workingEstimate: "200000.00",
  });
  const { change: pending, version: v3 } = await createValueChange(actor, {
    projectId: project.id,
    code: "VC-002",
    reason: "Include Automation Opportunity",
  });
  await includeDriverInValueChange(actor, { changeId: pending.id, valueDriverId: emerging.id });
  const [autoInV3] = await db()
    .select({ id: schema.valueDriverVersion.id })
    .from(schema.valueDriverVersion)
    .where(
      and(
        eq(schema.valueDriverVersion.valueCaseVersionId, v3.id),
        eq(schema.valueDriverVersion.valueDriverId, emerging.id),
      ),
    );
  if (autoInV3) await updateDriverVersion(actor, { driverVersionId: autoInV3.id, financialValue: "450000.00" });
  return { project };
}
