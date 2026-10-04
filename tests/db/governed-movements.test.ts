import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createReview, finaliseReview, upsertValuePositions } from "@/server/commands/assurance";
import { recordEvidence } from "@/server/commands/evidence";
import { addInformationRequestItem, createInformationRequest } from "@/server/commands/information-request";
import { createMatter } from "@/server/commands/matters";
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
  returnVersionToDraft,
  setNotCarriedForward,
  updateDriverVersion,
} from "@/server/commands/value-case";
import {
  authoriseValueChange,
  createValueChange,
  proposeValueChange,
  updateValueChange,
} from "@/server/commands/value-change";
import { db, schema } from "@/server/db/client";
import { getAssuranceWorkspace } from "@/server/queries/assurance";

import { asCommand, expectDomainError, newActor, newProject } from "../support/fixtures";

// Phase 4D.10E: any non-zero governed value movement needs an explicit rationale at its formal gate — V1 proposal
// (Value Case Definition) and review finalisation (Assurance). Drafts stay free; evidence stays optional.

type Actor = Awaited<ReturnType<typeof newActor>>;

async function setup(actor: Actor) {
  const { project } = await newProject(actor);
  const { person: vco } = await addStakeholder(actor, { projectId: project.id, name: "Val Owner" });
  await setValueCaseOwner(actor, { projectId: project.id, personId: vco.id });
  return { project, vco };
}
const driverRows = async (versionId: string) =>
  Object.fromEntries(
    (
      await db()
        .select({ id: schema.valueDriverVersion.id, code: schema.valueDriver.code, dv: schema.valueDriverVersion })
        .from(schema.valueDriverVersion)
        .innerJoin(schema.valueDriver, eq(schema.valueDriver.id, schema.valueDriverVersion.valueDriverId))
        .where(eq(schema.valueDriverVersion.valueCaseVersionId, versionId))
    ).map((r) => [r.code, r.dv]),
  );
async function authorise(actor: Actor, projectId: string, vcoId: string, versionId: string, code = "E-001") {
  const ev = await recordEvidence(actor, { projectId, code, title: "Authorisation" });
  await authoriseInitialVersion(actor, {
    versionId,
    authorisedByPersonId: vcoId,
    authorisedOn: "2026-10-01",
    authorisationEvidenceId: ev.id,
  });
}

