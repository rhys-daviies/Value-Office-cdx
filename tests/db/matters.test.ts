import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { AssuranceReport } from "@/domain/reports";
import { createReview, finaliseReview, upsertValuePositions } from "@/server/commands/assurance";
import { addStakeholder } from "@/server/commands/stakeholders";
import { assessLeakage, createLeakage, setLeakageDrivers, updateLeakage } from "@/server/commands/leakage";
import {
  assessMatterWorking,
  closeMatter,
  createMatter,
  reopenMatter,
  setMatterOwner,
  setMatterRemediation,
  setMatterStage,
} from "@/server/commands/matters";
import { COMMANDS } from "@/server/commands/names";
import type { Actor } from "@/server/commands/run";
import { authoriseInitialVersion } from "@/server/commands/value-case";
import { db, schema } from "@/server/db/client";
import { getValuePositionSummary } from "@/server/queries/assurance";
import { buildAssuranceReport, getReportIssue } from "@/server/queries/reports";
import { getAssuranceMatter, getContinuousAssurance, getReviewResponse } from "@/server/queries/response";
import { issueReport } from "@/server/reports/issue";
import { renderReportArticle } from "@/ui/reports/render";

import { asCommand, expectDomainError, newActor, proposedV1, sql, uid } from "../support/fixtures";

const today = new Date().toISOString().slice(0, 10);
const text = (m: string) =>
  m
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

/** Authorised V1 with VD-01 ($4.8m, AVO "Someone Else"), a VCO, and a separate risk owner. */
async function project() {
  const actor = await newActor();
  const ctx = await proposedV1(actor);
  const v1 = await authoriseInitialVersion(actor, {
    versionId: ctx.v1.id,
    authorisedByPersonId: ctx.vco.id,
    authorisedOn: today,
    authorisationEvidenceId: ctx.evidence.id,
  });
  const { person: riskOwner } = await addStakeholder(actor, { projectId: ctx.project.id, name: "Rita Risk" });
  return { actor, ...ctx, v1, riskOwner };
}
type Ctx = Awaited<ReturnType<typeof project>>;

const matter = (ctx: Ctx, over: Partial<Parameters<typeof createMatter>[1]> = {}) =>
  createMatter(ctx.actor, {
    projectId: ctx.project.id,
    code: `VL-${uid().slice(0, 4)}`,
    title: "Supplier delay",
    driverIds: [ctx.driver.id],
    ...over,
  });

async function finalisedReview(ctx: Ctx, before?: (reviewId: string) => Promise<void>) {
  const review = await createReview(ctx.actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate: today });
  await upsertValuePositions(ctx.actor, {
    reviewId: review.id,
    positions: [
      { forecastRationale: "Synthetic test rationale", valueDriverId: ctx.driver.id, currentForecast: "4500000.00" },
    ],
  });
  await before?.(review.id);
  return finaliseReview(ctx.actor, { reviewId: review.id });
}

async function versionSnapshot(projectId: string) {
  const versions = await db()
    .select()
    .from(schema.valueCaseVersion)
    .where(eq(schema.valueCaseVersion.projectId, projectId));
  const drivers = await db()
    .select()
    .from(schema.valueDriverVersion)
    .where(eq(schema.valueDriverVersion.projectId, projectId));
  return JSON.stringify({ versions, drivers });
}

const auditOf = (rowId: string) =>
  db().select().from(schema.auditEvent).where(eq(schema.auditEvent.rowId, rowId)).orderBy(schema.auditEvent.id);

// ---------------------------------------------------------------------------

