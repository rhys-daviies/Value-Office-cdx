import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { DomainError } from "@/domain/errors";
import { recommendationState, type RecommendationReviewStep, reviewStepAllowed } from "@/domain/recommendation";
import type { Tx } from "@/server/db/client";
import { SCENARIO_KINDS } from "@/domain/statuses";
import { schema } from "@/server/db/client";

import { COMMANDS } from "./names";
import { defineCommand } from "./run";
import { clearableText, isoDate, moneyString, nonBlank, optionalText, uuid } from "./schemas";

// Options / alternative trajectories, Cardaxia's recommendation and the client
// decision. Scenario totals are entered by the consultant — nothing here derives
// them (no cost-of-delay engine). The recommendation and the decision are
// separate records; issuing freezes the recommendation and its options. Phase 4D.10G: an internal Cardaxia review
// (submit → return / ready to issue) comes before issue.

export const upsertScenario = defineCommand(
  COMMANDS.upsertScenario,
  z.object({
    reviewId: uuid,
    scenarioId: uuid.optional(),
    label: nonBlank,
    kind: z.enum(SCENARIO_KINDS),
    totalValue: moneyString,
    narrative: clearableText,
    sortOrder: z.number().int().optional(),
  }),
  async ({ tx }, { reviewId, scenarioId, ...fields }) => {
    if (scenarioId) {
      const [row] = await tx
        .update(schema.scenario)
        .set(fields)
        .where(and(eq(schema.scenario.id, scenarioId), eq(schema.scenario.assuranceReviewId, reviewId)))
        .returning();
      if (!row) throw new DomainError("VO_NOT_FOUND", "Scenario not found in this review");
      return row;
    }
    const [review] = await tx.select().from(schema.assuranceReview).where(eq(schema.assuranceReview.id, reviewId));
    if (!review) throw new DomainError("VO_NOT_FOUND", "Assurance Review not found");
    const [row] = await tx
      .insert(schema.scenario)
      .values({
        ...fields,
        narrative: fields.narrative ?? null,
        assuranceReviewId: reviewId,
        projectId: review.projectId,
      })
      .returning();
    return row!;
  },
);

export const removeScenario = defineCommand(
  COMMANDS.removeScenario,
  z.object({ scenarioId: uuid }),
  async ({ tx }, input) => {
    // Phase 4D.9: an option's path goes with it (the point guard admits this command only while editable).
    await tx.delete(schema.valueTrajectoryPoint).where(eq(schema.valueTrajectoryPoint.scenarioId, input.scenarioId));
    const [row] = await tx.delete(schema.scenario).where(eq(schema.scenario.id, input.scenarioId)).returning();
    if (!row) throw new DomainError("VO_NOT_FOUND", "Scenario not found");
    return row;
  },
);

/** Drafts Cardaxia's recommendation (the review's recommended scenario plus narrative). */
export const saveRecommendation = defineCommand(
  COMMANDS.saveRecommendation,
  z.object({ reviewId: uuid, scenarioId: uuid, narrative: nonBlank }),
  async ({ tx, actor }, input) => {
    const [review] = await tx
      .select()
      .from(schema.assuranceReview)
      .where(eq(schema.assuranceReview.id, input.reviewId));
    if (!review) throw new DomainError("VO_NOT_FOUND", "Assurance Review not found");
    const [row] = await tx
      .insert(schema.recommendation)
      .values({
        assuranceReviewId: review.id,
        projectId: review.projectId,
        scenarioId: input.scenarioId,
        narrative: input.narrative,
        createdBy: actor.userId,
      })
      .onConflictDoUpdate({
        target: schema.recommendation.assuranceReviewId,
        set: { scenarioId: input.scenarioId, narrative: input.narrative },
      })
      .returning();
    return row!;
  },
);

// ---------------------------------------------------------------------------
// Phase 4D.10G: internal Cardaxia review before issue. The reviewer is internal Cardaxia (never the client VCO); the
// acting user of each step is recorded in recommendation_review_event and audit_event. Guarded again by
// vo_recommendation_review_guard / vo_recommendation_review_event_guard.

async function lockRecommendation(tx: Tx, reviewId: string) {
  const [row] = await tx
    .select()
    .from(schema.recommendation)
    .where(eq(schema.recommendation.assuranceReviewId, reviewId))
    .for("update");
  if (!row) throw new DomainError("VO_NOT_FOUND", "Draft the recommendation first");
  return row;
}

