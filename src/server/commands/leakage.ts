import { eq } from "drizzle-orm";
import { z } from "zod";

import { DomainError } from "@/domain/errors";
import { money } from "@/domain/money";
import { LEAKAGE_STATUSES } from "@/domain/statuses";
import { schema, type Tx } from "@/server/db/client";

import { COMMANDS } from "./names";
import { defineCommand } from "./run";
import {
  clearableDate,
  clearableText,
  clearableUuid,
  isoDate,
  moneyString,
  nonBlank,
  optionalText,
  uuid,
} from "./schemas";

// Value Leakage: total potential value affected by an identified issue.
//   Total VL = Recoverable VL + Unrecoverable VL; Recoverable is derived.
// Until sufficient evidence shows value is lost, leakage is recoverable
// (unrecoverable defaults to 0). Leakage is independent of Value Gap.

async function getLeakage(tx: Tx, leakageId: string) {
  const [row] = await tx.select().from(schema.valueLeakage).where(eq(schema.valueLeakage.id, leakageId));
  if (!row) throw new DomainError("VO_NOT_FOUND", "Value Leakage item not found");
  return row;
}

async function replaceDrivers(tx: Tx, leakage: typeof schema.valueLeakage.$inferSelect, driverIds: readonly string[]) {
  await tx.delete(schema.valueLeakageDriver).where(eq(schema.valueLeakageDriver.valueLeakageId, leakage.id));
  if (driverIds.length === 0) return;
  await tx.insert(schema.valueLeakageDriver).values(
    [...new Set(driverIds)].map((valueDriverId) => ({
      valueLeakageId: leakage.id,
      valueCaseId: leakage.valueCaseId,
      projectId: leakage.projectId,
      valueDriverId,
    })),
  );
}

export const createLeakage = defineCommand(
  COMMANDS.createLeakage,
  z.object({
    reviewId: uuid,
    code: nonBlank,
    title: nonBlank,
    description: optionalText,
    responseOwnerPersonId: uuid.optional(),
    requiredDecisionDate: isoDate.optional(),
    consultantAssessment: optionalText,
    driverIds: z.array(uuid).default([]),
  }),
  async ({ tx, actor }, { reviewId, driverIds, ...fields }) => {
    const [review] = await tx.select().from(schema.assuranceReview).where(eq(schema.assuranceReview.id, reviewId));
    if (!review) throw new DomainError("VO_NOT_FOUND", "Assurance Review not found");
    const [row] = await tx
      .insert(schema.valueLeakage)
      .values({
        ...fields,
        projectId: review.projectId,
        valueCaseId: review.valueCaseId,
        identifiedInReviewId: review.id,
        createdBy: actor.userId,
      })
      .returning();
    await replaceDrivers(tx, row!, driverIds);
    return row!;
  },
);

export const updateLeakage = defineCommand(
  COMMANDS.updateLeakage,
  z.object({
    leakageId: uuid,
    title: nonBlank.optional(),
    description: clearableText,
    responseOwnerPersonId: clearableUuid,
    requiredDecisionDate: clearableDate,
    consultantAssessment: clearableText,
    status: z.enum(LEAKAGE_STATUSES).optional(),
  }),
  async ({ tx }, { leakageId, ...fields }) => {
    await getLeakage(tx, leakageId);
    const [row] = await tx
      .update(schema.valueLeakage)
      .set(fields)
      .where(eq(schema.valueLeakage.id, leakageId))
      .returning();
    return row!;
  },
);

/** Replaces the set of Value Drivers the leakage affects (drivers must be in the same Value Case). */
export const setLeakageDrivers = defineCommand(
  COMMANDS.setLeakageDrivers,
  z.object({ leakageId: uuid, driverIds: z.array(uuid) }),
  async ({ tx }, input) => {
    const leakage = await getLeakage(tx, input.leakageId);
    await replaceDrivers(tx, leakage, input.driverIds);
    return tx.select().from(schema.valueLeakageDriver).where(eq(schema.valueLeakageDriver.valueLeakageId, leakage.id));
  },
);

/**
 * Records (or revises, while the review is draft) the leakage size in a review.
 * Unrecoverable > 0 requires a rationale and is validated by the acting consultant.
 */
export const assessLeakage = defineCommand(
  COMMANDS.assessLeakage,
  z.object({
    leakageId: uuid,
    reviewId: uuid,
    totalAmount: moneyString,
    unrecoverableAmount: moneyString.default("0.00"),
    unrecoverableRationale: optionalText,
    assessmentNote: optionalText,
  }),
  async ({ tx, actor }, input) => {
    const leakage = await getLeakage(tx, input.leakageId);
    const unrecoverable = !money(input.unrecoverableAmount).isZero();
    if (unrecoverable && !input.unrecoverableRationale) {
      throw new DomainError("VO_INVALID_INPUT", "Unrecoverable leakage needs a rationale citing the evidence of loss", {
        issues: [{ path: "unrecoverableRationale", message: "Required when unrecoverable is above zero" }],
      });
    }
    const values = {
      totalAmount: input.totalAmount,
      unrecoverableAmount: input.unrecoverableAmount,
      unrecoverableRationale: unrecoverable ? input.unrecoverableRationale! : null,
      unrecoverableValidatedBy: unrecoverable ? actor.userId : null,
      assessmentNote: input.assessmentNote ?? null,
      assessedAt: new Date(),
    };
    const [row] = await tx
      .insert(schema.leakageAssessment)
      .values({
        ...values,
        valueLeakageId: leakage.id,
        assuranceReviewId: input.reviewId,
        projectId: leakage.projectId,
      })
      .onConflictDoUpdate({
        target: [schema.leakageAssessment.valueLeakageId, schema.leakageAssessment.assuranceReviewId],
        set: values,
      })
      .returning();
    return row!;
  },
);