describe("Value Case Definition: governed movement at V1 proposal", () => {
  it("needs a reason for adjusted, introduced and not-carried-forward drivers — and none when unchanged", async () => {
    const actor = await newActor();
    const { project, vco } = await setup(actor);
    const v0 = await createInheritedBusinessCase(actor, {
      projectId: project.id,
      title: "OBC",
      statedTotalValue: "9500000.00",
    });
    for (const [code, value] of [
      ["VD-01", "5000000.00"],
      ["VD-02", "3000000.00"],
      ["VD-03", "1000000.00"],
    ] as const)
      await addValueDriver(actor, { versionId: v0.id, code, name: code, financialValue: value });
    await addValueDriver(actor, { versionId: v0.id, code: "VD-04", name: "Outcome" }); // non-financial
    await recordInheritedBusinessCase(actor, { versionId: v0.id });
    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "Value Case", basedOnVersionId: v0.id });
    const rows = await driverRows(v1.id);
    expect(Object.values(rows).every((r) => r.adjustmentRationale === null)).toBe(true); // never copied forward

    // Adjusted without a reason: refused at proposal; draft editing stays free throughout.
    await updateDriverVersion(actor, { driverVersionId: rows["VD-02"]!.id, financialValue: "2500000.00" });
    await updateDriverVersion(actor, { driverVersionId: rows["VD-02"]!.id, notes: "still a draft" });
    await expectDomainError(proposeVersion(actor, { versionId: v1.id }), "VO_ADJUSTMENT_RATIONALE_REQUIRED");
    await updateDriverVersion(actor, {
      driverVersionId: rows["VD-02"]!.id,
      adjustmentRationale: "Synthetic: volumes re-baselined",
    });

    // Introduced driver: reason required for a non-zero financial value; a $0 or non-financial one needs none.
    await addValueDriver(actor, { versionId: v1.id, code: "VD-05", name: "New", financialValue: "750000.00" });
    await addValueDriver(actor, { versionId: v1.id, code: "VD-06", name: "Zero", financialValue: "0.00" });
    await addValueDriver(actor, { versionId: v1.id, code: "VD-07", name: "Experience" });
    const e = await expectDomainError(proposeVersion(actor, { versionId: v1.id }), "VO_ADJUSTMENT_RATIONALE_REQUIRED");
    expect(e.message).toMatch(/for VD-05$/);
    const v5 = (await driverRows(v1.id))["VD-05"]!;
    await updateDriverVersion(actor, {
      driverVersionId: v5.id,
      adjustmentRationale: "Synthetic: new automation benefit",
    });

    // A financial Original Business Case driver not carried forward needs its own reason.
    await removeValueDriver(actor, { driverVersionId: rows["VD-03"]!.id });
    const x = await expectDomainError(proposeVersion(actor, { versionId: v1.id }), "VO_EXCLUSION_RATIONALE_REQUIRED");
    expect(x.message).toMatch(/for VD-03$/);
    const vd03 = await db()
      .select()
      .from(schema.valueDriver)
      .where(and(eq(schema.valueDriver.projectId, project.id), eq(schema.valueDriver.code, "VD-03")));
    await setNotCarriedForward(actor, {
      versionId: v1.id,
      valueDriverId: vd03[0]!.id,
      adjustmentRationale: "Synthetic: benefit transferred to another programme",
    });
    // Dropping the non-financial VD-04 moves no value: no reason needed.
    await removeValueDriver(actor, { driverVersionId: rows["VD-04"]!.id });

    await proposeVersion(actor, { versionId: v1.id }); // VD-01 unchanged needs nothing
    await authorise(actor, project.id, vco.id, v1.id);

    // The audit trail carries the rationale with actor, command and before/after.
    const audit = await db()
      .select({
        command: schema.auditEvent.command,
        newRow: schema.auditEvent.newRow,
        actor: schema.auditEvent.actorUserId,
      })
      .from(schema.auditEvent)
      .where(
        and(eq(schema.auditEvent.tableName, "value_driver_version"), eq(schema.auditEvent.rowId, rows["VD-02"]!.id)),
      );
    const set = audit.find((a) => (a.newRow as { adjustment_rationale?: string })?.adjustment_rationale);
    expect(set).toMatchObject({ command: "valueCase.updateDriverVersion", actor: actor.userId });
    const exAudit = await db()
      .select({ command: schema.auditEvent.command })
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.tableName, "value_driver_exclusion"));
    expect(exAudit.map((a) => a.command)).toContain("valueCase.setNotCarriedForward");

    // Locked afterwards: neither the rationale nor the not-carried-forward record can change.
    await expectDomainError(
      updateDriverVersion(actor, { driverVersionId: rows["VD-02"]!.id, adjustmentRationale: "rewrite" }),
      "VO_VERSION_IMMUTABLE",
    );
    await expectDomainError(
      setNotCarriedForward(actor, { versionId: v1.id, valueDriverId: vd03[0]!.id, adjustmentRationale: "rewrite" }),
      "VO_VERSION_IMMUTABLE",
    );
  });

  it("without a recorded Original Business Case every financial driver needs a reason for being introduced", async () => {
    const actor = await newActor();
    // No Original Business Case at all.
    const { project } = await setup(actor);
    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "Value Case" });
    const { driverVersion } = await addValueDriver(actor, {
      versionId: v1.id,
      code: "VD-01",
      name: "A",
      financialValue: "1.00",
    });
    await addValueDriver(actor, { versionId: v1.id, code: "VD-02", name: "Outcome" });
    await expectDomainError(proposeVersion(actor, { versionId: v1.id }), "VO_ADJUSTMENT_RATIONALE_REQUIRED");
    await updateDriverVersion(actor, {
      driverVersionId: driverVersion.id,
      adjustmentRationale: "Synthetic: why introduced",
    });
    await proposeVersion(actor, { versionId: v1.id });

    // Headline-only recorded Original Business Case: no driver counterparts, so the same rule applies.
    const { project: p2 } = await setup(actor);
    const v0 = await createInheritedBusinessCase(actor, { projectId: p2.id, title: "OBC", statedTotalValue: "2.00" });
    await recordInheritedBusinessCase(actor, { versionId: v0.id });
    const v1b = await createDraftVersion(actor, { projectId: p2.id, title: "Value Case", basedOnVersionId: v0.id });
    await addValueDriver(actor, { versionId: v1b.id, code: "VD-01", name: "A", financialValue: "2.00" });
    await expectDomainError(proposeVersion(actor, { versionId: v1b.id }), "VO_ADJUSTMENT_RATIONALE_REQUIRED");

    // A draft Original Business Case is not a governed baseline: equal values still need a reason.
    const { project: p3 } = await setup(actor);
    const v1c = await createDraftVersion(actor, { projectId: p3.id, title: "Value Case" });
    const { driver } = await addValueDriver(actor, {
      versionId: v1c.id,
      code: "VD-01",
      name: "A",
      financialValue: "3.00",
    });
    const v0c = await createInheritedBusinessCase(actor, { projectId: p3.id, title: "OBC" });
    await addExistingDriverToOriginal(actor, { versionId: v0c.id, valueDriverId: driver.id, financialValue: "3.00" });
    await expectDomainError(proposeVersion(actor, { versionId: v1c.id }), "VO_ADJUSTMENT_RATIONALE_REQUIRED");
    await recordInheritedBusinessCase(actor, { versionId: v0c.id });
    await proposeVersion(actor, { versionId: v1c.id }); // recorded and equal: unchanged
    await returnVersionToDraft(actor, { versionId: v1c.id });
  });

  it("guards the not-carried-forward record", async () => {
    const actor = await newActor();
    const { project } = await setup(actor);
    const v0 = await createInheritedBusinessCase(actor, { projectId: project.id, title: "OBC" });
    const { driver: kept } = await addValueDriver(actor, {
      versionId: v0.id,
      code: "VD-01",
      name: "A",
      financialValue: "1.00",
    });
    await recordInheritedBusinessCase(actor, { versionId: v0.id });
    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "Value Case", basedOnVersionId: v0.id });
    const { driver: fresh } = await addValueDriver(actor, {
      versionId: v1.id,
      code: "VD-02",
      name: "B",
      financialValue: "2.00",
      adjustmentRationale: "Synthetic",
    });
    await expectDomainError(
      setNotCarriedForward(actor, { versionId: v1.id, valueDriverId: kept.id, adjustmentRationale: "x" }),
      "VO_DRIVER_ALREADY_INCLUDED",
    );
    // A driver in neither V1 nor the Original Business Case (kept alive by a request item) cannot be "not carried".
    const ir = await createInformationRequest(actor, { projectId: project.id, reference: "IR-01", title: "Day-1" });
    await addInformationRequestItem(actor, {
      informationRequestId: ir.id,
      description: "Data",
      valueDriverId: fresh.id,
    });
    const freshRow = (await driverRows(v1.id))["VD-02"]!;
    await removeValueDriver(actor, { driverVersionId: freshRow.id });
    await expectDomainError(
      setNotCarriedForward(actor, { versionId: v1.id, valueDriverId: fresh.id, adjustmentRationale: "x" }),
      "VO_NOT_IN_ORIGINAL",
    );
    await expectDomainError(
      asCommand(actor, "valueCase.updateDriverVersion", (tx) =>
        tx.insert(schema.valueDriverExclusion).values({
          valueCaseVersionId: v1.id,
          valueDriverId: kept.id,
          valueCaseId: v1.valueCaseId,
          projectId: project.id,
          adjustmentRationale: "x",
        }),
      ),
      "VO_WRONG_COMMAND",
    );
  });
});

