import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { toDbMoney } from "@/domain/money";
import { HORIZON, seedHorizon } from "@/fixtures/horizon";
import { recordEvidence } from "@/server/commands/evidence";
import { COMMANDS } from "@/server/commands/names";
import { setProjectValueBasis } from "@/server/commands/project";
import { addStakeholder, setValueCaseOwner } from "@/server/commands/stakeholders";
import {
  addAssumption,
  addValueDriver,
  authoriseInitialVersion,
  createDraftVersion,
  createInheritedBusinessCase,
  linkEvidence,
  proposeVersion,
  recordInheritedBusinessCase,
  returnVersionToDraft,
  updateDriverVersion,
} from "@/server/commands/value-case";
import { db, schema } from "@/server/db/client";
import { getVersionTotal } from "@/server/queries/value-case";

import { asCommand, expectDomainError, newActor, newProject, proposedV1, sql, uid } from "../support/fixtures";

const today = new Date().toISOString().slice(0, 10);

async function authorisedV1() {
  const actor = await newActor();
  const ctx = await proposedV1(actor);
  const v1 = await authoriseInitialVersion(actor, {
    versionId: ctx.v1.id,
    authorisedByPersonId: ctx.vco.id,
    authorisedOn: today,
    authorisationEvidenceId: ctx.evidence.id,
  });
  return { actor, ...ctx, v1 };
}

describe("initial VCO authorisation path", () => {
  it("authorises a proposed V1 when recorded against the VCO with evidence", async () => {
    const { actor, v1, vco, evidence } = await authorisedV1();
    expect(v1.status).toBe("authorised");
    expect(v1.versionNumber).toBe(1);
    expect(v1.authorisedByPersonId).toBe(vco.id);
    expect(v1.authorisationEvidenceId).toBe(evidence.id);
    expect(v1.authorisationRecordedBy).toBe(actor.userId);
  });

  it("rejects authorisation by anyone other than the VCO", async () => {
    const actor = await newActor();
    const { v1, other, evidence } = await proposedV1(actor);
    await expectDomainError(
      authoriseInitialVersion(actor, {
        versionId: v1.id,
        authorisedByPersonId: other.id,
        authorisedOn: today,
        authorisationEvidenceId: evidence.id,
      }),
      "VO_NOT_VCO",
    );
  });

  it("enforces the VCO rule in the database beneath the command layer", async () => {
    const actor = await newActor();
    const { v1, other, evidence } = await proposedV1(actor);
    await expectDomainError(
      asCommand(actor, COMMANDS.authoriseInitialVersion, (tx) =>
        tx
          .update(schema.valueCaseVersion)
          .set({
            status: "authorised",
            authorisedOn: today,
            authorisedByPersonId: other.id,
            authorisationEvidenceId: evidence.id,
            authorisationRecordedBy: actor.userId,
            authorisationRecordedAt: new Date(),
          })
          .where(eq(schema.valueCaseVersion.id, v1.id)),
      ),
      "VO_NOT_VCO",
    );
  });

  it("rejects authorisation from any other command", async () => {
    const actor = await newActor();
    const { v1, vco, evidence } = await proposedV1(actor);
    await expectDomainError(
      asCommand(actor, COMMANDS.updateDriverVersion, (tx) =>
        tx
          .update(schema.valueCaseVersion)
          .set({
            status: "authorised",
            authorisedOn: today,
            authorisedByPersonId: vco.id,
            authorisationEvidenceId: evidence.id,
            authorisationRecordedBy: actor.userId,
            authorisationRecordedAt: new Date(),
          })
          .where(eq(schema.valueCaseVersion.id, v1.id)),
      ),
      "VO_WRONG_COMMAND",
    );
  });

  it("requires authorisation evidence", async () => {
    const actor = await newActor();
    const { v1, vco } = await proposedV1(actor);
    await expectDomainError(
      asCommand(actor, COMMANDS.authoriseInitialVersion, (tx) =>
        tx
          .update(schema.valueCaseVersion)
          .set({
            status: "authorised",
            authorisedOn: today,
            authorisedByPersonId: vco.id,
            authorisationRecordedBy: actor.userId,
            authorisationRecordedAt: new Date(),
          })
          .where(eq(schema.valueCaseVersion.id, v1.id)),
      ),
      "VO_CHECK_VIOLATION",
    );
  });

  it("cannot skip the proposal step", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    const { person: vco } = await addStakeholder(actor, { projectId: project.id, name: "VCO" });
    await setValueCaseOwner(actor, { projectId: project.id, personId: vco.id });
    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "V1" });
    await addValueDriver(actor, { versionId: v1.id, code: "VD-01", name: "D", financialValue: "1.00" });
    const evidence = await recordEvidence(actor, { projectId: project.id, code: "E-1", title: "Auth" });
    await expectDomainError(
      authoriseInitialVersion(actor, {
        versionId: v1.id,
        authorisedByPersonId: vco.id,
        authorisedOn: today,
        authorisationEvidenceId: evidence.id,
      }),
      "VO_INVALID_TRANSITION",
    );
  });

  it("cannot insert a version that is already authorised", async () => {
    const actor = await newActor();
    const { project, valueCase } = await newProject(actor);
    await expectDomainError(
      asCommand(actor, COMMANDS.createDraftVersion, (tx) =>
        tx.insert(schema.valueCaseVersion).values({
          valueCaseId: valueCase.id,
          projectId: project.id,
          versionNumber: 1,
          kind: "value_case",
          status: "authorised",
          title: "Forged",
          createdBy: actor.userId,
        }),
      ),
      "VO_VERSION_INSERT_NOT_DRAFT",
    );
  });

  it("rejects future-dated authorisation", async () => {
    const actor = await newActor();
    const { v1, vco, evidence } = await proposedV1(actor);
    await expectDomainError(
      authoriseInitialVersion(actor, {
        versionId: v1.id,
        authorisedByPersonId: vco.id,
        authorisedOn: "2999-01-01",
        authorisationEvidenceId: evidence.id,
      }),
      "VO_FUTURE_AUTHORISATION",
    );
  });

  it("requires a project Value Basis before proposal", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor, { valueBasis: false });
    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "V1" });
    await addValueDriver(actor, { versionId: v1.id, code: "VD-01", name: "D" });
    await expectDomainError(proposeVersion(actor, { versionId: v1.id }), "VO_VALUE_BASIS_REQUIRED");
  });

  it("requires at least one driver before proposal", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "V1" });
    await expectDomainError(proposeVersion(actor, { versionId: v1.id }), "VO_NO_DRIVERS");
  });

  it("allows a proposed version to be returned to draft and edited", async () => {
    const actor = await newActor();
    const { v1, driverVersion } = await proposedV1(actor);
    await expectDomainError(
      updateDriverVersion(actor, { driverVersionId: driverVersion.id, financialValue: "1.00" }),
      "VO_VERSION_IMMUTABLE",
    );
    await returnVersionToDraft(actor, { versionId: v1.id });
    const row = await updateDriverVersion(actor, { driverVersionId: driverVersion.id, financialValue: "1.00" });
    expect(row.financialValue).toBe("1.00");
  });
});

