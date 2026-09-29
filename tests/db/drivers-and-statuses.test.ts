import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { COMMANDS } from "@/server/commands/names";
import { addAssumption, addValueDriver, createDraftVersion, updateDriverVersion } from "@/server/commands/value-case";
import { schema } from "@/server/db/client";

import { asCommand, expectDomainError, newActor, newProject, sql } from "../support/fixtures";

describe("value driver codes", () => {
  it("are unique within a Value Case", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "V1" });
    await addValueDriver(actor, { versionId: v1.id, code: "VD-01", name: "First" });
    await expectDomainError(
      addValueDriver(actor, { versionId: v1.id, code: "VD-01", name: "Duplicate" }),
      "VO_UNIQUE_VIOLATION",
    );
  });

  it("may repeat across different Value Cases", async () => {
    const actor = await newActor();
    const a = await newProject(actor);
    const b = await newProject(actor);
    const aV1 = await createDraftVersion(actor, { projectId: a.project.id, title: "V1" });
    const bV1 = await createDraftVersion(actor, { projectId: b.project.id, title: "V1" });
    await addValueDriver(actor, { versionId: aV1.id, code: "VD-01", name: "A" });
    await addValueDriver(actor, { versionId: bV1.id, code: "VD-01", name: "B" });
  });

  it("are immutable identities", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "V1" });
    const { driver } = await addValueDriver(actor, { versionId: v1.id, code: "VD-01", name: "First" });
    await expectDomainError(
      asCommand(actor, COMMANDS.updateDriverVersion, (tx) =>
        tx.update(schema.valueDriver).set({ code: "VD-99" }).where(eq(schema.valueDriver.id, driver.id)),
      ),
      "VO_FIELD_IMMUTABLE",
    );
  });

  it("cannot be blank", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "V1" });
    await expectDomainError(addValueDriver(actor, { versionId: v1.id, code: "  ", name: "x" }), "VO_INVALID_INPUT");
  });
});

describe("qualification and evidence statuses", () => {
  it("default to unqualified / unevidenced and accept the approved values", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "V1" });
    const { driverVersion } = await addValueDriver(actor, { versionId: v1.id, code: "VD-01", name: "D" });
    expect(driverVersion.qualificationStatus).toBe("unqualified");
    expect(driverVersion.evidenceStatus).toBe("unevidenced");

    for (const q of ["partially_qualified", "qualified"] as const) {
      const row = await updateDriverVersion(actor, { driverVersionId: driverVersion.id, qualificationStatus: q });
      expect(row.qualificationStatus).toBe(q);
    }
    for (const e of ["partially_evidenced", "evidenced"] as const) {
      const row = await updateDriverVersion(actor, { driverVersionId: driverVersion.id, evidenceStatus: e });
      expect(row.evidenceStatus).toBe(e);
    }
    const a = await addAssumption(actor, {
      driverVersionId: driverVersion.id,
      statement: "Volumes hold",
      evidenceStatus: "partially_evidenced",
    });
    expect(a.evidenceStatus).toBe("partially_evidenced");
  });

  it("reject invented statuses at the command boundary", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "V1" });
    const { driverVersion } = await addValueDriver(actor, { versionId: v1.id, code: "VD-01", name: "D" });
    await expectDomainError(
      // @ts-expect-error — invalid status on purpose
      updateDriverVersion(actor, { driverVersionId: driverVersion.id, qualificationStatus: "mostly_qualified" }),
      "VO_INVALID_INPUT",
    );
    await expectDomainError(
      // @ts-expect-error — qualification vocabulary is not an evidence status
      updateDriverVersion(actor, { driverVersionId: driverVersion.id, evidenceStatus: "qualified" }),
      "VO_INVALID_INPUT",
    );
  });

  it("reject invented statuses in the database itself", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "V1" });
    const { driverVersion } = await addValueDriver(actor, { versionId: v1.id, code: "VD-01", name: "D" });
    await expectDomainError(
      asCommand(actor, COMMANDS.updateDriverVersion, (tx) =>
        tx.execute(
          sql`update value_driver_version set evidence_status = 'evidenced_enough' where id = ${driverVersion.id}`,
        ),
      ),
      "VO_INVALID_VALUE",
    );
    await expectDomainError(
      asCommand(actor, COMMANDS.updateDriverVersion, (tx) =>
        tx.execute(
          sql`update value_driver_version set qualification_status = 'unevidenced' where id = ${driverVersion.id}`,
        ),
      ),
      "VO_INVALID_VALUE",
    );
  });
});
