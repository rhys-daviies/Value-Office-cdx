import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createReview, finaliseReview, upsertValuePositions } from "@/server/commands/assurance";
import {
  addDriverAssumption,
  createEmergingDriver,
  initialiseDriverRecord,
  removeDriverAssumption,
  setDriverAvo,
  setDriverEstimate,
  setDriverEvidenceStatus,
  setDriverQualification,
  updateDriverAssumption,
  updateDriverWorking,
} from "@/server/commands/drivers";
import { linkDriverEvidence, recordEvidence } from "@/server/commands/evidence";
import { addInformationRequestItem, createInformationRequest } from "@/server/commands/information-request";
import { documentMatterEvidence } from "@/server/commands/matter-evidence";
import { createMatter } from "@/server/commands/matters";
import { COMMANDS } from "@/server/commands/names";
import { addStakeholder } from "@/server/commands/stakeholders";
import {
  addValueDriver,
  authoriseInitialVersion,
  createDraftVersion,
  removeValueDriver,
  updateDriverVersion,
} from "@/server/commands/value-case";
import {
  authoriseValueChange,
  createValueChange,
  includeDriverInValueChange,
  proposeValueChange,
  updateValueChange,
} from "@/server/commands/value-change";
import { db, schema } from "@/server/db/client";
import { getValuePositionSummary } from "@/server/queries/assurance";
import { getDriverDetail, getDriverRegister } from "@/server/queries/drivers";
import { buildAssuranceReport, buildRequalificationReport, getReportIssue } from "@/server/queries/reports";
import { issueReport } from "@/server/reports/issue";
import { renderReportArticle } from "@/ui/reports/render";

import { asCommand, expectDomainError, newActor, newProject, proposedV1, sql, uid } from "../support/fixtures";

// Phase 4D.3: living and emerging Value Drivers. A value_driver_record is the WORKING understanding
// of a stable identity; it never rewrites a value_driver_version and never reaches any governed
// total. An emerging driver joins the Authorised Value Case only through a Value Change.

const today = new Date().toISOString().slice(0, 10);
const text = (m: string) =>
  m
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

/** Authorised V1: VD-01 $4.8m, AVO "Someone Else"; a finalised review forecasting $4.5m, realised $1m. */
async function project() {
  const actor = await newActor();
  const ctx = await proposedV1(actor);
  const v1 = await authoriseInitialVersion(actor, {
    versionId: ctx.v1.id,
    authorisedByPersonId: ctx.vco.id,
    authorisedOn: today,
    authorisationEvidenceId: ctx.evidence.id,
  });
  const { person: jon } = await addStakeholder(actor, { projectId: ctx.project.id, name: "Jon Working" });
  const review = await createReview(actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate: today });
  await upsertValuePositions(actor, {
    reviewId: review.id,
    positions: [{ valueDriverId: ctx.driver.id, currentForecast: "4500000.00", realisedValue: "1000000.00" }],
  });
  await finaliseReview(actor, { reviewId: review.id });
  return { actor, ...ctx, v1, jon, review };
}
type Ctx = Awaited<ReturnType<typeof project>>;

async function governed(ctx: Ctx) {
  const versions = await db()
    .select()
    .from(schema.valueCaseVersion)
    .where(eq(schema.valueCaseVersion.projectId, ctx.project.id));
  const driverVersions = await db()
    .select()
    .from(schema.valueDriverVersion)
    .where(eq(schema.valueDriverVersion.projectId, ctx.project.id));
  const positions = await db()
    .select()
    .from(schema.valuePosition)
    .where(eq(schema.valuePosition.projectId, ctx.project.id));
  const changes = await db().select().from(schema.valueChange).where(eq(schema.valueChange.projectId, ctx.project.id));
  const summary = await getValuePositionSummary(ctx.project.id);
  return JSON.stringify({ versions, driverVersions, positions, changes, summary });
}

const v1Row = async (ctx: Ctx) =>
  (
    await db().select().from(schema.valueDriverVersion).where(eq(schema.valueDriverVersion.id, ctx.driverVersion.id))
  )[0]!;

