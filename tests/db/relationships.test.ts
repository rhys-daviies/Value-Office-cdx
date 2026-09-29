import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { recordEvidence } from "@/server/commands/evidence";
import { COMMANDS } from "@/server/commands/names";
import { addKeyDate, createProject, setProjectValueBasis } from "@/server/commands/project";
import { addStakeholder, setValueCaseOwner } from "@/server/commands/stakeholders";
import { addValueDriver, createDraftVersion, linkEvidence, updateDriverVersion } from "@/server/commands/value-case";
import { db, schema } from "@/server/db/client";

import { asCommand, expectDomainError, newActor, newProject, uid } from "../support/fixtures";

describe("project / value case relationships", () => {
  it("creates exactly one Value Case per project", async () => {
    const actor = await newActor();
    const { project, valueCase } = await newProject(actor);
    expect(valueCase.projectId).toBe(project.id);
    await expectDomainError(
      asCommand(actor, COMMANDS.createProject, (tx) => tx.insert(schema.valueCase).values({ projectId: project.id })),
      "VO_UNIQUE_VIOLATION",
    );
  });

  it("requires a valid ISO currency and ordered value period", async () => {
    const actor = await newActor();
    const { client, project } = await newProject(actor, { valueBasis: false });
    await expectDomainError(
      createProject(actor, { clientId: client.id, code: `P-${uid()}`, name: "x", currency: "usd" }),
      "VO_INVALID_INPUT",
    );
    await expectDomainError(
      asCommand(actor, COMMANDS.createProject, (tx) =>
        tx.insert(schema.project).values({ clientId: client.id, code: `P-${uid()}`, name: "x", currency: "US$" }),
      ),
      "VO_CHECK_VIOLATION",
    );
    await expectDomainError(
      setProjectValueBasis(actor, {
        projectId: project.id,
        valueBasisDescription: "Annual run-rate benefit at full implementation",
        valuePeriodStart: "2030-01-01",
        valuePeriodEnd: "2027-01-01",
      }),
      "VO_CHECK_VIOLATION",
    );
  });

  it("only allows the VCO to be a stakeholder of the same project", async () => {
    const actor = await newActor();
    const a = await newProject(actor);
    const b = await newProject(actor);
    const { person: bPerson } = await addStakeholder(actor, { projectId: b.project.id, name: "B person" });
    await expectDomainError(
      setValueCaseOwner(actor, { projectId: a.project.id, personId: bPerson.id }),
      "VO_REFERENCE_VIOLATION",
    );
  });

  it("prevents a person from another client becoming a stakeholder", async () => {
    const actor = await newActor();
    const a = await newProject(actor);
    const b = await newProject(actor);
    const { person: bPerson } = await addStakeholder(actor, { projectId: b.project.id, name: "B person" });
    await expectDomainError(
      asCommand(actor, COMMANDS.addStakeholder, (tx) =>
        tx.insert(schema.projectStakeholder).values({
          projectId: a.project.id,
          personId: bPerson.id,
          clientId: b.client.id,
        }),
      ),
      "VO_REFERENCE_VIOLATION",
    );
  });

  it("requires the AVO to be a stakeholder of the project", async () => {
    const actor = await newActor();
    const a = await newProject(actor);
    const b = await newProject(actor);
    const { person: outsider } = await addStakeholder(actor, { projectId: b.project.id, name: "Outsider" });
    const v1 = await createDraftVersion(actor, { projectId: a.project.id, title: "V1" });
    const { driverVersion } = await addValueDriver(actor, { versionId: v1.id, code: "VD-01", name: "Driver" });
    await expectDomainError(
      updateDriverVersion(actor, { driverVersionId: driverVersion.id, avoPersonId: outsider.id }),
      "VO_REFERENCE_VIOLATION",
    );
  });

  it("prevents linking evidence from another project", async () => {
    const actor = await newActor();
    const a = await newProject(actor);
    const b = await newProject(actor);
    const bEvidence = await recordEvidence(actor, { projectId: b.project.id, code: "E-1", title: "B evidence" });
    const v1 = await createDraftVersion(actor, { projectId: a.project.id, title: "V1" });
    const { driverVersion } = await addValueDriver(actor, { versionId: v1.id, code: "VD-01", name: "Driver" });
    // The command derives project_id from the evidence, so the driver version FK fails.
    await expectDomainError(
      linkEvidence(actor, { evidenceId: bEvidence.id, driverVersionId: driverVersion.id }),
      "VO_REFERENCE_VIOLATION",
    );
  });

  it("prevents a driver version pointing at a driver from another Value Case", async () => {
    const actor = await newActor();
    const a = await newProject(actor);
    const b = await newProject(actor);
    const aV1 = await createDraftVersion(actor, { projectId: a.project.id, title: "V1" });
    const bV1 = await createDraftVersion(actor, { projectId: b.project.id, title: "V1" });
    const { driver: bDriver } = await addValueDriver(actor, { versionId: bV1.id, code: "VD-01", name: "B" });
    await expectDomainError(
      asCommand(actor, COMMANDS.addValueDriver, (tx) =>
        tx.insert(schema.valueDriverVersion).values({
          valueCaseVersionId: aV1.id,
          valueCaseId: aV1.valueCaseId,
          projectId: a.project.id,
          valueDriverId: bDriver.id,
          name: "Cross-case",
        }),
      ),
      "VO_REFERENCE_VIOLATION",
    );
  });

  it("allows only one kickoff and one go-live date per project", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    await addKeyDate(actor, { projectId: project.id, kind: "kickoff", label: "Kick-off", date: "2026-10-01" });
    await expectDomainError(
      addKeyDate(actor, { projectId: project.id, kind: "kickoff", label: "Again", date: "2026-10-02" }),
      "VO_UNIQUE_VIOLATION",
    );
    await addKeyDate(actor, { projectId: project.id, kind: "other", label: "Steerco", date: "2026-11-01" });
    await addKeyDate(actor, { projectId: project.id, kind: "other", label: "Steerco 2", date: "2026-12-01" });
    const dates = await db().select().from(schema.keyDate).where(eq(schema.keyDate.projectId, project.id));
    expect(dates).toHaveLength(3);
  });
});
