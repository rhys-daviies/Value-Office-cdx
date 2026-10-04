import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { classifyDefinitionChange } from "@/domain/value-case";
import { recordEvidence } from "@/server/commands/evidence";
import { addStakeholder, setValueCaseOwner } from "@/server/commands/stakeholders";
import {
  addExistingDriverToOriginal,
  addValueDriver,
  authoriseInitialVersion,
  createDraftVersion,
  createInheritedBusinessCase,
  proposeVersion,
  recordInheritedBusinessCase,
  removeValueDriver,
  updateDriverVersion,
  updateVersionDetails,
} from "@/server/commands/value-case";
import { db, schema } from "@/server/db/client";
import { getDriverRegister } from "@/server/queries/drivers";
import { getMobilisationStatus } from "@/server/queries/projects";
import { getRequalificationWorkspace } from "@/server/queries/value-case";

import { expectDomainError, newActor, newProject } from "../support/fixtures";

// Phase 4D.10D: Original Business Case (V0 internally) → Value Case Definition → proposed / authorised V1, with the
// existing commands and identity model; and the late-baseline path that keeps driver identity without rewriting history.

async function withVco(actor: Awaited<ReturnType<typeof newActor>>) {
  const { project } = await newProject(actor);
  const { person: vco } = await addStakeholder(actor, { projectId: project.id, name: "Val Owner" });
  await setValueCaseOwner(actor, { projectId: project.id, personId: vco.id });
  return { project, vco };
}
const comparison = async (projectId: string) =>
  Object.fromEntries(
    (await getRequalificationWorkspace(projectId)).comparison.map((r) => [
      r.code,
      classifyDefinitionChange(r.inherited, r.requalified),
    ]),
  );
const presentation = async (projectId: string) =>
  Object.fromEntries((await getDriverRegister(projectId)).entries.map((e) => [e.driver.code, e.presentation]));

describe("Original Business Case capture and recording", () => {
  it("captures a headline, then drivers; edits while draft; records; is immutable afterwards", async () => {
    const actor = await newActor();
    const { project } = await withVco(actor);
    expect((await getRequalificationWorkspace(project.id)).inheritedVersion).toBeNull(); // absent

    const v0 = await createInheritedBusinessCase(actor, {
      projectId: project.id,
      title: "Original Business Case",
      statedTotalValue: "10000000.00",
    });
    const draftItem = (await getMobilisationStatus(project.id))!.status.outstanding.find(
      (x) => x.key === "original-business-case",
    )!;
    expect(draftItem.action).toEqual({ label: "Finish and record the Original Business Case", href: "value-case/v/0" });
    const { driverVersion: a } = await addValueDriver(actor, {
      versionId: v0.id,
      code: "VD-01",
      name: "Procurement",
      financialValue: "6000000.00",
    });
    await addValueDriver(actor, {
      versionId: v0.id,
      code: "VD-02",
      name: "Productivity",
      financialValue: "3000000.00",
    });
    // Drivers need not sum to the stated total ($9.0m vs $10.0m): no reconciliation rule.
    await updateDriverVersion(actor, {
      driverVersionId: a.id,
      financialValue: "6500000.00",
      name: "Procurement savings",
    });
    await recordInheritedBusinessCase(actor, { versionId: v0.id });

    await expectDomainError(
      updateDriverVersion(actor, { driverVersionId: a.id, financialValue: "1.00" }),
      "VO_VERSION_IMMUTABLE",
    );
    await expectDomainError(
      addValueDriver(actor, { versionId: v0.id, code: "VD-03", name: "Late", financialValue: "1.00" }),
      "VO_VERSION_IMMUTABLE",
    );
    await expectDomainError(
      updateVersionDetails(actor, { versionId: v0.id, statedTotalValue: "1.00" }),
      "VO_VERSION_IMMUTABLE",
    );
    const [row] = await db().select().from(schema.valueDriverVersion).where(eq(schema.valueDriverVersion.id, a.id));
    expect(row).toMatchObject({ financialValue: "6500000.00", name: "Procurement savings" });
    expect(await presentation(project.id)).toEqual({ "VD-01": "original_only", "VD-02": "original_only" });
  });

  it("records a headline-only Original Business Case", async () => {
    const actor = await newActor();
    const { project } = await withVco(actor);
    const v0 = await createInheritedBusinessCase(actor, {
      projectId: project.id,
      title: "OBC",
      statedTotalValue: "5000000.00",
    });
    await recordInheritedBusinessCase(actor, { versionId: v0.id });
    const ws = await getRequalificationWorkspace(project.id);
    expect(ws.inheritedVersion?.status).toBe("recorded");
    expect(ws.inheritedTotal).toBe("5000000.00");
    expect(ws.inheritedDrivers).toHaveLength(0);
  });
});

