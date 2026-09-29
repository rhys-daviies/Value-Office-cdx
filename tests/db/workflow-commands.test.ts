import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  addInformationRequestItem,
  closeInformationRequest,
  createInformationRequest,
  issueInformationRequest,
  removeInformationRequestItem,
  updateInformationRequestItem,
} from "@/server/commands/information-request";
import { createClient, createProject, updateProjectDetails } from "@/server/commands/project";
import { addStakeholder, updateStakeholder } from "@/server/commands/stakeholders";
import {
  addValueDriver,
  createDraftVersion,
  createInheritedBusinessCase,
  recordInheritedBusinessCase,
  removeValueDriver,
  updateDriverVersion,
  updateVersionDetails,
} from "@/server/commands/value-case";
import { db, schema } from "@/server/db/client";
import { getVersionTotal } from "@/server/queries/value-case";

import { expectDomainError, newActor, newProject, uid } from "../support/fixtures";

describe("project creation (one transaction)", () => {
  it("creates a new client, project, Value Case, Value Basis and key dates together", async () => {
    const actor = await newActor();
    const clientName = `New Client ${uid()}`;
    const { project, valueCase } = await createProject(actor, {
      newClientName: clientName,
      name: `Establish ${uid()}`,
      currency: "NZD",
      valueBasisDescription: "Annual run-rate benefit at full implementation",
      kickoffDate: "2026-10-05",
      goLiveDate: "2027-06-01",
    });
    expect(valueCase.projectId).toBe(project.id);
    expect(project.valueBasisDescription).toMatch(/run-rate/);
    const dates = await db().select().from(schema.keyDate).where(eq(schema.keyDate.projectId, project.id));
    expect(dates.map((d) => d.kind).sort()).toEqual(["go_live", "kickoff"]);
    const [client] = await db().select().from(schema.client).where(eq(schema.client.id, project.clientId));
    expect(client!.name).toBe(clientName);
  });

  it("generates a unique code from the name when none is given", async () => {
    const actor = await newActor();
    const name = `Code Gen ${uid()}`;
    const client = await createClient(actor, { name: "c" });
    const a = await createProject(actor, { clientId: client.id, name, currency: "USD" });
    const b = await createProject(actor, { clientId: client.id, name, currency: "USD" });
    expect(a.project.code).toBe(name.toUpperCase().replace(/[^A-Z0-9]+/g, "-"));
    expect(b.project.code).toBe(`${a.project.code}-2`);
  });

  it("rolls back the new client when the project cannot be created", async () => {
    const actor = await newActor();
    const { project: existing } = await newProject(actor);
    const clientName = `Orphan ${uid()}`;
    await expectDomainError(
      createProject(actor, { newClientName: clientName, code: existing.code, name: "Dup", currency: "USD" }),
      "VO_UNIQUE_VIOLATION",
    );
    const orphans = await db().select().from(schema.client).where(eq(schema.client.name, clientName));
    expect(orphans).toHaveLength(0);
  });

  it("requires exactly one of an existing client or a new client name", async () => {
    const actor = await newActor();
    await expectDomainError(createProject(actor, { name: "x", currency: "USD" }), "VO_INVALID_INPUT");
  });

  it("updates context and can clear it", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    expect((await updateProjectDetails(actor, { projectId: project.id, context: "Context" })).context).toBe("Context");
    expect((await updateProjectDetails(actor, { projectId: project.id, context: null })).context).toBeNull();
  });
});

describe("stakeholder updates", () => {
  it("edits person details and project role", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    const { person } = await addStakeholder(actor, { projectId: project.id, name: "Pat", title: "CFO" });
    const updated = await updateStakeholder(actor, {
      projectId: project.id,
      personId: person.id,
      name: "Pat Smith",
      title: null,
      roleDescription: "Sponsor",
    });
    expect(updated.person.name).toBe("Pat Smith");
    expect(updated.person.title).toBeNull();
    expect(updated.stakeholder.roleDescription).toBe("Sponsor");
  });

  it("refuses a person who is not a stakeholder on the project", async () => {
    const actor = await newActor();
    const a = await newProject(actor);
    const b = await newProject(actor);
    const { person } = await addStakeholder(actor, { projectId: b.project.id, name: "Elsewhere" });
    await expectDomainError(
      updateStakeholder(actor, { projectId: a.project.id, personId: person.id, name: "x" }),
      "VO_NOT_FOUND",
    );
  });
});