describe("Assurance: governed forecast movement at finalisation", () => {
  async function authorisedCase(actor: Actor) {
    const { project, vco } = await setup(actor);
    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "Value Case" });
    const why = { adjustmentRationale: "Synthetic: introduced" };
    const { driver: a } = await addValueDriver(actor, {
      versionId: v1.id,
      code: "VD-01",
      name: "A",
      financialValue: "1000000.00",
      ...why,
    });
    const { driver: b } = await addValueDriver(actor, {
      versionId: v1.id,
      code: "VD-02",
      name: "B",
      financialValue: "500000.00",
      ...why,
    });
    const { driver: c } = await addValueDriver(actor, { versionId: v1.id, code: "VD-03", name: "Outcome" });
    await proposeVersion(actor, { versionId: v1.id });
    await authorise(actor, project.id, vco.id, v1.id);
    return { project, vco, v1, a, b, c };
  }
  const review = (actor: Actor, projectId: string, reviewDate: string) =>
    createReview(actor, { projectId, trigger: "ad_hoc", reviewDate });

  it("compares the first review with the authorised value and later reviews with the previous formal forecast", async () => {
    const actor = await newActor();
    const { project, a, b, c } = await authorisedCase(actor);

    // Review #1: VD-01 equals authorised (no reason); VD-02 differs (reason required); non-financial VD-03 is outside.
    const r1 = await review(actor, project.id, "2026-03-31");
    await upsertValuePositions(actor, {
      reviewId: r1.id,
      positions: [
        { valueDriverId: a.id, currentForecast: "1000000.00" },
        { valueDriverId: b.id, currentForecast: "400000.00" },
        { valueDriverId: c.id, forecastRationale: "On track" },
      ],
    });
    const ws1 = (await getAssuranceWorkspace(project.id, r1.id))!;
    expect(ws1.rows.map((r) => [r.code, r.governed.source, r.governed.baseline, r.governed.rationaleRequired])).toEqual(
      [
        ["VD-01", "authorised", "1000000.00", false],
        ["VD-02", "authorised", "500000.00", true],
        ["VD-03", "authorised", null, false],
      ],
    );
    const e = await expectDomainError(finaliseReview(actor, { reviewId: r1.id }), "VO_FORECAST_RATIONALE_REQUIRED");
    expect(e.message).toMatch(/for VD-02$/);
    await upsertValuePositions(actor, {
      reviewId: r1.id,
      positions: [{ valueDriverId: b.id, forecastRationale: "Synthetic: vendor delay" }],
    });
    await finaliseReview(actor, { reviewId: r1.id }); // no evidence required

    // Review #2: unchanged VD-02 needs no new reason; increased VD-01 needs one, with an optional related matter.
    const matter = await createMatter(actor, {
      projectId: project.id,
      code: "VL-001",
      title: "Vendor sequencing",
      identifiedOn: "2026-05-01",
      driverIds: [a.id],
    });
    const r2 = await review(actor, project.id, "2026-06-30");
    await upsertValuePositions(actor, {
      reviewId: r2.id,
      positions: [
        { valueDriverId: a.id, currentForecast: "1100000.00", valueLeakageId: matter.id },
        { valueDriverId: b.id, currentForecast: "400000.00" },
        { valueDriverId: c.id },
      ],
    });
    const ws2 = (await getAssuranceWorkspace(project.id, r2.id))!;
    expect(ws2.rows.find((r) => r.code === "VD-02")!.governed).toMatchObject({
      source: "previous_review",
      moved: false,
    });
    await expectDomainError(finaliseReview(actor, { reviewId: r2.id }), "VO_FORECAST_RATIONALE_REQUIRED");
    await upsertValuePositions(actor, {
      reviewId: r2.id,
      positions: [{ valueDriverId: a.id, forecastRationale: "Synthetic: remediation recovered value" }],
    });
    await finaliseReview(actor, { reviewId: r2.id });
    const [p2] = await db()
      .select()
      .from(schema.valuePosition)
      .where(and(eq(schema.valuePosition.assuranceReviewId, r2.id), eq(schema.valuePosition.valueDriverId, a.id)));
    expect(p2!.valueLeakageId).toBe(matter.id);

    // Review #3: VD-01 Not Assessed keeps its own rule; a decrease to zero is a movement.
    const r3 = await review(actor, project.id, "2026-09-30");
    await upsertValuePositions(actor, {
      reviewId: r3.id,
      positions: [
        { valueDriverId: a.id, forecastNotAssessed: true, forecastRationale: "Synthetic: data unavailable" },
        { valueDriverId: b.id, currentForecast: "0.00" },
        { valueDriverId: c.id },
      ],
    });
    await expectDomainError(finaliseReview(actor, { reviewId: r3.id }), "VO_FORECAST_RATIONALE_REQUIRED");
    await upsertValuePositions(actor, {
      reviewId: r3.id,
      positions: [{ valueDriverId: b.id, forecastRationale: "Synthetic: benefit lost" }],
    });
    await finaliseReview(actor, { reviewId: r3.id });

    // Review #4: no prior formal forecast for VD-01 (Not Assessed in #3) — measured against its authorised value.
    const r4 = await review(actor, project.id, "2026-12-31");
    await upsertValuePositions(actor, {
      reviewId: r4.id,
      positions: [
        { valueDriverId: a.id, currentForecast: "1000000.00" },
        { valueDriverId: b.id, currentForecast: "0.00" },
        { valueDriverId: c.id },
      ],
    });
    const ws4 = (await getAssuranceWorkspace(project.id, r4.id))!;
    expect(ws4.rows.find((r) => r.code === "VD-01")!.governed).toMatchObject({
      source: "authorised",
      baseline: "1000000.00",
      rationaleRequired: false,
    });
    await finaliseReview(actor, { reviewId: r4.id }); // both unchanged against their baselines
  });

  it("a driver introduced by a Value Change is first measured against its authorised value; V2+ is explained by the Value Change reason", async () => {
    const actor = await newActor();
    const { project, vco, v1, a, b, c } = await authorisedCase(actor);
    const r1 = await review(actor, project.id, "2026-03-31");
    await upsertValuePositions(actor, {
      reviewId: r1.id,
      positions: [
        { valueDriverId: a.id, currentForecast: "1000000.00" },
        { valueDriverId: b.id, currentForecast: "500000.00" },
        { valueDriverId: c.id },
      ],
    });
    await finaliseReview(actor, { reviewId: r1.id });

    // V2: VD-01 moves and VD-04 is introduced — no driver-level reason is required; the change's reason is.
    const { change, version: v2 } = await createValueChange(actor, { projectId: project.id, code: "VC-001" });
    const v2rows = await driverRows(v2.id);
    expect(Object.values(v2rows).every((r) => r.adjustmentRationale === null)).toBe(true); // V1's reasons not copied
    await updateDriverVersion(actor, { driverVersionId: v2rows["VD-01"]!.id, financialValue: "900000.00" });
    const { driver: d } = await addValueDriver(actor, {
      versionId: v2.id,
      code: "VD-04",
      name: "D",
      financialValue: "200000.00",
    });
    // The existing rule stands: the Value Change's own reason is required before proposal.
    await expectDomainError(proposeValueChange(actor, { changeId: change.id }), "VO_INVALID_INPUT");
    await updateValueChange(actor, { changeId: change.id, reason: "Synthetic: re-scope after review" });
    await proposeValueChange(actor, { changeId: change.id });
    const ev = await recordEvidence(actor, { projectId: project.id, code: "E-002", title: "VC approval" });
    await authoriseValueChange(actor, {
      changeId: change.id,
      authorisedByPersonId: vco.id,
      authorisedOn: "2026-04-15",
      authorisationEvidenceId: ev.id,
    });
    // V1 stays immutable, its reasons intact.
    const v1rows = await driverRows(v1.id);
    expect(v1rows["VD-01"]!.adjustmentRationale).toBe("Synthetic: introduced");
    await expectDomainError(
      updateDriverVersion(actor, { driverVersionId: v1rows["VD-01"]!.id, adjustmentRationale: "rewrite" }),
      "VO_VERSION_IMMUTABLE",
    );

    // Review #2 against V2: VD-04 has no prior formal forecast → its authorised value is the baseline.
    const r2 = await review(actor, project.id, "2026-06-30");
    await upsertValuePositions(actor, {
      reviewId: r2.id,
      positions: [
        { valueDriverId: a.id, currentForecast: "1000000.00" }, // unchanged vs Review #1
        { valueDriverId: b.id, currentForecast: "500000.00" },
        { valueDriverId: c.id },
        { valueDriverId: d.id, currentForecast: "180000.00" },
      ],
    });
    const ws = (await getAssuranceWorkspace(project.id, r2.id))!;
    expect(ws.rows.find((r) => r.code === "VD-04")!.governed).toMatchObject({
      source: "authorised",
      baseline: "200000.00",
      rationaleRequired: true,
    });
    const e = await expectDomainError(finaliseReview(actor, { reviewId: r2.id }), "VO_FORECAST_RATIONALE_REQUIRED");
    expect(e.message).toMatch(/for VD-04$/);
  });
});
