import { recordEvidence } from "@/server/commands/evidence";
import { createProject } from "@/server/commands/project";
import type { Actor } from "@/server/commands/run";
import { addStakeholder, setValueCaseOwner } from "@/server/commands/stakeholders";
import {
  addValueDriver,
  authoriseInitialVersion,
  createDraftVersion,
  proposeVersion,
} from "@/server/commands/value-case";

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
