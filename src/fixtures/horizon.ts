import { eq } from "drizzle-orm";

import { createReview, finaliseReview, updateReview, upsertValuePositions } from "@/server/commands/assurance";
import { createLeakage } from "@/server/commands/leakage";
import { issueRecommendation, recordDecision, saveRecommendation, upsertScenario } from "@/server/commands/options";
import { createValueChange, proposeValueChange } from "@/server/commands/value-change";
import { createClient, createProject, setProjectValueBasis } from "@/server/commands/project";
import { recordEvidence } from "@/server/commands/evidence";
import type { Actor } from "@/server/commands/run";
import { addStakeholder, setValueCaseOwner } from "@/server/commands/stakeholders";
import {
  addValueDriver,
  authoriseInitialVersion,
  createDraftVersion,
  createInheritedBusinessCase,
  proposeVersion,
  recordInheritedBusinessCase,
} from "@/server/commands/value-case";
import { db, schema } from "@/server/db/client";

// Project Horizon — canonical acceptance fixture (through Authorised V1 and the
// first Value Assurance position).
//
// KNOWN FACTS (PMO-supplied): Original Business Case $18.0m; Authorised V1 $15.5m;
// the six drivers below with value, metric, baseline and target; a current
// forecast per driver totalling $14.7m (Value Gap $0.8m); realised value $2.8m
// known ONLY as a project-level aggregate.
//
// Realised Value: Horizon's per-driver realised figures are not known, so every
// driver's realised value is null and the $2.8m is recorded as the review's
// UNATTRIBUTED realised value (PMO decision A1) — never split across drivers.
//
// Phase 3 (known): scenarios current $14.7m, Cardaxia recommendation $15.3m,
// client-selected $14.9m (difference −$0.4m); VC-002 proposed at −$0.6m (V2
// would be $14.9m). Per PMO: the vendor-sequencing leakage is recorded with no
// assessment amounts (the prototype figures do not reconcile), and VC-002 is
// proposed only — its per-driver allocation is unknown, so V2 is not authorised.
//
// Everything else is a clearly labelled placeholder, not a fact. In particular:
// currency (the brief uses "$" without specifying which), Value Basis, client
// name, VCO identity, authorisation evidence and date, AVOs, assumptions, and
// qualification/evidence statuses (left at the schema defaults: unqualified /
// unevidenced). Replace these when Horizon details are confirmed.

export const PLACEHOLDER = "[FIXTURE PLACEHOLDER]";

export const HORIZON = {
  originalBusinessCaseValue: "18000000.00",
  authorisedV1Value: "15500000.00",
  drivers: [
    {
      code: "VD-01",
      name: "Service Productivity",
      financialValue: "4800000.00",
      metric: "effort units/case",
      metricUnit: undefined,
      baselineValue: "12.0",
      targetValue: "7.0",
    },
    {
      code: "VD-02",
      name: "Customer Retention",
      financialValue: "3600000.00",
      metric: "churn",
      metricUnit: "%",
      baselineValue: "10.2",
      targetValue: "8.5",
    },
    {
      code: "VD-03",
      name: "Technology Run Cost",
      financialValue: "2400000.00",
      metric: "cost per active user",
      metricUnit: "$",
      baselineValue: "142",
      targetValue: "108",
    },
    {
      code: "VD-04",
      name: "Contact Avoidance",
      financialValue: "2100000.00",
      metric: "contacts per 1,000 customers",
      metricUnit: undefined,
      baselineValue: "184",
      targetValue: "145",
    },
    {
      code: "VD-05",
      name: "Quality / Rework",
      financialValue: "2200000.00",
      metric: "rework rate",
      metricUnit: "%",
      baselineValue: "18.0",
      targetValue: "12.5",
    },
    {
      code: "VD-06",
      name: "New Automation",
      financialValue: "400000.00",
      metric: "automation",
      metricUnit: "%",
      baselineValue: "0",
      targetValue: "22",
    },
  ],
  assurance: {
    currentForecastTotal: "14700000.00",
    valueGap: "800000.00",
    /** Project-level aggregate only — no per-driver allocation is known (recorded as unattributed). */
    realisedAggregate: "2800000.00",
    forecasts: [
      { code: "VD-01", currentForecast: "4400000.00" },
      { code: "VD-02", currentForecast: "3200000.00" },
      { code: "VD-03", currentForecast: "2200000.00" },
      { code: "VD-04", currentForecast: "2000000.00" },
      { code: "VD-05", currentForecast: "2500000.00" },
      { code: "VD-06", currentForecast: "400000.00" },
    ],
  },
  response: {
    scenarios: {
      current: "14700000.00",
      recommended: "15300000.00",
      clientSelected: "14900000.00",
    },
    clientElectedDifference: "-400000.00",
    valueChange: { code: "VC-002", statedChange: "-600000.00", v2IfAuthorised: "14900000.00" },
    /** Old-prototype vendor-sequencing figures; they do not reconcile under Total = Recoverable + Unrecoverable. */
    prototypeLeakage: { exposure: "0.70m", leakageToDate: "0.25m", stillRecoverable: "0.30m" },
  },
} as const;

