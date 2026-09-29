import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { HORIZON, seedHorizon } from "@/fixtures/horizon";
import {
  createReview,
  finaliseReview,
  linkReviewEvidence,
  unlinkReviewEvidence,
  updateReview,
  upsertValuePositions,
} from "@/server/commands/assurance";
import { recordEvidence, updateEvidence } from "@/server/commands/evidence";
import { COMMANDS } from "@/server/commands/names";
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
import { getAssuranceWorkspace, getValuePositionSummary } from "@/server/queries/assurance";

import { asCommand, expectDomainError, newActor, newProject, sql, uid } from "../support/fixtures";

const today = new Date().toISOString().slice(0, 10);

/** Authorised V1 with two financial drivers (A $1.0m, B $0.5m) and one non-financial (C). */
async function authorisedProject(actor?: Actor) {
  actor ??= await newActor();
  const { project, valueCase } = await newProject(actor);
  const { person: vco } = await addStakeholder(actor, { projectId: project.id, name: "VCO" });
  await setValueCaseOwner(actor, { projectId: project.id, personId: vco.id });
  const v0 = await createInheritedBusinessCase(actor, {
    projectId: project.id,
    title: "BC",
    statedTotalValue: "2000000.00",
  });
  const { driver: legacy } = await addValueDriver(actor, { versionId: v0.id, code: "VD-99", name: "Dropped" });
  await recordInheritedBusinessCase(actor, { versionId: v0.id });
  const v1 = await createDraftVersion(actor, { projectId: project.id, title: "V1" });
  await asCommand(actor, COMMANDS.removeValueDriver, (tx) =>
    tx.delete(schema.valueDriverVersion).where(eq(schema.valueDriverVersion.valueCaseVersionId, v1.id)),
  );
  const a = await addValueDriver(actor, { versionId: v1.id, code: "VD-01", name: "A", financialValue: "1000000.00" });
  const b = await addValueDriver(actor, { versionId: v1.id, code: "VD-02", name: "B", financialValue: "500000.00" });
  const c = await addValueDriver(actor, { versionId: v1.id, code: "VD-03", name: "C (non-financial)" });
  await proposeVersion(actor, { versionId: v1.id });
  const auth = await recordEvidence(actor, { projectId: project.id, code: "E-AUTH", title: "Authorisation" });
  const authorised = await authoriseInitialVersion(actor, {
    versionId: v1.id,
    authorisedByPersonId: vco.id,
    authorisedOn: today,
    authorisationEvidenceId: auth.id,
  });
  return {
    actor,
    project,
    valueCase,
    v0,
    v1: authorised,
    legacy: legacy.id,
    A: a.driver.id,
    B: b.driver.id,
    C: c.driver.id,
  };
}

type Ctx = Awaited<ReturnType<typeof authorisedProject>>;

async function finalisedReview(ctx: Ctx, forecasts: { A: string | null; B: string | null }, reviewDate = today) {
  const review = await createReview(ctx.actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate });
  await upsertValuePositions(ctx.actor, {
    reviewId: review.id,
    positions: [
      { valueDriverId: ctx.A, currentForecast: forecasts.A },
      { valueDriverId: ctx.B, currentForecast: forecasts.B },
      { valueDriverId: ctx.C, forecastRationale: "On track" },
    ],
  });
  return finaliseReview(ctx.actor, { reviewId: review.id });
}