const emerging = (ctx: Ctx, over: Partial<Parameters<typeof createEmergingDriver>[1]> = {}) =>
  createEmergingDriver(ctx.actor, {
    projectId: ctx.project.id,
    code: `VD-${uid().slice(0, 4)}`,
    name: "Automation Opportunity",
    ...over,
  });

const entryOf = async (ctx: Ctx, driverId: string) =>
  (await getDriverRegister(ctx.project.id)).entries.find((e) => e.driver.id === driverId)!;

// ---------------------------------------------------------------------------

describe("living record of an existing authorised driver", () => {
  it("starts from V1 and then evolves without touching V1, its AVO, statuses or any total", async () => {
    const ctx = await project();
    const before = await governed(ctx);
    const pre = await entryOf(ctx, ctx.driver.id);
    expect(pre).toMatchObject({ status: "in_value_case", record: null, fromVersion: 1 });
    expect(pre.working!.workingEstimate).toBe("4800000.00");

    const rec = await initialiseDriverRecord(ctx.actor, { valueDriverId: ctx.driver.id });
    expect(rec).toMatchObject({
      initialisedFromVersionId: ctx.v1.id,
      identifiedOn: null,
      name: "Service Productivity",
    });
    await updateDriverWorking(ctx.actor, { valueDriverId: ctx.driver.id, targetValue: "18", notes: "Target now 18%" });
    await setDriverAvo(ctx.actor, { valueDriverId: ctx.driver.id, avoPersonId: ctx.jon.id });
    await setDriverQualification(ctx.actor, {
      valueDriverId: ctx.driver.id,
      qualificationStatus: "partially_qualified",
    });
    await setDriverEvidenceStatus(ctx.actor, { valueDriverId: ctx.driver.id, evidenceStatus: "partially_evidenced" });
    await setDriverEstimate(ctx.actor, { valueDriverId: ctx.driver.id, workingEstimate: "8500000.00" });

    expect(await governed(ctx)).toBe(before); // V1, positions, forecast, gap, realised, AV
    const v1 = await v1Row(ctx);
    expect(v1).toMatchObject({
      avoPersonId: ctx.other.id,
      qualificationStatus: "unqualified",
      financialValue: "4800000.00",
    });
    const e = await entryOf(ctx, ctx.driver.id);
    expect(e.record).toMatchObject({
      avoPersonId: ctx.jon.id,
      qualificationStatus: "partially_qualified",
      evidenceStatus: "partially_evidenced",
      workingEstimate: "8500000.00",
      estimateRecordedBy: ctx.actor.userId,
    });
    expect(e.avoName).toBe("Jon Working");
    expect(e.authorised).toEqual({ versionNumber: 1, financialValue: "4800000.00" });
    expect(e.forecast).toMatchObject({ currentForecast: "4500000.00", reviewSequence: 1 }); // not the estimate
    const summary = await getValuePositionSummary(ctx.project.id);
    expect(summary.authorisedTotal).toBe("4800000.00");
    expect(summary.latest!.totals).toMatchObject({
      forecastTotal: "4500000.00",
      valueGap: "300000.00",
      realisedTotal: "1000000.00",
    });
    await expectDomainError(initialiseDriverRecord(ctx.actor, { valueDriverId: ctx.driver.id }), "VO_UNIQUE_VIOLATION");
  });

  it("each group of working fields changes only through its own command; records are never deleted", async () => {
    const ctx = await project();
    const rec = await initialiseDriverRecord(ctx.actor, { valueDriverId: ctx.driver.id });
    const raw = (command: (typeof COMMANDS)[keyof typeof COMMANDS], set: Record<string, unknown>) =>
      asCommand(ctx.actor, command, (tx) =>
        tx.update(schema.valueDriverRecord).set(set).where(eq(schema.valueDriverRecord.id, rec.id)),
      );
    await expectDomainError(raw(COMMANDS.updateDriverWorking, { workingEstimate: "1.00" }), "VO_WRONG_COMMAND");
    await expectDomainError(raw(COMMANDS.setDriverEstimate, { avoPersonId: ctx.jon.id }), "VO_WRONG_COMMAND");
    await expectDomainError(raw(COMMANDS.setDriverAvo, { qualificationStatus: "qualified" }), "VO_WRONG_COMMAND");
    await expectDomainError(raw(COMMANDS.updateDriverWorking, { initialisedFromVersionId: null }), "VO_WRONG_COMMAND");
    // Attribution is the database's, not the caller's: a forged recorder is overwritten.
    await raw(COMMANDS.setDriverEstimate, { workingEstimate: "5.00", estimateRecordedBy: (await newActor()).userId });
    const [attributed] = await db()
      .select()
      .from(schema.valueDriverRecord)
      .where(eq(schema.valueDriverRecord.id, rec.id));
    expect(attributed).toMatchObject({ workingEstimate: "5.00", estimateRecordedBy: ctx.actor.userId });
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.updateDriverWorking, (tx) =>
        tx.delete(schema.valueDriverRecord).where(eq(schema.valueDriverRecord.id, rec.id)),
      ),
      "VO_FIELD_IMMUTABLE",
    );
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.updateDriverWorking, (tx) =>
        tx
          .insert(schema.valueDriverRecord)
          .values({ valueDriverId: ctx.driver.id, projectId: ctx.project.id, name: "x", createdBy: ctx.actor.userId }),
      ),
      "VO_WRONG_COMMAND",
    );
    await expectDomainError(
      setDriverEstimate(ctx.actor, { valueDriverId: ctx.driver.id, workingEstimate: "-1.00" }),
      "VO_INVALID_INPUT",
    );
  });
});