describe("authorised versions are immutable", () => {
  it("rejects edits to the authorised version itself", async () => {
    const { actor, v1 } = await authorisedV1();
    for (const cmd of [COMMANDS.createDraftVersion, COMMANDS.authoriseInitialVersion]) {
      await expectDomainError(
        asCommand(actor, cmd, (tx) =>
          tx.update(schema.valueCaseVersion).set({ title: "Rewritten" }).where(eq(schema.valueCaseVersion.id, v1.id)),
        ),
        "VO_VERSION_IMMUTABLE",
      );
    }
    await expectDomainError(
      asCommand(actor, COMMANDS.returnVersionToDraft, (tx) =>
        tx.update(schema.valueCaseVersion).set({ status: "draft" }).where(eq(schema.valueCaseVersion.id, v1.id)),
      ),
      "VO_VERSION_IMMUTABLE",
    );
    await expectDomainError(
      asCommand(actor, COMMANDS.createDraftVersion, (tx) =>
        tx.delete(schema.valueCaseVersion).where(eq(schema.valueCaseVersion.id, v1.id)),
      ),
      "VO_VERSION_IMMUTABLE",
    );
  });

  it("rejects edits, additions and deletions of authorised driver versions", async () => {
    const { actor, v1, driverVersion } = await authorisedV1();
    await expectDomainError(
      updateDriverVersion(actor, { driverVersionId: driverVersion.id, financialValue: "9999999.00" }),
      "VO_VERSION_IMMUTABLE",
    );
    await expectDomainError(
      updateDriverVersion(actor, { driverVersionId: driverVersion.id, qualificationStatus: "qualified" }),
      "VO_VERSION_IMMUTABLE",
    );
    await expectDomainError(
      addValueDriver(actor, { versionId: v1.id, code: "VD-02", name: "Late addition" }),
      "VO_VERSION_IMMUTABLE",
    );
    await expectDomainError(
      asCommand(actor, COMMANDS.updateDriverVersion, (tx) =>
        tx.delete(schema.valueDriverVersion).where(eq(schema.valueDriverVersion.id, driverVersion.id)),
      ),
      "VO_VERSION_IMMUTABLE",
    );
  });

  it("rejects new assumptions and evidence links on an authorised version", async () => {
    const { actor, project, driverVersion } = await authorisedV1();
    await expectDomainError(
      addAssumption(actor, { driverVersionId: driverVersion.id, statement: "After the fact" }),
      "VO_VERSION_IMMUTABLE",
    );
    const e = await recordEvidence(actor, { projectId: project.id, code: "E-LATE", title: "Late" });
    await expectDomainError(
      linkEvidence(actor, { evidenceId: e.id, driverVersionId: driverVersion.id }),
      "VO_VERSION_IMMUTABLE",
    );
  });

  it("freezes evidence relied on by the authorised version", async () => {
    const { actor, evidence } = await authorisedV1();
    await expectDomainError(
      asCommand(actor, COMMANDS.recordEvidence, (tx) =>
        tx.update(schema.evidence).set({ title: "Changed" }).where(eq(schema.evidence.id, evidence.id)),
      ),
      "VO_EVIDENCE_LOCKED",
    );
  });

  it("locks the project currency and Value Basis", async () => {
    const { actor, project } = await authorisedV1();
    await expectDomainError(
      setProjectValueBasis(actor, { projectId: project.id, valueBasisDescription: "Something else" }),
      "VO_VALUE_BASIS_LOCKED",
    );
    await expectDomainError(
      asCommand(actor, COMMANDS.setProjectValueBasis, (tx) =>
        tx.update(schema.project).set({ currency: "EUR" }).where(eq(schema.project.id, project.id)),
      ),
      "VO_VALUE_BASIS_LOCKED",
    );
  });

  it("cannot be superseded without a Value Change", async () => {
    const { actor, v1 } = await authorisedV1();
    await expectDomainError(
      asCommand(actor, COMMANDS.createDraftVersion, (tx) =>
        tx
          .update(schema.valueCaseVersion)
          .set({ status: "superseded", supersededAt: new Date() })
          .where(eq(schema.valueCaseVersion.id, v1.id)),
      ),
      "VO_VALUE_CHANGE_REQUIRED",
    );
  });

  it("blocks creating or authorising a later version outside a Value Change", async () => {
    const { actor, project, v1, vco, evidence } = await authorisedV1();
    await expectDomainError(
      createDraftVersion(actor, { projectId: project.id, title: "V2", basedOnVersionId: v1.id }),
      "VO_VALUE_CHANGE_REQUIRED",
    );
    // Beneath the command layer, a V2 row cannot even be inserted outside a Value Change…
    const v2Row = {
      valueCaseId: v1.valueCaseId,
      projectId: project.id,
      versionNumber: 2,
      kind: "value_case" as const,
      title: "V2",
      createdBy: actor.userId,
    };
    await expectDomainError(
      asCommand(actor, COMMANDS.createDraftVersion, (tx) => tx.insert(schema.valueCaseVersion).values(v2Row)),
      "VO_VALUE_CHANGE_REQUIRED",
    );
    // …and even if forced in under the Value Change command name without a Value Change,
    // the initial V1 path can neither propose nor authorise it.
    const [v2] = await asCommand(actor, COMMANDS.createValueChange, (tx) =>
      tx.insert(schema.valueCaseVersion).values(v2Row).returning(),
    );
    await addValueDriver(actor, { versionId: v2!.id, code: "VD-02", name: "D2" });
    await expectDomainError(proposeVersion(actor, { versionId: v2!.id }), "VO_WRONG_COMMAND");
    await expectDomainError(
      authoriseInitialVersion(actor, {
        versionId: v2!.id,
        authorisedByPersonId: vco.id,
        authorisedOn: today,
        authorisationEvidenceId: evidence.id,
      }),
      "VO_INVALID_TRANSITION",
    );
  });
});