describe("opening a review", () => {
  it("opens the first review against the Authorised V1 in force, with no previous review", async () => {
    const ctx = await authorisedProject();
    const review = await createReview(ctx.actor, { projectId: ctx.project.id, trigger: "kickoff", reviewDate: today });
    expect(review).toMatchObject({ sequence: 1, status: "draft", againstVersionId: ctx.v1.id, previousReviewId: null });
  });

  it("chains a later review to the latest finalised review", async () => {
    const ctx = await authorisedProject();
    const first = await finalisedReview(ctx, { A: "900000.00", B: "500000.00" });
    const second = await createReview(ctx.actor, {
      projectId: ctx.project.id,
      trigger: "six_month",
      reviewDate: today,
    });
    expect(second).toMatchObject({ sequence: 2, previousReviewId: first.id, againstVersionId: ctx.v1.id });
  });

  it("requires an Authorised Value Case", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    await expectDomainError(
      createReview(actor, { projectId: project.id, trigger: "ad_hoc", reviewDate: today }),
      "VO_NO_AUTHORISED_VERSION",
    );
  });

  it("cannot reference a non-authorised version, even beneath the command layer", async () => {
    const ctx = await authorisedProject();
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.createAssuranceReview, (tx) =>
        tx.insert(schema.assuranceReview).values({
          projectId: ctx.project.id,
          valueCaseId: ctx.valueCase.id,
          sequence: 1,
          trigger: "ad_hoc",
          againstVersionId: ctx.v0.id, // recorded V0, not authorised
          reviewDate: today,
          createdBy: ctx.actor.userId,
        }),
      ),
      "VO_VERSION_NOT_AUTHORISED",
    );
  });

  it("allows only one draft review at a time", async () => {
    const ctx = await authorisedProject();
    await createReview(ctx.actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate: today });
    await expectDomainError(
      createReview(ctx.actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate: today }),
      "VO_DRAFT_REVIEW_OPEN",
    );
  });

  it("rejects a review dated before the previous review", async () => {
    const ctx = await authorisedProject();
    await finalisedReview(ctx, { A: "900000.00", B: "500000.00" }, "2026-06-30");
    await expectDomainError(
      createReview(ctx.actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate: "2026-06-01" }),
      "VO_REVIEW_ORDER",
    );
  });

  it("requires trigger evidence from the same project", async () => {
    const ctx = await authorisedProject();
    const other = await newProject(ctx.actor);
    const foreign = await recordEvidence(ctx.actor, { projectId: other.project.id, code: "E-1", title: "Elsewhere" });
    await expectDomainError(
      createReview(ctx.actor, {
        projectId: ctx.project.id,
        trigger: "material_evidence_change",
        reviewDate: today,
        triggerEvidenceId: foreign.id,
      }),
      "VO_REFERENCE_VIOLATION",
    );
    const own = await recordEvidence(ctx.actor, {
      projectId: ctx.project.id,
      code: "E-2",
      title: "Here",
      isMaterialChange: true,
    });
    const review = await createReview(ctx.actor, {
      projectId: ctx.project.id,
      trigger: "material_evidence_change",
      reviewDate: today,
      triggerEvidenceId: own.id,
    });
    expect(review.triggerEvidenceId).toBe(own.id);
  });
});

describe("previous review integrity (beneath the command layer)", () => {
  async function rawReview(ctx: Ctx, values: Partial<typeof schema.assuranceReview.$inferInsert>) {
    return asCommand(ctx.actor, COMMANDS.createAssuranceReview, (tx) =>
      tx.insert(schema.assuranceReview).values({
        projectId: ctx.project.id,
        valueCaseId: ctx.valueCase.id,
        sequence: 9,
        trigger: "ad_hoc",
        againstVersionId: ctx.v1.id,
        reviewDate: today,
        createdBy: ctx.actor.userId,
        ...values,
      }),
    );
  }

  it("must be finalised", async () => {
    const ctx = await authorisedProject();
    const draft = await createReview(ctx.actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate: today });
    await expectDomainError(rawReview(ctx, { previousReviewId: draft.id }), "VO_PREVIOUS_NOT_FINALISED");
  });

  it("must belong to the same project", async () => {
    const ctx = await authorisedProject();
    const other = await authorisedProject(ctx.actor);
    const foreign = await finalisedReview(other, { A: "1.00", B: "1.00" });
    await expectDomainError(rawReview(ctx, { previousReviewId: foreign.id }), "VO_PREVIOUS_OTHER_PROJECT");
  });

  it("must be the latest finalised review, and cannot be skipped", async () => {
    const ctx = await authorisedProject();
    const first = await finalisedReview(ctx, { A: "900000.00", B: "500000.00" });
    await finalisedReview(ctx, { A: "950000.00", B: "500000.00" });
    await expectDomainError(rawReview(ctx, { previousReviewId: first.id }), "VO_PREVIOUS_NOT_LATEST");
    await expectDomainError(rawReview(ctx, { previousReviewId: null }), "VO_PREVIOUS_REVIEW_REQUIRED");
  });

  it("must precede the new review", async () => {
    const ctx = await authorisedProject();
    const first = await finalisedReview(ctx, { A: "900000.00", B: "500000.00" }, "2026-06-30");
    await expectDomainError(
      rawReview(ctx, { previousReviewId: first.id, reviewDate: "2026-01-01" }),
      "VO_REVIEW_ORDER",
    );
  });

  it("cannot be finalised by any other command", async () => {
    const ctx = await authorisedProject();
    const review = await createReview(ctx.actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate: today });
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.updateAssuranceReview, (tx) =>
        tx
          .update(schema.assuranceReview)
          .set({ status: "finalised", finalisedBy: ctx.actor.userId, finalisedAt: new Date() })
          .where(eq(schema.assuranceReview.id, review.id)),
      ),
      "VO_WRONG_COMMAND",
    );
  });
});