describe("Continuous Assurance matters", () => {
  it("are raised without an Assurance Review and change no Value Case version, forecast or gap", async () => {
    const ctx = await project();
    await finalisedReview(ctx);
    const versionsBefore = await versionSnapshot(ctx.project.id);
    const positionBefore = await getValuePositionSummary(ctx.project.id);

    const m = await matter(ctx, { responseOwnerPersonId: ctx.riskOwner.id });
    expect(m).toMatchObject({ identifiedInReviewId: null, identifiedOn: today, stage: "identified", status: "open" });
    await assessMatterWorking(ctx.actor, { matterId: m.id, workingTotalAmount: "300000.00" });

    expect(await versionSnapshot(ctx.project.id)).toBe(versionsBefore);
    const positionAfter = await getValuePositionSummary(ctx.project.id);
    expect(positionAfter.authorisedTotal).toBe(positionBefore.authorisedTotal);
    expect(positionAfter.latest!.totals).toEqual(positionBefore.latest!.totals); // forecast, gap unchanged
    expect(positionAfter.latest!.totals.valueGap).toBe("300000.00"); // 4.8m − 4.5m, not leakage
  });

  it("requires an Authorised Value Case and refuses future identification dates", async () => {
    const actor = await newActor();
    const ctx = await proposedV1(actor);
    await expectDomainError(
      createMatter(actor, { projectId: ctx.project.id, code: "VL-001", title: "x" }),
      "VO_VERSION_NOT_AUTHORISED",
    );
    const auth = await project();
    await expectDomainError(matter(auth, { identifiedOn: "2999-01-01" }), "VO_INVALID_INPUT");
  });

  it("moves freely between working stages, each change audited", async () => {
    const ctx = await project();
    const m = await matter(ctx);
    for (const stage of [
      "escalated",
      "identified",
      "monitoring",
      "awaiting_evidence",
      "assessing",
      "remediation",
    ] as const) {
      expect((await setMatterStage(ctx.actor, { matterId: m.id, stage })).stage).toBe(stage);
    }
    const audit = await auditOf(m.id);
    expect(audit.filter((a) => a.command === "matter.setStage")).toHaveLength(6);
    expect(audit.every((a) => a.actorUserId === ctx.actor.userId)).toBe(true);
    // Only matter.setStage changes the stage.
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.updateLeakage, (tx) =>
        tx.update(schema.valueLeakage).set({ stage: "identified" }).where(eq(schema.valueLeakage.id, m.id)),
      ),
      "VO_WRONG_COMMAND",
    );
  });

  it("has a Risk / Leakage Owner distinct from the affected driver's AVO", async () => {
    const ctx = await project();
    const m = await matter(ctx);
    await setMatterOwner(ctx.actor, { matterId: m.id, responseOwnerPersonId: ctx.riskOwner.id });
    const [dv] = await db()
      .select()
      .from(schema.valueDriverVersion)
      .where(eq(schema.valueDriverVersion.valueDriverId, ctx.driver.id));
    expect(dv!.avoPersonId).toBe(ctx.other.id);
    const detail = (await getAssuranceMatter(ctx.project.id, m.id))!;
    expect(detail.ownerName).toBe("Rita Risk");
    // The same stakeholder may hold both roles.
    await setMatterOwner(ctx.actor, { matterId: m.id, responseOwnerPersonId: ctx.other.id });
    expect((await getAssuranceMatter(ctx.project.id, m.id))!.ownerName).toBe("Someone Else");
  });

  it("working assessment: may stay unquantified; validated; attributed by the database; clearable", async () => {
    const ctx = await project();
    const m = await matter(ctx);
    expect((await getAssuranceMatter(ctx.project.id, m.id))!.working).toBeNull();

    await expectDomainError(
      assessMatterWorking(ctx.actor, { matterId: m.id, workingTotalAmount: "-1.00" }),
      "VO_INVALID_INPUT",
    );
    await expectDomainError(
      assessMatterWorking(ctx.actor, {
        matterId: m.id,
        workingTotalAmount: "100.00",
        workingUnrecoverableAmount: "200.00",
        workingUnrecoverableRationale: "x",
      }),
      "VO_INVALID_INPUT",
    );
    await expectDomainError(
      assessMatterWorking(ctx.actor, {
        matterId: m.id,
        workingTotalAmount: "100.00",
        workingUnrecoverableAmount: "50.00",
      }),
      "VO_INVALID_INPUT",
    );
    // The database enforces the same rules beneath the command.
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.assessMatterWorking, (tx) =>
        tx
          .update(schema.valueLeakage)
          .set({
            workingTotalAmount: "100.00",
            workingUnrecoverableAmount: "200.00",
            workingUnrecoverableRationale: "x",
          })
          .where(eq(schema.valueLeakage.id, m.id)),
      ),
      "VO_CHECK_VIOLATION",
    );
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.assessMatterWorking, (tx) =>
        tx
          .update(schema.valueLeakage)
          .set({ workingTotalAmount: "100.00", workingUnrecoverableAmount: "50.00" })
          .where(eq(schema.valueLeakage.id, m.id)),
      ),
      "VO_CHECK_VIOLATION",
    );
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.setMatterRemediation, (tx) =>
        tx
          .update(schema.valueLeakage)
          .set({ workingTotalAmount: "100.00", workingUnrecoverableAmount: "0.00" })
          .where(eq(schema.valueLeakage.id, m.id)),
      ),
      "VO_WRONG_COMMAND",
    );

    const other = await newActor();
    const row = await assessMatterWorking(other, {
      matterId: m.id,
      workingTotalAmount: "250000.00",
      workingUnrecoverableAmount: "50000.00",
      workingUnrecoverableRationale: "Two months already lost (E-7)",
    });
    expect(row).toMatchObject({ workingAssessedBy: other.userId, workingUnrecoverableAmount: "50000.00" });
    expect(row.workingAssessedAt).toBeInstanceOf(Date);
    const detail = (await getAssuranceMatter(ctx.project.id, m.id))!;
    expect(detail.working).toEqual({ total: "250000.00", unrecoverable: "50000.00", recoverable: "200000.00" });

    const cleared = await assessMatterWorking(ctx.actor, { matterId: m.id, workingTotalAmount: null });
    expect(cleared).toMatchObject({
      workingTotalAmount: null,
      workingUnrecoverableAmount: null,
      workingAssessedBy: null,
    });
    expect((await getAssuranceMatter(ctx.project.id, m.id))!.working).toBeNull();
  });

  it("records remediation and monitoring, closes with a note, and reopens explicitly", async () => {
    const ctx = await project();
    const m = await matter(ctx);
    await setMatterRemediation(ctx.actor, {
      matterId: m.id,
      remediationPlan: "Re-sequence vendors",
      monitorUntil: "2027-03-31",
    });
    expect((await getAssuranceMatter(ctx.project.id, m.id))!.leakage).toMatchObject({
      remediationPlan: "Re-sequence vendors",
      monitorUntil: "2027-03-31",
    });

    // Closing needs a note, via matter.close only.
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.closeMatter, (tx) =>
        tx.update(schema.valueLeakage).set({ status: "closed" }).where(eq(schema.valueLeakage.id, m.id)),
      ),
      "VO_CLOSURE_NOTE_REQUIRED",
    );
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.updateLeakage, (tx) =>
        tx
          .update(schema.valueLeakage)
          .set({ status: "closed", closureNote: "x" })
          .where(eq(schema.valueLeakage.id, m.id)),
      ),
      "VO_WRONG_COMMAND",
    );
    const closed = await closeMatter(ctx.actor, { matterId: m.id, closureNote: "Vendors re-sequenced; no loss" });
    expect(closed).toMatchObject({ status: "closed", closureNote: "Vendors re-sequenced; no loss" });

    // Closed matters have no working changes until reopened.
    await expectDomainError(setMatterStage(ctx.actor, { matterId: m.id, stage: "assessing" }), "VO_MATTER_CLOSED");
    await expectDomainError(
      assessMatterWorking(ctx.actor, { matterId: m.id, workingTotalAmount: "1.00" }),
      "VO_MATTER_CLOSED",
    );
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.setMatterStage, (tx) =>
        tx.update(schema.valueLeakage).set({ stage: "assessing" }).where(eq(schema.valueLeakage.id, m.id)),
      ),
      "VO_MATTER_CLOSED",
    );
    const reopened = await reopenMatter(ctx.actor, { matterId: m.id });
    expect(reopened).toMatchObject({ status: "open", closureNote: "Vendors re-sequenced; no loss" });
    // Never deleted.
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.closeMatter, (tx) =>
        tx.delete(schema.valueLeakage).where(eq(schema.valueLeakage.id, m.id)),
      ),
      "VO_FIELD_IMMUTABLE",
    );
    expect((await getContinuousAssurance(ctx.project.id)).open.map((e) => e.leakage.id)).toContain(m.id);
  });
});

