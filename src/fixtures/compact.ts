import { eq } from "drizzle-orm";

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
  proposeVersion,
} from "@/server/commands/value-case";
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
