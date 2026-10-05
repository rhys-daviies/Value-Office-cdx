import { and, asc, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { recommendationState } from "@/domain/recommendation";
import { seedCompactTrajectory } from "@/fixtures/compact";
import { finaliseReview } from "@/server/commands/assurance";
import { COMMANDS } from "@/server/commands/names";
import {
  approveRecommendation,
  issueRecommendation,
  recordDecision,
  removeScenario,
  returnRecommendation,
  saveRecommendation,
  submitRecommendation,
  upsertScenario,
} from "@/server/commands/options";
import { removeScenarioPoint, setScenarioPoint } from "@/server/commands/trajectory";
import { db, schema } from "@/server/db/client";
import { getReviewResponse } from "@/server/queries/response";
import { getReviewTrajectoryAuthoring } from "@/server/queries/trajectory";

import { asCommand, expectDomainError, newActor, sql, uid } from "../support/fixtures";

// Phase 4D.10G: internal Cardaxia review of the recommendation before it is issued to management. Synthetic "Trajectory
// Compact": a DRAFT review with three phased options (Act now $29m recommended, Delay 3 months $27m, No action $23m) and
// a saved, unissued recommendation.

async function setup() {
  const actor = await newActor();
  const x = await seedCompactTrajectory(actor, { code: `RR-${uid()}`, name: "Recommendation review (SYNTHETIC)" });
  const reviewId = x.review.id;
  const scenarios = await db()
    .select()
    .from(schema.scenario)
    .where(eq(schema.scenario.assuranceReviewId, reviewId))
    .orderBy(asc(schema.scenario.sortOrder));
  const act = scenarios.find((s) => s.label === "Act now")!;
  const delay = scenarios.find((s) => s.label === "Delay 3 months")!;
  const rec = async () =>
    (await db().select().from(schema.recommendation).where(eq(schema.recommendation.assuranceReviewId, reviewId)))[0]!;
  const st = async () => recommendationState(await rec());
  const decide = () =>
    recordDecision(actor, {
      reviewId,
      selectedScenarioId: delay.id,
      decidedByPersonId: x.vco.id,
      decidedOn: "2026-10-15",
    });
  const editAttempts = () => [
    () => saveRecommendation(actor, { reviewId, scenarioId: act.id, narrative: "Changed" }),
    () => upsertScenario(actor, { reviewId, label: "Delay 6 months", kind: "alternative", totalValue: "25000000.00" }),
    () =>
      upsertScenario(actor, {
        reviewId,
        scenarioId: delay.id,
        label: "Delay",
        kind: "alternative",
        totalValue: "1.00",
      }),
    () => removeScenario(actor, { scenarioId: delay.id }),
    () => setScenarioPoint(actor, { scenarioId: delay.id, asOf: "2027-06-30", value: "1000000.00" }),
  ];
  return { actor, ...x, reviewId, act, delay, rec, st, decide, editAttempts };
}

describe("recommendation lifecycle transitions", () => {
  it("draft → review → returned → resubmitted → returned → resubmitted → ready → issued, with full history", async () => {
    const x = await setup();
    const { actor, reviewId } = x;
    expect(await x.st()).toBe("draft");

    // Invalid from draft: return, approve, issue.
    await expectDomainError(returnRecommendation(actor, { reviewId, feedback: "x" }), "VO_INVALID_TRANSITION");
    await expectDomainError(approveRecommendation(actor, { reviewId }), "VO_INVALID_TRANSITION");
    await expectDomainError(issueRecommendation(actor, { reviewId }), "VO_INTERNAL_REVIEW_REQUIRED");

    await submitRecommendation(actor, { reviewId, note: "Ready for QA" });
    expect(await x.st()).toBe("in_internal_review");
    await expectDomainError(submitRecommendation(actor, { reviewId }), "VO_INVALID_TRANSITION");
    await expectDomainError(issueRecommendation(actor, { reviewId }), "VO_INTERNAL_REVIEW_REQUIRED");

    await returnRecommendation(actor, { reviewId, feedback: "Add a delayed-action option" });
    expect(await x.st()).toBe("returned");
    await expectDomainError(approveRecommendation(actor, { reviewId }), "VO_INVALID_TRANSITION");
    // Returned is editable: add the requested option (with its path) and revise; nothing existing is destroyed.
    const six = await upsertScenario(actor, {
      reviewId,
      label: "Delay 6 months",
      kind: "alternative",
      totalValue: "25000000.00",
      sortOrder: 4,
    });
    await setScenarioPoint(actor, { scenarioId: six.id, asOf: "2028-12-31", value: "25000000.00" });
    await saveRecommendation(actor, { reviewId, scenarioId: x.act.id, narrative: "Act now; delay costs shown" });
    await submitRecommendation(actor, { reviewId });
    await returnRecommendation(actor, { reviewId, feedback: "Explain the timing assumption" });
    await submitRecommendation(actor, { reviewId });
    await approveRecommendation(actor, { reviewId, note: "QA complete" });
    expect(await x.st()).toBe("ready_to_issue");

    // Ready to Issue can still be returned (explicit route back) — then must be resubmitted and approved again.
    await returnRecommendation(actor, { reviewId, feedback: "One more look at No action" });
    await expectDomainError(issueRecommendation(actor, { reviewId }), "VO_INTERNAL_REVIEW_REQUIRED");
    await submitRecommendation(actor, { reviewId });
    await approveRecommendation(actor, { reviewId });
    const issued = await issueRecommendation(actor, { reviewId });
    expect(issued).toMatchObject({ internalReviewStatus: "ready_to_issue", issuedBy: actor.userId });
    expect(await x.st()).toBe("issued");

    // Issued is terminal.
    for (const step of [
      () => submitRecommendation(actor, { reviewId }),
      () => returnRecommendation(actor, { reviewId, feedback: "late" }),
      () => approveRecommendation(actor, { reviewId }),
    ]) {
      await expectDomainError(step(), "VO_INVALID_TRANSITION");
    }

    // History: every step, every return reason, in order, with the acting user.
    const r = await getReviewResponse(x.project.id, reviewId);
    expect(r.recommendation!.state).toBe("issued");
    expect(r.recommendation!.history.map((h) => h.kind)).toEqual([
      "submitted",
      "returned",
      "submitted",
      "returned",
      "submitted",
      "approved",
      "returned",
      "submitted",
      "approved",
    ]);
    expect(r.recommendation!.history.filter((h) => h.kind === "returned").map((h) => h.note)).toEqual([
      "Add a delayed-action option",
      "Explain the timing assumption",
      "One more look at No action",
    ]);
    expect(r.recommendation!.history[0]!.note).toBe("Ready for QA");
    expect(r.scenarios.map((s) => s.label)).toContain("Delay 6 months");
    // One recommendation throughout (never duplicated by a return).
    expect(
      await db().select().from(schema.recommendation).where(eq(schema.recommendation.assuranceReviewId, reviewId)),
    ).toHaveLength(1);

    // Audit: each command audited with the actor; events and state changes share the transaction.
    const audit = await db()
      .select({
        command: schema.auditEvent.command,
        table: schema.auditEvent.tableName,
        actor: schema.auditEvent.actorUserId,
      })
      .from(schema.auditEvent)
      .where(
        and(
          inArray(schema.auditEvent.tableName, ["recommendation", "recommendation_review_event"]),
          inArray(schema.auditEvent.rowId, [
            (await x.rec()).id,
            ...(r.recommendation!.history.map((h) => h.id) as string[]),
          ]),
        ),
      );
    const count = (command: string, table: string) =>
      audit.filter((a) => a.command === command && a.table === table).length;
    expect(count(COMMANDS.submitRecommendation, "recommendation_review_event")).toBe(4);
    expect(count(COMMANDS.submitRecommendation, "recommendation")).toBe(4);
    expect(count(COMMANDS.returnRecommendation, "recommendation_review_event")).toBe(3);
    expect(count(COMMANDS.approveRecommendation, "recommendation")).toBe(2);
    expect(count(COMMANDS.issueRecommendation, "recommendation")).toBe(1);
    expect(audit.every((a) => a.actor === actor.userId)).toBe(true);
  });

  it("return feedback is required", async () => {
    const x = await setup();
    await submitRecommendation(x.actor, { reviewId: x.reviewId });
    await expectDomainError(
      returnRecommendation(x.actor, { reviewId: x.reviewId, feedback: "   " }),
      "VO_INVALID_INPUT",
    );
    expect(await x.st()).toBe("in_internal_review");
  });

  it("submission requires the economics issue will require (option paths reconcile)", async () => {
    const x = await setup();
    await setScenarioPoint(x.actor, { scenarioId: x.delay.id, asOf: "2028-12-31", value: "26000000.00" });
    await expectDomainError(submitRecommendation(x.actor, { reviewId: x.reviewId }), "VO_TRAJECTORY_NOT_RECONCILED");
    expect(await x.st()).toBe("draft");
    expect(
      await db()
        .select()
        .from(schema.recommendationReviewEvent)
        .where(eq(schema.recommendationReviewEvent.assuranceReviewId, x.reviewId)),
    ).toHaveLength(0); // the event rolled back with the refused transition
  });
});

describe("editability and decision by state", () => {
  it("draft and returned editable; in review and ready read-only (not frozen); issued frozen; decision only after issue", async () => {
    const x = await setup();
    const { actor, reviewId } = x;
    await expectDomainError(x.decide(), "VO_RECOMMENDATION_REQUIRED"); // draft

    await submitRecommendation(actor, { reviewId });
    for (const attempt of x.editAttempts()) await expectDomainError(attempt(), "VO_RECOMMENDATION_IN_REVIEW");
    const [pt] = await db()
      .select()
      .from(schema.valueTrajectoryPoint)
      .where(eq(schema.valueTrajectoryPoint.scenarioId, x.delay.id));
    await expectDomainError(removeScenarioPoint(actor, { pointId: pt!.id }), "VO_RECOMMENDATION_IN_REVIEW");
    let authoring = (await getReviewTrajectoryAuthoring(x.project.id, reviewId, "26000000.00"))!;
    expect(authoring).toMatchObject({ recommendationIssued: false, recommendationInReview: true });
    expect(authoring.options.every((o) => !o.editable)).toBe(true);
    await expectDomainError(x.decide(), "VO_RECOMMENDATION_REQUIRED"); // in review

    await returnRecommendation(actor, { reviewId, feedback: "Revise" });
    await saveRecommendation(actor, { reviewId, scenarioId: x.act.id, narrative: "Revised" }); // returned: editable
    authoring = (await getReviewTrajectoryAuthoring(x.project.id, reviewId, "26000000.00"))!;
    expect(authoring.options.every((o) => o.editable)).toBe(true);
    await expectDomainError(x.decide(), "VO_RECOMMENDATION_REQUIRED"); // returned

    await submitRecommendation(actor, { reviewId });
    await approveRecommendation(actor, { reviewId });
    for (const attempt of x.editAttempts()) await expectDomainError(attempt(), "VO_RECOMMENDATION_IN_REVIEW");
    await expectDomainError(x.decide(), "VO_RECOMMENDATION_REQUIRED"); // ready to issue

    await issueRecommendation(actor, { reviewId });
    for (const attempt of x.editAttempts()) await expectDomainError(attempt(), "VO_RECOMMENDATION_ISSUED");
    const d = await x.decide(); // existing decision semantics
    expect(d.selectedScenarioId).toBe(x.delay.id);
    await expectDomainError(x.decide(), "VO_UNIQUE_VIOLATION");
    await finaliseReview(actor, { reviewId });
  });
});

describe("database guards beneath the commands", () => {
  it("rejects state changes outside their commands, without history, or skipping review; history is immutable", async () => {
    const x = await setup();
    const { actor, reviewId } = x;
    const rec = await x.rec();
    const setStatus = (status: string) =>
      sql`update recommendation set internal_review_status = ${status} where id = ${rec.id}`;

    // Wrong command / no history event.
    await expectDomainError(
      asCommand(actor, COMMANDS.saveRecommendation, (tx) => tx.execute(setStatus("in_internal_review"))),
      "VO_WRONG_COMMAND",
    );
    await expectDomainError(
      asCommand(actor, COMMANDS.submitRecommendation, (tx) => tx.execute(setStatus("in_internal_review"))),
      "VO_REVIEW_EVENT_REQUIRED",
    );
    // Skipping internal review: draft → ready, or issuing a draft directly.
    await expectDomainError(
      asCommand(actor, COMMANDS.approveRecommendation, async (tx) => {
        await tx.insert(schema.recommendationReviewEvent).values({
          recommendationId: rec.id,
          assuranceReviewId: reviewId,
          projectId: x.project.id,
          kind: "approved",
          createdBy: actor.userId,
        });
      }),
      "VO_INVALID_TRANSITION",
    );
    await expectDomainError(
      asCommand(actor, COMMANDS.issueRecommendation, (tx) =>
        tx.execute(sql`update recommendation set issued_at = now(), issued_by = ${actor.userId} where id = ${rec.id}`),
      ),
      "VO_INTERNAL_REVIEW_REQUIRED",
    );
    // A recommendation cannot be created already in review.
    await expectDomainError(
      asCommand(actor, COMMANDS.saveRecommendation, (tx) =>
        tx.execute(sql`delete from recommendation where id = ${rec.id}`).then(() =>
          tx.insert(schema.recommendation).values({
            assuranceReviewId: reviewId,
            projectId: x.project.id,
            scenarioId: x.act.id,
            narrative: "x",
            createdBy: actor.userId,
            internalReviewStatus: "ready_to_issue",
          }),
        ),
      ),
      "VO_RECOMMENDATION_INSERT",
    );

    // History rows cannot be changed or removed.
    await submitRecommendation(actor, { reviewId });
    await expectDomainError(
      asCommand(actor, COMMANDS.submitRecommendation, (tx) =>
        tx.execute(sql`update recommendation_review_event set note = 'rewritten'`),
      ),
      "VO_REVIEW_HISTORY_IMMUTABLE",
    );
    await expectDomainError(
      asCommand(actor, COMMANDS.submitRecommendation, (tx) =>
        tx.execute(sql`delete from recommendation_review_event where recommendation_id = ${rec.id}`),
      ),
      "VO_REVIEW_HISTORY_IMMUTABLE",
    );
    // An event under the wrong command is refused; a recommendation in review cannot be deleted.
    await expectDomainError(
      asCommand(actor, COMMANDS.saveRecommendation, (tx) =>
        tx.insert(schema.recommendationReviewEvent).values({
          recommendationId: rec.id,
          assuranceReviewId: reviewId,
          projectId: x.project.id,
          kind: "returned",
          note: "x",
          createdBy: actor.userId,
        }),
      ),
      "VO_WRONG_COMMAND",
    );
    await expectDomainError(
      asCommand(actor, COMMANDS.saveRecommendation, (tx) =>
        tx.execute(sql`delete from recommendation where id = ${rec.id}`),
      ),
      "VO_RECOMMENDATION_IN_REVIEW",
    );
  });
});