/** Builds Horizon through the public commands (no raw inserts, no special-casing). */
export async function seedHorizon(
  actor: Actor,
  opts: { projectCode?: string; authorisedOn?: string; reviewDate?: string } = {},
) {
  const today = new Date().toISOString().slice(0, 10);

  const client = await createClient(actor, { name: `${PLACEHOLDER} Horizon client` });
  const { project } = await createProject(actor, {
    clientId: client.id,
    code: opts.projectCode ?? "HORIZON",
    name: "Project Horizon",
    context: `${PLACEHOLDER} Canonical acceptance fixture. Project context not yet specified. Currency USD is a placeholder: the brief states "$" without naming a currency.`,
    currency: "USD", // PLACEHOLDER: brief states "$" without a currency.
  });
  await setProjectValueBasis(actor, {
    projectId: project.id,
    valueBasisDescription: `${PLACEHOLDER} Value Basis not yet specified for Project Horizon`,
  });

  const { person: vco } = await addStakeholder(actor, {
    projectId: project.id,
    name: `${PLACEHOLDER} Value Case Owner`,
    roleDescription: "Value Case Owner",
  });
  await setValueCaseOwner(actor, { projectId: project.id, personId: vco.id });

  // V0 — inherited Business Case. Only the headline figure is known; no driver breakdown.
  const v0Draft = await createInheritedBusinessCase(actor, {
    projectId: project.id,
    title: "Original Business Case",
    summary: `${PLACEHOLDER} Driver-level breakdown of the original Business Case not yet specified.`,
    statedTotalValue: HORIZON.originalBusinessCaseValue,
  });
  const v0 = await recordInheritedBusinessCase(actor, { versionId: v0Draft.id });

  // V1 — Re-Qualified Value Case.
  const v1 = await createDraftVersion(actor, {
    projectId: project.id,
    title: "Re-Qualified Value Case",
    basedOnVersionId: v0.id,
  });
  for (const [i, d] of HORIZON.drivers.entries()) {
    await addValueDriver(actor, {
      versionId: v1.id,
      code: d.code,
      name: d.name,
      metric: d.metric,
      metricUnit: d.metricUnit,
      baselineValue: d.baselineValue,
      targetValue: d.targetValue,
      financialValue: d.financialValue,
      sortOrder: i + 1,
      notes: `${PLACEHOLDER} AVO, timing, rationale, assumptions, evidence and qualification/evidence status not yet specified.`,
    });
  }
  await proposeVersion(actor, { versionId: v1.id });

  const authorisationEvidence = await recordEvidence(actor, {
    projectId: project.id,
    code: "E-001",
    title: `${PLACEHOLDER} VCO authorisation record for V1`,
    summary: `${PLACEHOLDER} Stands in for the signed notice / email / meeting record.`,
  });
  const authorised = await authoriseInitialVersion(actor, {
    versionId: v1.id,
    authorisedByPersonId: vco.id,
    authorisedOn: opts.authorisedOn ?? today, // PLACEHOLDER date
    authorisationEvidenceId: authorisationEvidence.id,
    authorisationNote: `${PLACEHOLDER} Authorisation details not yet specified.`,
  });

  // First Value Assurance position. Trigger and date are not known facts.
  const draftReview = await createReview(actor, {
    projectId: project.id,
    trigger: "ad_hoc", // PLACEHOLDER: the triggering event of Horizon's review is not specified
    reviewDate: opts.reviewDate ?? today, // PLACEHOLDER date
    whatChanged: `${PLACEHOLDER} What changed since Authorised V1 is not yet specified.`,
  });
  const driverIds = await driverIdsByCode(project.id);
  await upsertValuePositions(actor, {
    reviewId: draftReview.id,
    positions: HORIZON.assurance.forecasts.map((f) => ({
      valueDriverId: driverIds.get(f.code)!,
      currentForecast: f.currentForecast,
      realisedValue: null, // not known per driver — never invented
      forecastRationale: `${PLACEHOLDER} Forecast rationale not yet specified.`,
      realisedValueRationale: `${PLACEHOLDER} Per-driver realised value not specified; see review summary.`,
    })),
  });
  await updateReview(actor, {
    reviewId: draftReview.id,
    whyItMatters: `${PLACEHOLDER} Economic significance not yet specified.`,
    summary: `${PLACEHOLDER} Realised Value of $2.8m is known only as a project-level aggregate and is recorded as unattributed realised value. Per-driver realised values are not specified, so none are recorded.`,
    unattributedRealisedValue: HORIZON.assurance.realisedAggregate,
    unattributedRealisedRationale: `${PLACEHOLDER} $2.8m realised is known only at project level; no reliable per-driver attribution is available.`,
  });

  // Value Leakage: vendor sequencing. The prototype figures do not reconcile under
  // Total = Recoverable + Unrecoverable, so no assessment amounts are recorded (PMO decision).
  const p = HORIZON.response.prototypeLeakage;
  await createLeakage(actor, {
    reviewId: draftReview.id,
    code: "VL-001",
    title: "Vendor sequencing",
    description: `${PLACEHOLDER} Old-prototype figures: exposure $${p.exposure}, "leakage to date" $${p.leakageToDate}, "still recoverable" $${p.stillRecoverable}. These do not reconcile under Total VL = Recoverable + Unrecoverable (0.25 + 0.30 ≠ 0.70), so no assessment is recorded pending PMO confirmation. Affected drivers and AVO not specified.`,
    consultantAssessment: `${PLACEHOLDER} Not assessed under the clarified Value Leakage definition.`,
  });

  // Options / alternative trajectories — consultant-entered totals (known values only).
  const s = HORIZON.response.scenarios;
  await upsertScenario(actor, {
    reviewId: draftReview.id,
    label: "Current trajectory",
    kind: "current",
    totalValue: s.current,
    sortOrder: 1,
  });
  const recommended = await upsertScenario(actor, {
    reviewId: draftReview.id,
    label: "Cardaxia recommendation",
    kind: "recommended",
    totalValue: s.recommended,
    narrative: `${PLACEHOLDER} Actions and timing not specified.`,
    sortOrder: 2,
  });
  const clientOption = await upsertScenario(actor, {
    reviewId: draftReview.id,
    label: `${PLACEHOLDER} Client-selected option`,
    kind: "alternative",
    totalValue: s.clientSelected,
    narrative: `${PLACEHOLDER} Option definition (e.g. timing) not specified.`,
    sortOrder: 3,
  });
  await saveRecommendation(actor, {
    reviewId: draftReview.id,
    scenarioId: recommended.id,
    narrative: `${PLACEHOLDER} Cardaxia recommendation narrative not specified.`,
  });
  await issueRecommendation(actor, { reviewId: draftReview.id });
  const review = await finaliseReview(actor, { reviewId: draftReview.id });

  // Client decision (distinct from the recommendation, which is never rewritten).
  const { person: decider } = await addStakeholder(actor, {
    projectId: project.id,
    name: `${PLACEHOLDER} Client decision maker`,
    roleDescription: `${PLACEHOLDER} Identity not specified`,
  });
  const decision = await recordDecision(actor, {
    reviewId: review.id,
    selectedScenarioId: clientOption.id,
    decidedByPersonId: decider.id,
    decidedOn: opts.reviewDate ?? today, // PLACEHOLDER date
    rationale: `${PLACEHOLDER} Decision rationale not specified.`,
  });

  // VC-002 — proposed only. Per-driver allocation of −$0.6m is unknown, so V2 is
  // left as an unadjusted copy of V1 and cannot be authorised until reconciled.
  const { change } = await createValueChange(actor, {
    projectId: project.id,
    code: HORIZON.response.valueChange.code,
    statedChangeAmount: HORIZON.response.valueChange.statedChange,
    reason: `${PLACEHOLDER} Reflects the client-selected option (−$0.6m against Authorised V1).`,
    economicImpactNarrative: `${PLACEHOLDER} Per-driver allocation of the −$0.6m is not specified.`,
    assuranceReviewId: review.id,
    decisionId: decision.id,
  });
  const valueChange = await proposeValueChange(actor, { changeId: change.id });

  return { project, vco, v0, v1: authorised, review, decision, valueChange };
}

async function driverIdsByCode(projectId: string): Promise<Map<string, string>> {
  const rows = await db()
    .select({ id: schema.valueDriver.id, code: schema.valueDriver.code })
    .from(schema.valueDriver)
    .where(eq(schema.valueDriver.projectId, projectId));
  return new Map(rows.map((r) => [r.code, r.id]));
}