describe("Value Positions", () => {
  it("cannot reference a driver from another project", async () => {
    const ctx = await authorisedProject();
    const other = await authorisedProject(ctx.actor);
    const review = await createReview(ctx.actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate: today });
    await expectDomainError(
      upsertValuePositions(ctx.actor, {
        reviewId: review.id,
        positions: [{ valueDriverId: other.A, currentForecast: "1.00" }],
      }),
      "VO_DRIVER_NOT_IN_VERSION",
    );
  });

  it("cannot reference a driver that is not in the authorised version", async () => {
    const ctx = await authorisedProject();
    const review = await createReview(ctx.actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate: today });
    await expectDomainError(
      upsertValuePositions(ctx.actor, {
        reviewId: review.id,
        positions: [{ valueDriverId: ctx.legacy, currentForecast: "1.00" }],
      }),
      "VO_DRIVER_NOT_IN_VERSION",
    );
  });

  it("allows at most one position per driver per review", async () => {
    const ctx = await authorisedProject();
    const review = await createReview(ctx.actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate: today });
    await expectDomainError(
      upsertValuePositions(ctx.actor, {
        reviewId: review.id,
        positions: [
          { valueDriverId: ctx.A, currentForecast: "1.00" },
          { valueDriverId: ctx.A, currentForecast: "2.00" },
        ],
      }),
      "VO_DUPLICATE_POSITION",
    );
    await upsertValuePositions(ctx.actor, {
      reviewId: review.id,
      positions: [{ valueDriverId: ctx.A, currentForecast: "1.00" }],
    });
    await upsertValuePositions(ctx.actor, {
      reviewId: review.id,
      positions: [{ valueDriverId: ctx.A, currentForecast: "2.00" }],
    });
    const rows = await db()
      .select()
      .from(schema.valuePosition)
      .where(eq(schema.valuePosition.assuranceReviewId, review.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.currentForecast).toBe("2.00");
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.upsertValuePositions, (tx) =>
        tx.insert(schema.valuePosition).values({
          assuranceReviewId: review.id,
          projectId: ctx.project.id,
          valueCaseId: ctx.valueCase.id,
          valueDriverId: ctx.A,
        }),
      ),
      "VO_UNIQUE_VIOLATION",
    );
  });

  it("stores negative and zero forecasts exactly", async () => {
    const ctx = await authorisedProject();
    const review = await createReview(ctx.actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate: today });
    await upsertValuePositions(ctx.actor, {
      reviewId: review.id,
      positions: [
        { valueDriverId: ctx.A, currentForecast: "-450000.35" },
        { valueDriverId: ctx.B, currentForecast: "0.00" },
      ],
    });
    const ws = await getAssuranceWorkspace(ctx.project.id, review.id);
    expect(ws!.totals.forecastTotal).toBe("-450000.35");
    expect(ws!.totals.valueGap).toBe("1950000.35");
  });
});