describe("Value Case Definition from the Original Business Case", () => {
  it("copies the recorded drivers into V1 with the same identities; classifies the definition; authorises", async () => {
    const actor = await newActor();
    const { project, vco } = await withVco(actor);
    const v0 = await createInheritedBusinessCase(actor, {
      projectId: project.id,
      title: "OBC",
      statedTotalValue: "9000000.00",
    });
    const { driver: d1 } = await addValueDriver(actor, {
      versionId: v0.id,
      code: "VD-01",
      name: "A",
      financialValue: "5000000.00",
    });
    const { driver: d2 } = await addValueDriver(actor, {
      versionId: v0.id,
      code: "VD-02",
      name: "B",
      financialValue: "3000000.00",
    });
    const { driver: d3 } = await addValueDriver(actor, {
      versionId: v0.id,
      code: "VD-03",
      name: "C",
      financialValue: "1000000.00",
    });
    await recordInheritedBusinessCase(actor, { versionId: v0.id });

    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "Value Case", basedOnVersionId: v0.id });
    const ws = await getRequalificationWorkspace(project.id);
    expect(ws.requalifiedDrivers.map((d) => d.valueDriverId)).toEqual([d1.id, d2.id, d3.id]); // same identities
    expect(await comparison(project.id)).toEqual({ "VD-01": "unchanged", "VD-02": "unchanged", "VD-03": "unchanged" });
    expect((await getMobilisationStatus(project.id))!.facts.v1?.basedOnOriginal).toBe(true);
    expect(await presentation(project.id)).toMatchObject({ "VD-01": "in_definition" });

    const byId = Object.fromEntries(ws.requalifiedDrivers.map((d) => [d.code, d.driverVersionId]));
    await updateDriverVersion(actor, { driverVersionId: byId["VD-02"]!, financialValue: "2500000.00" }); // adjusted
    await removeValueDriver(actor, { driverVersionId: byId["VD-03"]! }); // not carried forward
    await addValueDriver(actor, { versionId: v1.id, code: "VD-04", name: "New", financialValue: "750000.00" }); // new
    expect(await comparison(project.id)).toEqual({
      "VD-01": "unchanged",
      "VD-02": "adjusted",
      "VD-03": "not_carried_forward",
      "VD-04": "new",
    });
    // V0 is untouched by V1 edits.
    const v0Rows = await db()
      .select()
      .from(schema.valueDriverVersion)
      .where(eq(schema.valueDriverVersion.valueCaseVersionId, v0.id));
    expect(v0Rows.map((r) => r.financialValue).sort()).toEqual(["1000000.00", "3000000.00", "5000000.00"]);
    // VD-03 lives only in the Original Business Case now: never "Emerging".
    expect((await presentation(project.id))["VD-03"]).toBe("original_only");

    // Proposal and authorisation keep their existing gates.
    await proposeVersion(actor, { versionId: v1.id });
    const ev = await recordEvidence(actor, { projectId: project.id, code: "E-001", title: "Notice" });
    await authoriseInitialVersion(actor, {
      versionId: v1.id,
      authorisedByPersonId: vco.id,
      authorisedOn: "2026-10-01",
      authorisationEvidenceId: ev.id,
    });
    expect(await presentation(project.id)).toMatchObject({ "VD-01": "in_value_case", "VD-03": "original_only" });
  });

  it("starts V1 without an Original Business Case: every driver is new", async () => {
    const actor = await newActor();
    const { project } = await withVco(actor);
    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "Value Case" });
    await addValueDriver(actor, { versionId: v1.id, code: "VD-01", name: "A", financialValue: "1.00" });
    expect(await comparison(project.id)).toEqual({ "VD-01": "new" });
    expect((await getMobilisationStatus(project.id))!.facts.v1?.basedOnOriginal).toBe(false);
  });
});