describe("inherited Business Case (V0) and copy-on-write", () => {
  it("records V0 immutably and copies drivers, assumptions and links into draft V1", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    const v0 = await createInheritedBusinessCase(actor, {
      projectId: project.id,
      title: "Original Business Case",
      statedTotalValue: "18000000.00",
    });
    const { driverVersion: v0Driver } = await addValueDriver(actor, {
      versionId: v0.id,
      code: "VD-01",
      name: "Inherited driver",
      financialValue: "18000000.00",
    });
    const assumption = await addAssumption(actor, { driverVersionId: v0Driver.id, statement: "Inherited assumption" });
    const e = await recordEvidence(actor, { projectId: project.id, code: `E-${uid()}`, title: "BC document" });
    await linkEvidence(actor, { evidenceId: e.id, driverVersionId: v0Driver.id });
    await linkEvidence(actor, { evidenceId: e.id, assumptionId: assumption.id });

    await expectDomainError(
      createDraftVersion(actor, { projectId: project.id, title: "V1", basedOnVersionId: v0.id }),
      "VO_SOURCE_NOT_LOCKED",
    );
    await recordInheritedBusinessCase(actor, { versionId: v0.id });
    await expectDomainError(
      updateDriverVersion(actor, { driverVersionId: v0Driver.id, financialValue: "1.00" }),
      "VO_VERSION_IMMUTABLE",
    );
    await expectDomainError(
      asCommand(actor, COMMANDS.createInheritedBusinessCase, (tx) =>
        tx
          .update(schema.valueCaseVersion)
          .set({ statedTotalValue: "1.00" })
          .where(eq(schema.valueCaseVersion.id, v0.id)),
      ),
      "VO_VERSION_IMMUTABLE",
    );

    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "V1", basedOnVersionId: v0.id });
    expect(v1.versionNumber).toBe(1);
    expect(v1.basedOnVersionId).toBe(v0.id);

    const [v1Driver] = await db()
      .select()
      .from(schema.valueDriverVersion)
      .where(eq(schema.valueDriverVersion.valueCaseVersionId, v1.id));
    expect(v1Driver!.valueDriverId).toBe(v0Driver.valueDriverId); // same stable identity
    expect(v1Driver!.id).not.toBe(v0Driver.id); // new content row

    const copiedLinks = await db().execute(sql`
      select count(*)::int as n from evidence_link l
      left join assumption a on a.id = l.assumption_id
      where l.value_driver_version_id = ${v1Driver!.id} or a.value_driver_version_id = ${v1Driver!.id}`);
    expect((copiedLinks.rows[0] as { n: number }).n).toBe(2);

    // Re-qualifying V1 leaves V0 untouched.
    await updateDriverVersion(actor, { driverVersionId: v1Driver!.id, financialValue: "15500000.00" });
    const [v0After] = await db()
      .select()
      .from(schema.valueDriverVersion)
      .where(eq(schema.valueDriverVersion.id, v0Driver.id));
    expect(v0After!.financialValue).toBe("18000000.00");
  });

  it("only allows one open Value Case version at a time", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    await createDraftVersion(actor, { projectId: project.id, title: "V1" });
    await expectDomainError(
      createDraftVersion(actor, { projectId: project.id, title: "V1 again" }),
      "VO_UNIQUE_VIOLATION",
    );
  });
});