describe("emerging drivers", () => {
  it("are identified after V1 without a version, a Value Change or any change to governed totals", async () => {
    const ctx = await project();
    const before = await governed(ctx);
    const { driver, record } = await emerging(ctx, {
      avoPersonId: ctx.jon.id,
      qualificationStatus: "partially_qualified",
    });
    expect(record).toMatchObject({ identifiedOn: today, workingEstimate: null, estimateRecordedBy: null });
    expect(await governed(ctx)).toBe(before); // no V2, no Value Change, AV/forecast/gap/realised unchanged

    const e = await entryOf(ctx, driver.id);
    expect(e).toMatchObject({ status: "emerging", authorised: null, forecast: null, fromVersion: null });
    expect(e.working!.workingEstimate).toBeNull(); // not yet quantified — never zero

    await setDriverEstimate(ctx.actor, { valueDriverId: driver.id, workingEstimate: "3000000.00" });
    expect(await governed(ctx)).toBe(before);
    expect((await getValuePositionSummary(ctx.project.id)).authorisedTotal).toBe("4800000.00");

    // Formal positions stay restricted to the measured-against version's drivers.
    const review = await createReview(ctx.actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate: today });
    await expectDomainError(
      upsertValuePositions(ctx.actor, {
        reviewId: review.id,
        positions: [{ valueDriverId: driver.id, currentForecast: "3000000.00" }],
      }),
      "VO_DRIVER_NOT_IN_VERSION",
    );
  });

  it("require an authorised Value Case, a non-future date and a unique code", async () => {
    const actor = await newActor();
    const pre = await proposedV1(actor);
    await expectDomainError(
      createEmergingDriver(actor, { projectId: pre.project.id, code: "VD-09", name: "x" }),
      "VO_VERSION_NOT_AUTHORISED",
    );
    const ctx = await project();
    await expectDomainError(emerging(ctx, { identifiedOn: "2999-01-01" }), "VO_INVALID_INPUT");
    await expectDomainError(emerging(ctx, { code: "VD-01" }), "VO_UNIQUE_VIOLATION");
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.createMatter, (tx) =>
        tx
          .insert(schema.valueDriver)
          .values({ valueCaseId: ctx.driver.valueCaseId, projectId: ctx.project.id, code: "VD-X" }),
      ),
      "VO_WRONG_COMMAND",
    );
  });

  it("gather 4D.2 evidence, originate from an Assurance matter and hold working assumptions", async () => {
    const ctx = await project();
    const matter = await createMatter(ctx.actor, {
      projectId: ctx.project.id,
      code: `VL-${uid()}`,
      title: "Vendor constraint",
    });
    const { driver, record } = await emerging(ctx, { originValueLeakageId: matter.id });
    const e = await recordEvidence(ctx.actor, {
      projectId: ctx.project.id,
      code: `E-${uid()}`,
      title: "Automation pilot",
    });
    await linkDriverEvidence(ctx.actor, { evidenceId: e.id, valueDriverId: driver.id });
    await documentMatterEvidence(ctx.actor, {
      matterId: matter.id,
      code: `E-${uid()}`,
      title: "Bot throughput",
      valueDriverId: driver.id,
    });
    const a = await addDriverAssumption(ctx.actor, {
      valueDriverId: driver.id,
      statement: "40% of tickets automatable",
    });
    await updateDriverAssumption(ctx.actor, { assumptionId: a.id, evidenceStatus: "partially_evidenced" });
    const b = await addDriverAssumption(ctx.actor, { valueDriverId: driver.id, statement: "Temporary" });
    await removeDriverAssumption(ctx.actor, { assumptionId: b.id });
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.addDriverAssumption, (tx) =>
        tx.delete(schema.valueDriverRecordAssumption).where(eq(schema.valueDriverRecordAssumption.id, a.id)),
      ),
      "VO_WRONG_COMMAND",
    );

    const detail = (await getDriverDetail(ctx.project.id, driver.id))!;
    expect(detail.entry.origin).toMatchObject({ id: matter.id, code: matter.code });
    expect(detail.workingEvidence).toHaveLength(2);
    expect(detail.formalEvidence).toEqual([]);
    expect(detail.assumptions.map((x) => [x.statement, x.evidenceStatus])).toEqual([
      ["40% of tickets automatable", "partially_evidenced"],
    ]);
    expect(detail.history).toEqual([]);
    expect(record.originValueLeakageId).toBe(matter.id);
  });
});