describe("formal Assurance Review snapshot", () => {
  it("snapshots every open matter — quantified or not — and never takes working figures as formal", async () => {
    const ctx = await project();
    const quantified = await matter(ctx, {
      code: "VL-101",
      title: "Quantified in review",
      responseOwnerPersonId: ctx.riskOwner.id,
    });
    const unquantified = await matter(ctx, { code: "VL-102", title: "Unquantified" });
    const workingOnly = await matter(ctx, { code: "VL-103", title: "Working only" });
    await assessMatterWorking(ctx.actor, { matterId: workingOnly.id, workingTotalAmount: "777777.00" });
    const closedEarlier = await matter(ctx, { code: "VL-104", title: "Closed earlier" });
    await closeMatter(ctx.actor, { matterId: closedEarlier.id, closureNote: "Not a risk" });
    await setMatterStage(ctx.actor, { matterId: quantified.id, stage: "remediation" });

    const review = await finalisedReview(ctx, async (reviewId) => {
      await assessLeakage(ctx.actor, {
        leakageId: quantified.id,
        reviewId,
        totalAmount: "400000.00",
        unrecoverableAmount: "100000.00",
        unrecoverableRationale: "Lost quarter",
      });
    });
    expect(review.matterSnapshotAt).toBeInstanceOf(Date);

    const rows = await db()
      .select()
      .from(schema.leakageAssessment)
      .where(eq(schema.leakageAssessment.assuranceReviewId, review.id));
    const byMatter = new Map(rows.map((r) => [r.valueLeakageId, r]));
    expect(byMatter.size).toBe(3);
    expect(byMatter.has(closedEarlier.id)).toBe(false);
    expect(byMatter.get(quantified.id)).toMatchObject({
      totalAmount: "400000.00",
      unrecoverableAmount: "100000.00",
      snapshotStage: "remediation",
      snapshotOwnerPersonId: ctx.riskOwner.id,
      snapshotTitle: "Quantified in review",
      snapshotDriverIds: [ctx.driver.id],
    });
    expect(byMatter.get(unquantified.id)).toMatchObject({
      totalAmount: null,
      unrecoverableAmount: null,
      snapshotStatus: "open",
    });
    // The working assessment was not adopted as a formal figure.
    expect(byMatter.get(workingOnly.id)).toMatchObject({ totalAmount: null, unrecoverableAmount: null });

    const response = await getReviewResponse(ctx.project.id, review.id);
    expect(response.leakageBasis).toBe("snapshot");
    expect(response.leakageSummary).toMatchObject({
      itemCount: 3,
      assessedCount: 1,
      total: "400000.00",
      recoverable: "300000.00",
      unrecoverable: "100000.00",
    });
    expect(response.leakage.every((l) => l.working === null && l.leakage.workingTotalAmount === null)).toBe(true);

    // Report: unquantified reads "Not yet quantified", never $0; working figures never appear.
    const report = (await buildAssuranceReport(ctx.project.id, review.id))!.model as AssuranceReport;
    const items = new Map(report.leakage.items.map((i) => [i.code, i]));
    expect(items.get("VL-102")!.assessment).toBeNull();
    expect(items.get("VL-102")!.identifiedInReview).toBeNull();
    const rendered = text(renderReportArticle(report, { state: "preview" }));
    // Model v3 (4D.9J): the matter also appears in the story; the leakage table is under its own heading.
    const table = rendered.slice(rendered.indexOf(". Value Leakage Per matter"));
    const row = table.slice(table.indexOf("VL-102 Unquantified"));
    expect(row).toMatch(/^VL-102 Unquantified \S+ Not assigned Not yet quantified/);
    expect(rendered).not.toContain("777,777");
    expect(rendered).not.toContain("$0.8m");
  });

  it("finalisation is atomic and refuses an incomplete snapshot", async () => {
    const ctx = await project();
    const m = await matter(ctx);
    const review = await createReview(ctx.actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate: today });
    await upsertValuePositions(ctx.actor, {
      reviewId: review.id,
      positions: [
        { forecastRationale: "Synthetic test rationale", valueDriverId: ctx.driver.id, currentForecast: "4500000.00" },
      ],
    });
    // Bypassing the snapshot is refused by the database.
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.finaliseAssuranceReview, (tx) =>
        tx
          .update(schema.assuranceReview)
          .set({
            status: "finalised",
            finalisedBy: ctx.actor.userId,
            finalisedAt: new Date(),
            matterSnapshotAt: new Date(),
          })
          .where(eq(schema.assuranceReview.id, review.id)),
      ),
      "VO_MATTER_SNAPSHOT_MISSING",
    );
    // Only finalisation writes snapshots, and it never writes formal amounts.
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.assessLeakage, (tx) =>
        tx.insert(schema.leakageAssessment).values({
          valueLeakageId: m.id,
          assuranceReviewId: review.id,
          projectId: ctx.project.id,
          totalAmount: "1.00",
          unrecoverableAmount: "0.00",
          snapshotTakenAt: new Date(),
          snapshotStatus: "open",
          snapshotTitle: "forged",
          snapshotDriverIds: [],
        }),
      ),
      "VO_WRONG_COMMAND",
    );
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.finaliseAssuranceReview, (tx) =>
        tx.insert(schema.leakageAssessment).values({
          valueLeakageId: m.id,
          assuranceReviewId: review.id,
          projectId: ctx.project.id,
          totalAmount: "1.00",
          unrecoverableAmount: "0.00",
          snapshotTakenAt: new Date(),
          snapshotStatus: "open",
          snapshotTitle: "forged",
          snapshotDriverIds: [],
        }),
      ),
      "VO_INVALID_INPUT",
    );
    const [still] = await db().select().from(schema.assuranceReview).where(eq(schema.assuranceReview.id, review.id));
    expect(still!.status).toBe("draft");
    expect(
      await db()
        .select()
        .from(schema.leakageAssessment)
        .where(eq(schema.leakageAssessment.assuranceReviewId, review.id)),
    ).toHaveLength(0);
    const done = await finaliseReview(ctx.actor, { reviewId: review.id });
    expect(done.status).toBe("finalised");
  });

  it("later edits to the living matter never change the finalised snapshot or an issued report", async () => {
    const ctx = await project();
    const m = await matter(ctx, { code: "VL-201", title: "Original title", responseOwnerPersonId: ctx.riskOwner.id });
    await setMatterStage(ctx.actor, { matterId: m.id, stage: "assessing" });
    const review = await finalisedReview(ctx);
    const issued = await issueReport(ctx.actor, { type: "assurance", projectId: ctx.project.id, subjectId: review.id });
    const before = await getReviewResponse(ctx.project.id, review.id);
    const reportBefore = (await buildAssuranceReport(ctx.project.id, review.id))!.model;

    await updateLeakage(ctx.actor, { leakageId: m.id, title: "Renamed later", description: "new" });
    await setLeakageDrivers(ctx.actor, { leakageId: m.id, driverIds: [] });
    await setMatterStage(ctx.actor, { matterId: m.id, stage: "escalated" });
    await setMatterOwner(ctx.actor, { matterId: m.id, responseOwnerPersonId: null });
    await assessMatterWorking(ctx.actor, { matterId: m.id, workingTotalAmount: "999000.00" });
    await setMatterRemediation(ctx.actor, { matterId: m.id, remediationPlan: "later plan", monitorUntil: null });

    const after = await getReviewResponse(ctx.project.id, review.id);
    expect(after.leakage).toEqual(
      before.leakage.map((l) => ({
        ...l,
        assessments: after.leakage.find((a) => a.leakage.id === l.leakage.id)!.assessments,
      })),
    );
    expect(after.leakage[0]!.leakage).toMatchObject({ title: "Original title", stage: "assessing" });
    expect(after.leakage[0]!.ownerName).toBe("Rita Risk");
    expect((await buildAssuranceReport(ctx.project.id, review.id))!.model).toEqual(reportBefore);
    expect(await getReportIssue(ctx.project.id, issued.id)).toEqual(issued);

    // The living matter moved on.
    const living = (await getAssuranceMatter(ctx.project.id, m.id))!;
    expect(living.leakage).toMatchObject({ title: "Renamed later", stage: "escalated" });
    expect(living.formal).toEqual([
      expect.objectContaining({ reviewId: review.id, amounts: null, snapshotted: true, stage: "assessing" }),
    ]);

    // Snapshot rows of a finalised review are immutable.
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.finaliseAssuranceReview, (tx) =>
        tx
          .update(schema.leakageAssessment)
          .set({ snapshotTitle: "rewritten" })
          .where(eq(schema.leakageAssessment.assuranceReviewId, review.id)),
      ),
      "VO_REVIEW_IMMUTABLE",
    );
  }, 60_000);
});

