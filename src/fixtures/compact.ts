import { and, eq } from "drizzle-orm";

import { createReview, finaliseReview, upsertValuePositions } from "@/server/commands/assurance";
import { createEmergingDriver } from "@/server/commands/drivers";
import { recordEvidence } from "@/server/commands/evidence";
import { documentMatterEvidence, requestMatterEvidence } from "@/server/commands/matter-evidence";
import { assessMatterWorking, createMatter, setMatterRemediation, setMatterStage } from "@/server/commands/matters";
import { issueRecommendation, recordDecision, saveRecommendation, upsertScenario } from "@/server/commands/options";
import { createProject } from "@/server/commands/project";
import { setForecastPoint, setScenarioPoint } from "@/server/commands/trajectory";
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

import { CANONICAL, canonicalJourney } from "./canonical";

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
    adjustmentRationale: "Synthetic test rationale",
    versionId: v1.id,
    code: "VD-01",
    name: "Alpha Savings",
    financialValue: "1000000.00",
    sortOrder: 1,
  });
  await addValueDriver(actor, {
    adjustmentRationale: "Synthetic test rationale",
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
      { forecastRationale: "Synthetic test rationale", valueDriverId: id("VD-01"), currentForecast: "900000.00" },
      { forecastRationale: "Synthetic test rationale", valueDriverId: id("VD-02"), currentForecast: "500000.00" },
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
      { forecastRationale: "Synthetic test rationale", valueDriverId: id("VD-01"), currentForecast: "900000.00" },
      { forecastRationale: "Synthetic test rationale", valueDriverId: id("VD-02"), currentForecast: "500000.00" },
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
    adjustmentRationale: "Synthetic test rationale",
    versionId: v1.id,
    code: "VD-01",
    name: "Alpha Savings",
    financialValue: "1000000.00",
    sortOrder: 1,
  });
  await addValueDriver(actor, {
    adjustmentRationale: "Synthetic test rationale",
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
        forecastRationale: "Synthetic test rationale",
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

/**
 * Phase 4D.6 "Alternative Value Outcomes" fixture. Synthetic only. Authorised V1 $1.5m; Review #1
 * finalised, formal forecast $1.4m, with four stored options — Current trajectory $1.4m, Accelerate
 * supplier onboarding $1.9m (Cardaxia recommendation), Phase the rollout $1.6m (client selected),
 * Defer remediation $1.2m. Difference from recommendation: −$0.3m. Not options, so never shown as
 * outcomes: draft VC-001 (+$0.25m → $1.75m), working matter VL-301 ($0.35m), emerging VD-04 ($0.2m).
 */
export async function seedCompactDecision(actor: Actor, opts: { code: string; name: string }) {
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
      { forecastRationale: "Synthetic test rationale", valueDriverId: id("VD-01"), currentForecast: "900000.00" },
      { forecastRationale: "Synthetic test rationale", valueDriverId: id("VD-02"), currentForecast: "500000.00" },
      { valueDriverId: id("VD-03"), forecastRationale: "On track" },
    ],
  });
  const option = (
    label: string,
    kind: "current" | "recommended" | "alternative" | "no_action",
    total: string,
    n: number,
  ) => upsertScenario(actor, { reviewId: review.id, label, kind, totalValue: total, sortOrder: n });
  await option("Current trajectory", "current", "1400000.00", 1);
  const accelerate = await option("Accelerate supplier onboarding", "recommended", "1900000.00", 2);
  const phase = await option("Phase the rollout", "alternative", "1600000.00", 3);
  await option("Defer remediation", "no_action", "1200000.00", 4);
  await saveRecommendation(actor, {
    reviewId: review.id,
    scenarioId: accelerate.id,
    narrative: "Bring the second supplier on now",
  });
  await issueRecommendation(actor, { reviewId: review.id });
  await finaliseReview(actor, { reviewId: review.id });
  const decision = await recordDecision(actor, {
    reviewId: review.id,
    selectedScenarioId: phase.id,
    decidedByPersonId: valueCase!.vcoPersonId!,
    decidedOn: today,
    rationale: "Budget phasing",
  });
  await createValueChange(actor, {
    projectId: project.id,
    code: "VC-001",
    reason: "Reflect the phased rollout",
    statedChangeAmount: "250000.00",
    assuranceReviewId: review.id,
    decisionId: decision.id,
  });
  const matter = await createMatter(actor, {
    projectId: project.id,
    code: "VL-301",
    title: "Onboarding slippage",
    driverIds: [id("VD-02")],
  });
  await assessMatterWorking(actor, { matterId: matter.id, workingTotalAmount: "350000.00" });
  await createEmergingDriver(actor, {
    projectId: project.id,
    code: "VD-04",
    name: "Automation Opportunity",
    workingEstimate: "200000.00",
  });
  return { project, review };
}

