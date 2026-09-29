import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { DomainError } from "@/domain/errors";
import { SCENARIO_KINDS } from "@/domain/statuses";
import { schema } from "@/server/db/client";

import { COMMANDS } from "./names";
import { defineCommand } from "./run";
import { clearableText, isoDate, moneyString, nonBlank, optionalText, uuid } from "./schemas";

// Options / alternative trajectories, Cardaxia's recommendation and the client
// decision. Scenario totals are entered by the consultant — nothing here derives
// them (no cost-of-delay engine). The recommendation and the decision are
// separate records; issuing freezes the recommendation and its options.

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

/** Issues the recommendation: it and the review's options become permanent. */
export const issueRecommendation = defineCommand(
  COMMANDS.issueRecommendation,
  z.object({ reviewId: uuid }),
  async ({ tx, actor }, input) => {
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