describe("legacy review-bound leakage (pre-4D.1)", () => {
  /** A review finalised before 4D.1: no matter snapshot. Simulated beneath the triggers. */
  async function legacyReview(ctx: Ctx, actor: Actor) {
    const draft = await createReview(actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate: today });
    await upsertValuePositions(actor, {
      reviewId: draft.id,
      positions: [
        { forecastRationale: "Synthetic test rationale", valueDriverId: ctx.driver.id, currentForecast: "4500000.00" },
      ],
    });
    const legacy = await createLeakage(actor, {
      reviewId: draft.id,
      code: "VL-L1",
      title: "Legacy issue",
      driverIds: [ctx.driver.id],
    });
    await assessLeakage(actor, { leakageId: legacy.id, reviewId: draft.id, totalAmount: "200000.00" });
    await finaliseReview(actor, { reviewId: draft.id });
    await db().transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`update assurance_review set matter_snapshot_at = null where id = ${draft.id}`);
      await tx.execute(sql`update leakage_assessment set snapshot_taken_at = null, snapshot_status = null, snapshot_title = null,
        snapshot_driver_ids = null, snapshot_stage = null, snapshot_owner_person_id = null where assurance_review_id = ${draft.id}`);
      await tx.execute(sql`update value_leakage set stage = null where id = ${legacy.id}`);
    });
    return { reviewId: draft.id, legacy };
  }

  it("remain readable with their originating review, live details and formal amounts", async () => {
    const ctx = await project();
    const { reviewId, legacy } = await legacyReview(ctx, ctx.actor);
    const response = await getReviewResponse(ctx.project.id, reviewId);
    expect(response.leakageBasis).toBe("legacy");
    const entry = response.leakage.find((l) => l.leakage.id === legacy.id)!;
    expect(entry.identifiedInSequence).toBe(1);
    expect(entry.leakage.stage).toBeNull();
    expect(entry.thisReview!.amounts).toEqual({ total: "200000.00", unrecoverable: "0.00", recoverable: "200000.00" });
    // A matter raised later in Continuous Assurance does not appear in the legacy review.
    await matter(ctx, { code: "VL-L2", title: "Raised later" });
    expect((await getReviewResponse(ctx.project.id, reviewId)).leakage.map((l) => l.leakage.code)).toEqual(["VL-L1"]);
    // Continuous Assurance lists the legacy open matter as Open (no stage).
    const continuous = await getContinuousAssurance(ctx.project.id);
    expect(continuous.open.find((e) => e.leakage.id === legacy.id)!.leakage.stage).toBeNull();
    expect(continuous.open.find((e) => e.leakage.id === legacy.id)!.latestFinalised!.amounts.total).toBe("200000.00");
    // Its origin stays immutable.
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.updateLeakage, (tx) =>
        tx
          .update(schema.valueLeakage)
          .set({ identifiedInReviewId: null, identifiedOn: today })
          .where(eq(schema.valueLeakage.id, legacy.id)),
      ),
      "VO_FIELD_IMMUTABLE",
    );
    // And the next formal review snapshots it like any open matter.
    const next = await createReview(ctx.actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate: today });
    await upsertValuePositions(ctx.actor, {
      reviewId: next.id,
      positions: [
        { forecastRationale: "Synthetic test rationale", valueDriverId: ctx.driver.id, currentForecast: "4400000.00" },
      ],
    });
    await finaliseReview(ctx.actor, { reviewId: next.id });
    const snap = await db()
      .select()
      .from(schema.leakageAssessment)
      .where(
        and(
          eq(schema.leakageAssessment.assuranceReviewId, next.id),
          eq(schema.leakageAssessment.valueLeakageId, legacy.id),
        ),
      );
    expect(snap[0]).toMatchObject({ totalAmount: null, snapshotStage: null, snapshotStatus: "open" });
  });
});