describe("late Original Business Case (V1 already exists)", () => {
  it("records Original Business Case values against V1's existing drivers without touching V1", async () => {
    const actor = await newActor();
    const { project } = await withVco(actor);
    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "Value Case" });
    const { driver: d1 } = await addValueDriver(actor, {
      versionId: v1.id,
      code: "VD-01",
      name: "Procurement",
      financialValue: "4000000.00",
    });
    await addValueDriver(actor, {
      versionId: v1.id,
      code: "VD-02",
      name: "Productivity",
      financialValue: "2000000.00",
    });
    const v1Before = await db().select().from(schema.valueCaseVersion).where(eq(schema.valueCaseVersion.id, v1.id));

    const v0 = await createInheritedBusinessCase(actor, {
      projectId: project.id,
      title: "OBC",
      statedTotalValue: "7000000.00",
    });
    const row = await addExistingDriverToOriginal(actor, {
      versionId: v0.id,
      valueDriverId: d1.id,
      financialValue: "5000000.00",
    });
    expect(row).toMatchObject({ valueDriverId: d1.id, name: "Procurement", financialValue: "5000000.00" });
    await expectDomainError(
      addExistingDriverToOriginal(actor, { versionId: v0.id, valueDriverId: d1.id }),
      "VO_DRIVER_ALREADY_INCLUDED",
    );
    await expectDomainError(
      addExistingDriverToOriginal(actor, { versionId: v1.id, valueDriverId: d1.id }),
      "VO_INVALID_TRANSITION",
    ); // only into the Original Business Case
    await recordInheritedBusinessCase(actor, { versionId: v0.id });
    await expectDomainError(
      addExistingDriverToOriginal(actor, { versionId: v0.id, valueDriverId: d1.id }),
      "VO_VERSION_IMMUTABLE",
    ); // a recorded Original Business Case is never rewritten

    // V1 is unchanged: still not based on the Original Business Case; the comparison is by identity only.
    const v1After = await db().select().from(schema.valueCaseVersion).where(eq(schema.valueCaseVersion.id, v1.id));
    expect(v1After).toEqual(v1Before);
    expect(v1After[0]!.basedOnVersionId).toBeNull();
    expect(await comparison(project.id)).toEqual({ "VD-01": "adjusted", "VD-02": "new" });
    const m = (await getMobilisationStatus(project.id))!;
    expect(m.facts.v1?.basedOnOriginal).toBe(false);
    const obc = [...m.status.completed, ...m.status.outstanding].find((i) => i.key === "original-business-case")!;
    expect(obc.detail).toMatch(/V1 was not copied from it/);
  });

  it("refuses a driver from another Value Case", async () => {
    const actor = await newActor();
    const { project } = await withVco(actor);
    const { project: other } = await withVco(actor);
    const ov1 = await createDraftVersion(actor, { projectId: other.id, title: "Other" });
    const { driver: foreign } = await addValueDriver(actor, {
      versionId: ov1.id,
      code: "VD-01",
      name: "X",
      financialValue: "1.00",
    });
    const v0 = await createInheritedBusinessCase(actor, { projectId: project.id, title: "OBC" });
    await expectDomainError(
      addExistingDriverToOriginal(actor, { versionId: v0.id, valueDriverId: foreign.id }),
      "VO_NOT_FOUND",
    );
  });
});