describe("including an emerging driver through a Value Change", () => {
  it("adds its own draft row with the same identity; V1 unchanged; no hidden synchronisation", async () => {
    const ctx = await project();
    const { driver } = await emerging(ctx, { avoPersonId: ctx.jon.id, qualificationStatus: "partially_qualified" });
    await setDriverEstimate(ctx.actor, { valueDriverId: driver.id, workingEstimate: "3000000.00" });
    await addDriverAssumption(ctx.actor, { valueDriverId: driver.id, statement: "40% automatable" });
    const v1Before = JSON.stringify(await v1Row(ctx));

    const { change, version: v2 } = await createValueChange(ctx.actor, {
      projectId: ctx.project.id,
      code: "VC-001",
      statedChangeAmount: "3000000.00",
    });
    const included = await includeDriverInValueChange(ctx.actor, { changeId: change.id, valueDriverId: driver.id });
    expect(included).toMatchObject({
      valueDriverId: driver.id, // same stable identity
      valueCaseVersionId: v2.id,
      financialValue: "3000000.00",
      avoPersonId: ctx.jon.id,
      qualificationStatus: "partially_qualified",
    });
    const copied = await db()
      .select()
      .from(schema.assumption)
      .where(eq(schema.assumption.valueDriverVersionId, included.id));
    expect(copied.map((a) => a.statement)).toEqual(["40% automatable"]);
    await expectDomainError(
      includeDriverInValueChange(ctx.actor, { changeId: change.id, valueDriverId: driver.id }),
      "VO_DRIVER_ALREADY_INCLUDED",
    );
    expect(JSON.stringify(await v1Row(ctx))).toBe(v1Before);
    const inV1 = await db()
      .select()
      .from(schema.valueDriverVersion)
      .where(eq(schema.valueDriverVersion.valueCaseVersionId, ctx.v1.id));
    expect(inV1.map((d) => d.valueDriverId)).not.toContain(driver.id);

    // No synchronisation in either direction.
    await setDriverEstimate(ctx.actor, { valueDriverId: driver.id, workingEstimate: "3500000.00" });
    await updateDriverWorking(ctx.actor, { valueDriverId: driver.id, name: "Automation (living)" });
    const [draftRow] = await db()
      .select()
      .from(schema.valueDriverVersion)
      .where(eq(schema.valueDriverVersion.id, included.id));
    expect(draftRow).toMatchObject({ financialValue: "3000000.00", name: "Automation Opportunity" });
    await updateDriverVersion(ctx.actor, { driverVersionId: included.id, financialValue: "2500000.00" });
    const e = await entryOf(ctx, driver.id);
    expect(e.record).toMatchObject({ workingEstimate: "3500000.00", name: "Automation (living)" });
    expect(e.status).toBe("emerging"); // still not authorised

    // Reconciliation still governs: stated +3.0m, drivers now +2.5m.
    await updateValueChange(ctx.actor, { changeId: change.id, reason: "Automation opportunity" });
    await proposeValueChange(ctx.actor, { changeId: change.id });
    const authorise = () =>
      authoriseValueChange(ctx.actor, {
        changeId: change.id,
        authorisedByPersonId: ctx.vco.id,
        authorisedOn: today,
        authorisationEvidenceId: ctx.evidence.id,
      });
    await expectDomainError(authorise(), "VO_CHANGE_NOT_RECONCILED");
  });

  it("follows the existing VCO path once reconciled; the driver is then in V2 and still absent from V1", async () => {
    const ctx = await project();
    const { driver } = await emerging(ctx);
    await setDriverEstimate(ctx.actor, { valueDriverId: driver.id, workingEstimate: "3000000.00" });
    const { change, version: v2 } = await createValueChange(ctx.actor, {
      projectId: ctx.project.id,
      code: "VC-001",
      reason: "Automation opportunity",
      statedChangeAmount: "3000000.00",
    });
    await includeDriverInValueChange(ctx.actor, { changeId: change.id, valueDriverId: driver.id });
    await proposeValueChange(ctx.actor, { changeId: change.id });
    await expectDomainError(
      includeDriverInValueChange(ctx.actor, { changeId: change.id, valueDriverId: ctx.driver.id }),
      "VO_VALUE_CHANGE_IMMUTABLE",
    );
    await expectDomainError(
      authoriseValueChange(ctx.actor, {
        changeId: change.id,
        authorisedByPersonId: ctx.other.id,
        authorisedOn: today,
        authorisationEvidenceId: ctx.evidence.id,
      }),
      "VO_NOT_VCO",
    );
    await authoriseValueChange(ctx.actor, {
      changeId: change.id,
      authorisedByPersonId: ctx.vco.id,
      authorisedOn: today,
      authorisationEvidenceId: ctx.evidence.id,
    });

    const e = await entryOf(ctx, driver.id);
    expect(e).toMatchObject({
      status: "in_value_case",
      authorised: { versionNumber: 2, financialValue: "3000000.00" },
    });
    expect(e.forecast).toBeNull(); // the latest finalised review measured V1, not V2
    expect((await getValuePositionSummary(ctx.project.id)).authorisedTotal).toBe("7800000.00");
    const detail = (await getDriverDetail(ctx.project.id, driver.id))!;
    expect(detail.history.map((h) => [h.version.versionNumber, h.version.status])).toEqual([[2, "authorised"]]);
    const inV1 = await db()
      .select()
      .from(schema.valueDriverVersion)
      .where(eq(schema.valueDriverVersion.valueCaseVersionId, ctx.v1.id));
    expect(inV1.map((d) => d.valueDriverId)).toEqual([ctx.driver.id]);
    expect(v2.basedOnVersionId).toBe(ctx.v1.id);
  });
});