const STEP_TARGET = {
  submitted: "in_internal_review",
  returned: "returned",
  approved: "ready_to_issue",
} as const;

async function reviewStep(
  tx: Tx,
  actorId: string,
  reviewId: string,
  step: RecommendationReviewStep,
  note: string | undefined,
) {
  const rec = await lockRecommendation(tx, reviewId);
  const state = recommendationState(rec);
  if (!reviewStepAllowed(state, step)) {
    throw new DomainError(
      "VO_INVALID_TRANSITION",
      `The recommendation is ${state.replace(/_/g, " ")}; it cannot be ${step} now`,
    );
  }
  await tx.insert(schema.recommendationReviewEvent).values({
    recommendationId: rec.id,
    assuranceReviewId: rec.assuranceReviewId,
    projectId: rec.projectId,
    kind: step,
    note: note ?? null,
    createdBy: actorId,
  });
  const [row] = await tx
    .update(schema.recommendation)
    .set({ internalReviewStatus: STEP_TARGET[step] })
    .where(eq(schema.recommendation.id, rec.id))
    .returning();
  return row!;
}

/** "Cardaxia believes this recommendation is ready for internal quality review." Not issue; not client approval. */
export const submitRecommendation = defineCommand(
  COMMANDS.submitRecommendation,
  z.object({ reviewId: uuid, note: optionalText }),
  async ({ tx, actor }, input) => reviewStep(tx, actor.userId, input.reviewId, "submitted", input.note),
);

/** Internal reviewer returns the recommendation for revision; the feedback is kept permanently. */
export const returnRecommendation = defineCommand(
  COMMANDS.returnRecommendation,
  z.object({ reviewId: uuid, feedback: nonBlank }),
  async ({ tx, actor }, input) => reviewStep(tx, actor.userId, input.reviewId, "returned", input.feedback),
);

/** Internal review complete: Ready to Issue. Nothing is issued and no decision can yet be recorded. */
export const approveRecommendation = defineCommand(
  COMMANDS.approveRecommendation,
  z.object({ reviewId: uuid, note: optionalText }),
  async ({ tx, actor }, input) => reviewStep(tx, actor.userId, input.reviewId, "approved", input.note),
);

/** Issues the recommendation: it and the review's options become permanent. Internal review must be complete. */
export const issueRecommendation = defineCommand(
  COMMANDS.issueRecommendation,
  z.object({ reviewId: uuid }),
  async ({ tx, actor }, input) => {
    const [current] = await tx
      .select()
      .from(schema.recommendation)
      .where(eq(schema.recommendation.assuranceReviewId, input.reviewId));
    if (current && !current.issuedAt && current.internalReviewStatus !== "ready_to_issue") {
      throw new DomainError(
        "VO_INTERNAL_REVIEW_REQUIRED",
        "Complete Internal Cardaxia Review (Ready to Issue) before issuing to management",
      );
    }
    const [row] = await tx
      .update(schema.recommendation)
      .set({ issuedAt: new Date(), issuedBy: actor.userId })
      .where(eq(schema.recommendation.assuranceReviewId, input.reviewId))
      .returning();
    if (!row) throw new DomainError("VO_NOT_FOUND", "Draft the recommendation before issuing it");
    return row;
  },
);

/**
 * Records the client / AVO decision against an issued recommendation. The
 * recommendation is never changed; the difference between them is derived.
 */
export const recordDecision = defineCommand(
  COMMANDS.recordDecision,
  z.object({
    reviewId: uuid,
    selectedScenarioId: uuid,
    decidedByPersonId: uuid,
    decidedOn: isoDate,
    rationale: optionalText,
    economicConsequence: optionalText,
    supportingEvidenceId: uuid.optional(),
  }),
  async ({ tx, actor }, { reviewId, ...fields }) => {
    const [review] = await tx.select().from(schema.assuranceReview).where(eq(schema.assuranceReview.id, reviewId));
    if (!review) throw new DomainError("VO_NOT_FOUND", "Assurance Review not found");
    const [row] = await tx
      .insert(schema.decision)
      .values({ ...fields, assuranceReviewId: review.id, projectId: review.projectId, recordedBy: actor.userId })
      .returning();
    return row!;
  },
);