describe("Value Driver editing (PMO decisions 1 and 2)", () => {
  it("clearing the financial value makes a driver non-financial and excludes it from the total", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "V1" });
    const { driverVersion: a } = await addValueDriver(actor, {
      versionId: v1.id,
      code: "VD-01",
      name: "A",
      financialValue: "4800000.00",
    });
    await addValueDriver(actor, { versionId: v1.id, code: "VD-02", name: "B", financialValue: "1000000.00" });
    const cleared = await updateDriverVersion(actor, { driverVersionId: a.id, financialValue: null });
    expect(cleared.financialValue).toBeNull();
    const { total, driversWithoutValue } = await getVersionTotal(v1.id);
    expect(total.toFixed(2)).toBe("1000000.00");
    expect(driversWithoutValue).toBe(1);
  });

  it("allows negative financial values", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "V1" });
    await addValueDriver(actor, { versionId: v1.id, code: "VD-01", name: "Benefit", financialValue: "2000000.00" });
    const { driverVersion } = await addValueDriver(actor, {
      versionId: v1.id,
      code: "VD-02",
      name: "Dis-benefit",
      financialValue: "-300000.00",
    });
    expect(driverVersion.financialValue).toBe("-300000.00");
    expect((await getVersionTotal(v1.id)).total.toFixed(2)).toBe("1700000.00");
  });

  it("can clear optional fields but leaves omitted fields unchanged", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "V1" });
    const { driverVersion } = await addValueDriver(actor, {
      versionId: v1.id,
      code: "VD-01",
      name: "A",
      metric: "churn",
      baselineValue: "10.2",
      financialValue: "1.00",
    });
    const row = await updateDriverVersion(actor, { driverVersionId: driverVersion.id, metric: null });
    expect(row.metric).toBeNull();
    expect(row.baselineValue).toBe("10.200000");
    expect(row.financialValue).toBe("1.00");
  });
});

describe("removing drivers from a draft", () => {
  it("deletes the identity when no other version uses it", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "V1" });
    const { driver, driverVersion } = await addValueDriver(actor, { versionId: v1.id, code: "VD-01", name: "A" });
    await removeValueDriver(actor, { driverVersionId: driverVersion.id });
    expect(await db().select().from(schema.valueDriver).where(eq(schema.valueDriver.id, driver.id))).toHaveLength(0);
  });

  it("keeps the identity (and V0's content) when a recorded V0 still uses it", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    const v0 = await createInheritedBusinessCase(actor, { projectId: project.id, title: "BC" });
    const { driver } = await addValueDriver(actor, { versionId: v0.id, code: "VD-01", name: "Inherited" });
    await recordInheritedBusinessCase(actor, { versionId: v0.id });
    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "V1", basedOnVersionId: v0.id });
    const [copy] = await db()
      .select()
      .from(schema.valueDriverVersion)
      .where(eq(schema.valueDriverVersion.valueCaseVersionId, v1.id));
    await removeValueDriver(actor, { driverVersionId: copy!.id });
    expect(await db().select().from(schema.valueDriver).where(eq(schema.valueDriver.id, driver.id))).toHaveLength(1);
    const v0Rows = await db()
      .select()
      .from(schema.valueDriverVersion)
      .where(eq(schema.valueDriverVersion.valueCaseVersionId, v0.id));
    expect(v0Rows).toHaveLength(1);
  });
});

describe("version details", () => {
  it("edits the V0 stated total while draft, never a V1 total", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    const v0 = await createInheritedBusinessCase(actor, { projectId: project.id, title: "BC" });
    const updated = await updateVersionDetails(actor, { versionId: v0.id, statedTotalValue: "18000000.00" });
    expect(updated.statedTotalValue).toBe("18000000.00");
    await recordInheritedBusinessCase(actor, { versionId: v0.id });
    await expectDomainError(
      updateVersionDetails(actor, { versionId: v0.id, title: "Rewritten" }),
      "VO_VERSION_IMMUTABLE",
    );
    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "V1" });
    await expectDomainError(
      updateVersionDetails(actor, { versionId: v1.id, statedTotalValue: "1.00" }),
      "VO_INVALID_INPUT",
    );
  });
});

describe("Information Request lifecycle", () => {
  it("draft → issued → closed, with item removal only while draft", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    const ir = await createInformationRequest(actor, { projectId: project.id, reference: "IR-01", title: "IR" });
    const first = await addInformationRequestItem(actor, { informationRequestId: ir.id, description: "One" });
    const second = await addInformationRequestItem(actor, { informationRequestId: ir.id, description: "Two" });
    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    await removeInformationRequestItem(actor, { itemId: first.id });

    await expectDomainError(
      closeInformationRequest(actor, { informationRequestId: ir.id, closedOn: "2026-10-01" }),
      "VO_INVALID_TRANSITION",
    );
    const issued = await issueInformationRequest(actor, { informationRequestId: ir.id, issuedOn: "2026-10-01" });
    expect(issued.status).toBe("issued");
    await expectDomainError(removeInformationRequestItem(actor, { itemId: second.id }), "VO_REQUEST_ISSUED");

    const updated = await updateInformationRequestItem(actor, { itemId: second.id, status: "partially_received" });
    expect(updated.status).toBe("partially_received");
    await expectDomainError(
      issueInformationRequest(actor, { informationRequestId: ir.id, issuedOn: "2026-10-02" }),
      "VO_INVALID_TRANSITION",
    );
    const closed = await closeInformationRequest(actor, { informationRequestId: ir.id, closedOn: "2026-10-09" });
    expect(closed.status).toBe("closed");
  });

  it("rejects item statuses outside the workflow vocabulary", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    const ir = await createInformationRequest(actor, { projectId: project.id, reference: "IR-01", title: "IR" });
    const item = await addInformationRequestItem(actor, { informationRequestId: ir.id, description: "One" });
    await expectDomainError(
      // @ts-expect-error — invalid on purpose
      updateInformationRequestItem(actor, { itemId: item.id, status: "done" }),
      "VO_INVALID_INPUT",
    );
  });
});