describe("reports and identity safety", () => {
  it("existing reports never show an emerging driver or its working estimate", async () => {
    const ctx = await project();
    const { driver } = await emerging(ctx, { name: "Automation Opportunity" });
    await setDriverEstimate(ctx.actor, { valueDriverId: driver.id, workingEstimate: "3000000.00" });
    const requal = (await buildRequalificationReport(ctx.project.id, ctx.v1.id))!;
    const assurance = (await buildAssuranceReport(ctx.project.id, ctx.review.id))!;
    for (const built of [requal, assurance]) {
      const html = text(renderReportArticle(built.model, { state: "preview" }));
      expect(html).not.toContain("Automation Opportunity");
      expect(html).not.toContain("$3.0m");
      expect(html).not.toContain(driver.code);
    }
  });

  it("issued reports are unchanged by living edits, emerging drivers and inclusion", async () => {
    const ctx = await project();
    const issued = await issueReport(ctx.actor, {
      type: "assurance",
      projectId: ctx.project.id,
      subjectId: ctx.review.id,
    });
    const before = JSON.stringify(await getReportIssue(ctx.project.id, issued.id));
    await initialiseDriverRecord(ctx.actor, { valueDriverId: ctx.driver.id });
    await setDriverEstimate(ctx.actor, { valueDriverId: ctx.driver.id, workingEstimate: "1.00" });
    const { driver } = await emerging(ctx);
    const { change } = await createValueChange(ctx.actor, { projectId: ctx.project.id, code: "VC-009" });
    await includeDriverInValueChange(ctx.actor, { changeId: change.id, valueDriverId: driver.id });
    expect(JSON.stringify(await getReportIssue(ctx.project.id, issued.id))).toBe(before);
  });

  it("removing a draft driver keeps an identity that anything still refers to", async () => {
    const actor = await newActor();
    const { project: p } = await newProject(actor);
    const { person } = await addStakeholder(actor, { projectId: p.id, name: "P" });
    const draft = await createDraftVersion(actor, { projectId: p.id, title: "V1" });
    const add = (code: string) =>
      addValueDriver(actor, { versionId: draft.id, code, name: code, avoPersonId: person.id });

    // Unreferenced: deleted with its only version, as before.
    const plain = await add("VD-01");
    await removeValueDriver(actor, { driverVersionId: plain.driverVersion.id });
    expect(await db().select().from(schema.valueDriver).where(eq(schema.valueDriver.id, plain.driver.id))).toEqual([]);

    // Referenced by working history: the identity survives the draft removal.
    const withRecord = await add("VD-02");
    await initialiseDriverRecord(actor, { valueDriverId: withRecord.driver.id });
    const withEvidence = await add("VD-03");
    const e = await recordEvidence(actor, { projectId: p.id, code: "E-1", title: "e" });
    await linkDriverEvidence(actor, { evidenceId: e.id, valueDriverId: withEvidence.driver.id });
    const withRequest = await add("VD-04");
    const ir = await createInformationRequest(actor, { projectId: p.id, reference: "IR-01", title: "IR" });
    await addInformationRequestItem(actor, {
      informationRequestId: ir.id,
      description: "x",
      valueDriverId: withRequest.driver.id,
    });
    for (const d of [withRecord, withEvidence, withRequest]) {
      await removeValueDriver(actor, { driverVersionId: d.driverVersion.id });
      expect(await db().select().from(schema.valueDriver).where(eq(schema.valueDriver.id, d.driver.id))).toHaveLength(
        1,
      );
    }
    // And the database refuses the bypass.
    await expectDomainError(
      asCommand(actor, COMMANDS.removeValueDriver, (tx) =>
        tx.delete(schema.valueDriver).where(eq(schema.valueDriver.id, withEvidence.driver.id)),
      ),
      "VO_DRIVER_IN_USE",
    );
  });

  it("matter affected-driver links and formal snapshots also keep the identity", async () => {
    const ctx = await project();
    const { driver } = await emerging(ctx);
    await createMatter(ctx.actor, {
      projectId: ctx.project.id,
      code: `VL-${uid()}`,
      title: "x",
      driverIds: [driver.id],
    });
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.removeValueDriver, async (tx) => {
        await tx.execute(sql`delete from value_driver_record where value_driver_id = ${driver.id}`);
      }),
      "VO_FIELD_IMMUTABLE",
    );
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.removeValueDriver, async (tx) => {
        await tx.execute(sql`set local session_replication_role = replica`);
        await tx.execute(sql`delete from value_driver_record where value_driver_id = ${driver.id}`);
        await tx.execute(sql`set local session_replication_role = origin`);
        await tx.delete(schema.valueDriver).where(eq(schema.valueDriver.id, driver.id));
      }),
      "VO_DRIVER_IN_USE",
    ); // even without the living record, the matter link keeps it
  });
});