describe("movement, gap and totals", () => {
  it("first review: movement vs Authorised Value; totals exclude the non-financial driver", async () => {
    const ctx = await authorisedProject();
    const r1 = await finalisedReview(ctx, { A: "900000.00", B: "550000.00" });
    const ws = await getAssuranceWorkspace(ctx.project.id, r1.id);
    expect(ws!.totals).toMatchObject({
      financialDriverCount: 2,
      authorisedTotal: "1500000.00",
      forecastTotal: "1450000.00",
      valueGap: "50000.00",
      movement: "-50000.00",
      previousTotal: "1500000.00",
    });
    const a = ws!.rows.find((r) => r.valueDriverId === ctx.A)!;
    expect(a).toMatchObject({ previousForecast: "1000000.00", movement: "-100000.00", valueGap: "100000.00" });
    expect(ws!.rows.find((r) => r.valueDriverId === ctx.C)).toMatchObject({ financial: false, valueGap: null });
  });

  it("later review: movement vs the previous finalised forecast, never back to V1", async () => {
    const ctx = await authorisedProject();
    await finalisedReview(ctx, { A: "900000.00", B: "550000.00" });
    const r2 = await finalisedReview(ctx, { A: "950000.00", B: "500000.00" });
    const ws = await getAssuranceWorkspace(ctx.project.id, r2.id);
    expect(ws!.previous!.sequence).toBe(1);
    expect(ws!.totals.movement).toBe("0.00"); // 1.45m -> 1.45m
    expect(ws!.rows.find((r) => r.valueDriverId === ctx.A)).toMatchObject({
      previousForecast: "900000.00",
      movement: "50000.00",
    });
    expect(ws!.rows.find((r) => r.valueDriverId === ctx.B)).toMatchObject({
      previousForecast: "550000.00",
      movement: "-50000.00",
    });
    expect(ws!.totals.valueGap).toBe("50000.00");
  });

  it("never alters the Authorised Value Case", async () => {
    const ctx = await authorisedProject();
    await finalisedReview(ctx, { A: "1.00", B: "2.00" });
    const rows = await db()
      .select({ v: schema.valueDriverVersion.financialValue })
      .from(schema.valueDriverVersion)
      .where(eq(schema.valueDriverVersion.valueCaseVersionId, ctx.v1.id));
    expect(rows.map((r) => r.v).sort()).toEqual(["1000000.00", "500000.00", null].sort());
    const [v1] = await db().select().from(schema.valueCaseVersion).where(eq(schema.valueCaseVersion.id, ctx.v1.id));
    expect(v1!.status).toBe("authorised");
  });
});

describe("finalisation", () => {
  it("requires a position for every driver in the authorised version, including non-financial", async () => {
    const ctx = await authorisedProject();
    const review = await createReview(ctx.actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate: today });
    await upsertValuePositions(ctx.actor, {
      reviewId: review.id,
      positions: [
        { valueDriverId: ctx.A, currentForecast: "1.00" },
        { valueDriverId: ctx.B, currentForecast: "1.00" },
      ],
    });
    const err = await expectDomainError(finaliseReview(ctx.actor, { reviewId: review.id }), "VO_POSITIONS_INCOMPLETE");
    expect(err.message).toMatch(/1 Value Driver/);
    await upsertValuePositions(ctx.actor, { reviewId: review.id, positions: [{ valueDriverId: ctx.C }] });
    const finalised = await finaliseReview(ctx.actor, { reviewId: review.id });
    expect(finalised).toMatchObject({ status: "finalised", finalisedBy: ctx.actor.userId });
  });

  it("makes the review, its positions and its evidence links immutable", async () => {
    const ctx = await authorisedProject();
    const e = await recordEvidence(ctx.actor, { projectId: ctx.project.id, code: "E-9", title: "Q3 benefits report" });
    const review = await createReview(ctx.actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate: today });
    const link = await linkReviewEvidence(ctx.actor, { reviewId: review.id, evidenceId: e.id });
    await upsertValuePositions(ctx.actor, {
      reviewId: review.id,
      positions: [
        { valueDriverId: ctx.A, currentForecast: "1.00" },
        { valueDriverId: ctx.B, currentForecast: "1.00" },
        { valueDriverId: ctx.C },
      ],
    });
    await finaliseReview(ctx.actor, { reviewId: review.id });

    await expectDomainError(
      updateReview(ctx.actor, { reviewId: review.id, whatChanged: "Rewritten" }),
      "VO_REVIEW_IMMUTABLE",
    );
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.updateAssuranceReview, (tx) =>
        tx.update(schema.assuranceReview).set({ summary: "x" }).where(eq(schema.assuranceReview.id, review.id)),
      ),
      "VO_REVIEW_IMMUTABLE",
    );
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.updateAssuranceReview, (tx) =>
        tx.delete(schema.assuranceReview).where(eq(schema.assuranceReview.id, review.id)),
      ),
      "VO_REVIEW_IMMUTABLE",
    );
    await expectDomainError(
      upsertValuePositions(ctx.actor, {
        reviewId: review.id,
        positions: [{ valueDriverId: ctx.A, currentForecast: "2.00" }],
      }),
      "VO_REVIEW_IMMUTABLE",
    );
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.upsertValuePositions, (tx) =>
        tx
          .update(schema.valuePosition)
          .set({ currentForecast: "2.00" })
          .where(
            and(eq(schema.valuePosition.assuranceReviewId, review.id), eq(schema.valuePosition.valueDriverId, ctx.A)),
          ),
      ),
      "VO_REVIEW_IMMUTABLE",
    );
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.upsertValuePositions, (tx) =>
        tx.delete(schema.valuePosition).where(eq(schema.valuePosition.assuranceReviewId, review.id)),
      ),
      "VO_REVIEW_IMMUTABLE",
    );
    await expectDomainError(unlinkReviewEvidence(ctx.actor, { evidenceLinkId: link.id }), "VO_REVIEW_IMMUTABLE");
    const other = await recordEvidence(ctx.actor, { projectId: ctx.project.id, code: "E-10", title: "Late" });
    await expectDomainError(
      linkReviewEvidence(ctx.actor, { reviewId: review.id, evidenceId: other.id }),
      "VO_REVIEW_IMMUTABLE",
    );
    // Evidence relied on by a finalised review is frozen; unrelated evidence is not.
    await expectDomainError(updateEvidence(ctx.actor, { evidenceId: e.id, title: "Changed" }), "VO_EVIDENCE_LOCKED");
    expect((await updateEvidence(ctx.actor, { evidenceId: other.id, title: "Still editable" })).title).toBe(
      "Still editable",
    );
  });

  it("records audit events with actor and command for the review lifecycle", async () => {
    const ctx = await authorisedProject();
    const r = await finalisedReview(ctx, { A: "1.00", B: "1.00" });
    const events = await db()
      .select()
      .from(schema.auditEvent)
      .where(
        sql`${schema.auditEvent.tableName} in ('assurance_review', 'value_position') and coalesce(${schema.auditEvent.newRow}, ${schema.auditEvent.oldRow})->>'project_id' = ${ctx.project.id}`,
      );
    const commands = new Set(events.map((e) => e.command));
    expect(commands).toEqual(
      new Set(["assurance.createReview", "assurance.upsertValuePositions", "assurance.finaliseReview"]),
    );
    expect(events.every((e) => e.actorUserId === ctx.actor.userId)).toBe(true);
    const finalisation = events.find((e) => e.command === "assurance.finaliseReview")!;
    expect(finalisation.rowId).toBe(r.id);
    expect((finalisation.oldRow as { status: string }).status).toBe("draft");
    expect((finalisation.newRow as { status: string }).status).toBe("finalised");
  });
});