describe("Project Horizon acceptance (through Authorised V1)", () => {
  it("builds through the public commands to the known headline figures", async () => {
    const actor = await newActor();
    const { project, v0, v1 } = await seedHorizon(actor, { projectCode: `HORIZON-${uid()}` });

    expect(v0.status).toBe("recorded");
    expect(v0.statedTotalValue).toBe(HORIZON.originalBusinessCaseValue);
    expect(v1.status).toBe("authorised");
    expect(v1.versionNumber).toBe(1);

    const { total, driversWithoutValue } = await getVersionTotal(v1.id);
    expect(toDbMoney(total)).toBe("15500000.00");
    expect(driversWithoutValue).toBe(0);

    const drivers = await db()
      .select({
        code: schema.valueDriver.code,
        name: schema.valueDriverVersion.name,
        value: schema.valueDriverVersion.financialValue,
        baseline: schema.valueDriverVersion.baselineValue,
        target: schema.valueDriverVersion.targetValue,
      })
      .from(schema.valueDriverVersion)
      .innerJoin(schema.valueDriver, eq(schema.valueDriver.id, schema.valueDriverVersion.valueDriverId))
      .where(eq(schema.valueDriverVersion.valueCaseVersionId, v1.id))
      .orderBy(schema.valueDriverVersion.sortOrder);
    expect(drivers).toHaveLength(6);
    expect(drivers.map((d) => [d.code, d.name, d.value])).toEqual(
      HORIZON.drivers.map((d) => [d.code, d.name, d.financialValue]),
    );
    expect(Number(drivers[1]!.baseline)).toBe(10.2);
    expect(Number(drivers[1]!.target)).toBe(8.5);

    const [p] = await db().select().from(schema.project).where(eq(schema.project.id, project.id));
    expect(p!.currency).toBe("USD");
  });
});
