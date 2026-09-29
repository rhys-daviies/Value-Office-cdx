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

// Project Horizon — canonical acceptance fixture, Phase 1 scope (through Authorised V1).
//
// KNOWN FACTS (PMO-supplied): Original Business Case $18.0m; Authorised V1 $15.5m;
// the six drivers below with value, metric, baseline and target.
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
} as const;

/** Builds Horizon through the public commands (no raw inserts, no special-casing). */
export async function seedHorizon(actor: Actor, opts: { projectCode?: string; authorisedOn?: string } = {}) {
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

  return { project, vco, v0, v1: authorised };
}