describe("Project Horizon Assurance acceptance", () => {
  it("shows $15.5m authorised, $14.7m forecast, $0.8m gap; $2.8m realised is unattributed, never per driver", async () => {
    const actor = await newActor();
    const { project, review } = await seedHorizon(actor, { projectCode: `HORIZON-${uid()}` });
    const summary = await getValuePositionSummary(project.id);
    expect(summary.authorisedTotal).toBe(HORIZON.authorisedV1Value);
    expect(summary.latest!.review.id).toBe(review.id);
    expect(summary.latest!.totals).toMatchObject({
      authorisedTotal: "15500000.00",
      forecastTotal: HORIZON.assurance.currentForecastTotal,
      valueGap: HORIZON.assurance.valueGap,
      movement: "-800000.00",
      realisedAttributedTotal: null,
      unattributedRealised: HORIZON.assurance.realisedAggregate,
      realisedTotal: "2800000.00",
      realisedAssessed: 0,
    });

    const positions = await db()
      .select()
      .from(schema.valuePosition)
      .where(eq(schema.valuePosition.assuranceReviewId, review.id));
    expect(positions).toHaveLength(6);
    expect(positions.every((p) => p.realisedValue === null)).toBe(true);

    const ws = await getAssuranceWorkspace(project.id, review.id);
    expect(ws!.rows.map((r) => [r.code, r.authorisedValue, r.currentForecast])).toEqual(
      HORIZON.drivers.map((d, i) => [d.code, d.financialValue, HORIZON.assurance.forecasts[i]!.currentForecast]),
    );
    expect(review.unattributedRealisedValue).toBe("2800000.00");
    expect(review.unattributedRealisedRationale).toMatch(/\[FIXTURE PLACEHOLDER\]/);
  });
});