/**
 * Phase 4D.9D: "Trajectory Compact" — the authoring demonstration (synthetic). Authorised V1 $30.0m on a Cumulative
 * Benefit basis over 1 Jan 2026 – 31 Dec 2028 with plan milestones $0 / $6m / $18m / $30m; a DRAFT review (30 Sep
 * 2026) with formal forecast $26m, forecast milestones $16m (Dec 2027) and $26m (Dec 2028), and three options with
 * explicit consultant-entered paths: Act now $29m (recommended, not yet issued), Delay 3 months $27m, No action $23m.
 * Every value here is a stated fixture value; nothing is derived.
 */
export async function seedCompactTrajectory(
  actor: Actor,
  opts: {
    code: string;
    name: string;
    /**
     * The canonical journey (Phase 4D.9K, src/fixtures/canonical.ts) through Review #2: V0 $32.0m → Authorised V1
     * $30.0m with plan; Reviews #1 and #2 finalised; VL-001; three phased options; recommendation issued; management
     * selects "Delay 3 months". Without it: V1 plus a DRAFT 30 Sep review with forecast and option paths (4D.9D).
     */
    formal?: boolean;
  },
) {
  const j = canonicalJourney(actor, opts);
  const s = await j.establish({ inherited: opts.formal });
  if (opts.formal) {
    await j.assure();
    return { project: s.project, vco: s.vco, v1: s.v1, review: s.review2 };
  }
  const ids = s.drivers;
  const review = await createReview(actor, { projectId: s.project.id, trigger: "ad_hoc", reviewDate: "2026-09-30" });
  await upsertValuePositions(actor, {
    reviewId: review.id,
    positions: [
      {
        forecastRationale: "Synthetic test rationale",
        valueDriverId: ids[0]!,
        currentForecast: "13000000.00",
        realisedValue: "2500000.00",
      },
      {
        forecastRationale: "Synthetic test rationale",
        valueDriverId: ids[1]!,
        currentForecast: "9000000.00",
        realisedValue: "1000000.00",
      },
      {
        forecastRationale: "Synthetic test rationale",
        valueDriverId: ids[2]!,
        currentForecast: "4000000.00",
        realisedValue: "500000.00",
      },
    ],
  });
  await setForecastPoint(actor, { reviewId: review.id, asOf: "2027-12-31", value: "16000000.00" });
  await setForecastPoint(actor, { reviewId: review.id, asOf: "2028-12-31", value: "26000000.00" });
  let act: { id: string } | null = null;
  for (const [n, o] of CANONICAL.review2.options.entries()) {
    const sc = await upsertScenario(actor, {
      reviewId: review.id,
      label: o.label,
      kind: o.kind,
      totalValue: o.total,
      sortOrder: n + 1,
      ...(o.narrative ? { narrative: o.narrative } : {}),
    });
    for (const [asOf, value, note] of o.points)
      await setScenarioPoint(actor, { scenarioId: sc.id, asOf, value, ...(note ? { note } : {}) });
    if (o.label === "Act now") act = sc;
  }
  await saveRecommendation(actor, {
    reviewId: review.id,
    scenarioId: act!.id,
    narrative: "Act now to protect the plan",
  });
  return { project: s.project, vco: s.vco, v1: s.v1, review };
}

/**
 * Phase 4D.9D: "Trajectory Draft" — a DRAFT V1 ($30.0m, unclassified, no milestones) whose project setup records a
 * Value Period, for authoring a basis and plan from scratch (synthetic).
 */
export async function seedCompactTrajectoryDraft(actor: Actor, opts: { code: string; name: string }) {
  const { project } = await createProject(actor, {
    newClientName: "Synthetic Test Client",
    code: opts.code,
    name: opts.name,
    currency: "USD",
    valueBasisDescription: "Synthetic: cumulative benefit over FY26–FY28",
    valuePeriodStart: "2026-01-01",
    valuePeriodEnd: "2028-12-31",
  });
  const { person: vco } = await addStakeholder(actor, {
    projectId: project.id,
    name: "Test VCO",
    roleDescription: "VCO",
  });
  await setValueCaseOwner(actor, { projectId: project.id, personId: vco.id });
  const v1 = await createDraftVersion(actor, { projectId: project.id, title: "Re-Qualified Value Case" });
  await addValueDriver(actor, {
    adjustmentRationale: "Synthetic test rationale",
    versionId: v1.id,
    code: "VD-01",
    name: "Procurement Savings",
    financialValue: "20000000.00",
    sortOrder: 1,
  });
  await addValueDriver(actor, {
    adjustmentRationale: "Synthetic test rationale",
    versionId: v1.id,
    code: "VD-02",
    name: "Revenue Uplift",
    financialValue: "10000000.00",
    sortOrder: 2,
  });
  return { project, vco, v1 };
}
