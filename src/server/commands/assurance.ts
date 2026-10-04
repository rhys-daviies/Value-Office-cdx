import { and, desc, eq, max, sql } from "drizzle-orm";
import { z } from "zod";

import { DomainError } from "@/domain/errors";
import { ASSURANCE_TRIGGERS } from "@/domain/statuses";
import { schema, type Tx } from "@/server/db/client";

import { COMMANDS } from "./names";
import { defineCommand } from "./run";
import { clearableMoney, clearableText, clearableUuid, isoDate, optionalText, uuid } from "./schemas";

// Value Assurance: a review records a dated Value Position against the
// Authorised Value Case version in force. Reviews never write to Value Case
// tables. Lifecycle and integrity are enforced again by vo_assurance_review_guard.

const trigger = z.enum(ASSURANCE_TRIGGERS);

async function getReview(tx: Tx, reviewId: string) {
  const [row] = await tx
    .select()
    .from(schema.assuranceReview)
    .where(eq(schema.assuranceReview.id, reviewId))
    .for("update");
  if (!row) throw new DomainError("VO_NOT_FOUND", "Assurance Review not found");
  return row;
}

function requireDraft(review: { status: string; sequence: number }) {
  if (review.status !== "draft") {
    throw new DomainError(
      "VO_REVIEW_IMMUTABLE",
      `Assurance Review #${review.sequence} is finalised; corrections require a new review`,
    );
  }
}

/**
 * Opens a draft review against the Authorised Value Case version currently in
 * force, chained to the latest finalised review (if any).
 */
export const createReview = defineCommand(
  COMMANDS.createAssuranceReview,
  z.object({
    projectId: uuid,
    trigger,
    reviewDate: isoDate,
    triggerEvidenceId: uuid.optional(),
    whatChanged: optionalText,
  }),
  async ({ tx, actor }, input) => {
    // Serialise review creation per project (sequence + previous-review choice).
    const [valueCase] = await tx
      .select()
      .from(schema.valueCase)
      .where(eq(schema.valueCase.projectId, input.projectId))
      .for("update");
    if (!valueCase) throw new DomainError("VO_NOT_FOUND", "Value Case not found");

    const [inForce] = await tx
      .select({ id: schema.valueCaseVersion.id })
      .from(schema.valueCaseVersion)
      .where(
        and(eq(schema.valueCaseVersion.valueCaseId, valueCase.id), eq(schema.valueCaseVersion.status, "authorised")),
      );
    if (!inForce) {
      throw new DomainError(
        "VO_NO_AUTHORISED_VERSION",
        "Value Assurance starts once the Value Case has been authorised by the VCO",
      );
    }

    const [openDraft] = await tx
      .select({ sequence: schema.assuranceReview.sequence })
      .from(schema.assuranceReview)
      .where(and(eq(schema.assuranceReview.projectId, input.projectId), eq(schema.assuranceReview.status, "draft")));
    if (openDraft) {
      throw new DomainError(
        "VO_DRAFT_REVIEW_OPEN",
        `Assurance Review #${openDraft.sequence} is still a draft — finalise it before opening another`,
      );
    }

    const [previous] = await tx
      .select({ id: schema.assuranceReview.id, reviewDate: schema.assuranceReview.reviewDate })
      .from(schema.assuranceReview)
      .where(and(eq(schema.assuranceReview.projectId, input.projectId), eq(schema.assuranceReview.status, "finalised")))
      .orderBy(desc(schema.assuranceReview.sequence))
      .limit(1);
    if (previous && previous.reviewDate > input.reviewDate) {
      throw new DomainError(
        "VO_REVIEW_ORDER",
        `The review date must be on or after the previous review (${previous.reviewDate})`,
        { issues: [{ path: "reviewDate", message: `Must be on or after ${previous.reviewDate}` }] },
      );
    }

    const [{ last } = { last: null }] = await tx
      .select({ last: max(schema.assuranceReview.sequence) })
      .from(schema.assuranceReview)
      .where(eq(schema.assuranceReview.projectId, input.projectId));

    const [row] = await tx
      .insert(schema.assuranceReview)
      .values({
        projectId: input.projectId,
        valueCaseId: valueCase.id,
        sequence: (last ?? 0) + 1,
        trigger: input.trigger,
        triggerEvidenceId: input.triggerEvidenceId,
        againstVersionId: inForce.id,
        previousReviewId: previous?.id,
        reviewDate: input.reviewDate,
        whatChanged: input.whatChanged,
        createdBy: actor.userId,
      })
      .returning();
    return row!;
  },
);

export const updateReview = defineCommand(
  COMMANDS.updateAssuranceReview,
  z.object({
    reviewId: uuid,
    trigger: trigger.optional(),
    reviewDate: isoDate.optional(),
    triggerEvidenceId: clearableUuid,
    whatChanged: clearableText,
    whyItMatters: clearableText,
    summary: clearableText,
    unattributedRealisedValue: clearableMoney,
    unattributedRealisedRationale: clearableText,
  }),
  async ({ tx }, { reviewId, ...fields }) => {
    const review = await getReview(tx, reviewId);
    requireDraft(review);
    const [row] = await tx
      .update(schema.assuranceReview)
      .set(fields)
      .where(eq(schema.assuranceReview.id, reviewId))
      .returning();
    return row!;
  },
);

const positionInput = z.object({
  valueDriverId: uuid,
  currentForecast: clearableMoney,
  realisedValue: clearableMoney,
  /** Explicit "Not Assessed": clears the forecast and requires a rationale. */
  forecastNotAssessed: z.boolean().optional(),
  /** Why Not Assessed, or (4D.10E) why the forecast moved from its formal baseline — required at finalisation. */
  forecastRationale: clearableText,
  realisedValueRationale: clearableText,
  /** 4D.10E: optional Assurance matter that explains the movement. */
  valueLeakageId: clearableUuid,
});

/**
 * Creates or updates Value Positions (one per driver) in a draft review.
 * `null` clears a value (not assessed); omitted fields are left unchanged.
 */
export const upsertValuePositions = defineCommand(
  COMMANDS.upsertValuePositions,
  z.object({ reviewId: uuid, positions: z.array(positionInput).min(1) }),
  async ({ tx }, input) => {
    const review = await getReview(tx, input.reviewId);
    requireDraft(review);
    const ids = input.positions.map((p) => p.valueDriverId);
    if (new Set(ids).size !== ids.length) {
      throw new DomainError("VO_DUPLICATE_POSITION", "Each Value Driver may have only one position per review");
    }
    const rows = [];
    for (const { valueDriverId, ...values } of input.positions) {
      if (values.forecastNotAssessed && values.currentForecast) {
        throw new DomainError("VO_INVALID_INPUT", "A driver cannot have both a Current Forecast and Not Assessed", {
          issues: [{ path: `forecast__${valueDriverId}`, message: "Clear the forecast or untick Not Assessed" }],
        });
      }
      if (values.forecastNotAssessed) values.currentForecast = null;
      const changes = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
      const [row] = await tx
        .insert(schema.valuePosition)
        .values({
          assuranceReviewId: review.id,
          projectId: review.projectId,
          valueCaseId: review.valueCaseId,
          valueDriverId,
          ...changes,
        })
        .onConflictDoUpdate({
          target: [schema.valuePosition.assuranceReviewId, schema.valuePosition.valueDriverId],
          // Re-assigning the review id is a no-op that keeps the upsert valid when no fields changed.
          set: Object.keys(changes).length > 0 ? changes : { assuranceReviewId: sql`excluded.assurance_review_id` },
        })
        .returning();
      rows.push(row!);
    }
    return rows;
  },
);

export const linkReviewEvidence = defineCommand(
  COMMANDS.linkAssuranceEvidence,
  z.object({ reviewId: uuid, evidenceId: uuid, relevanceNote: optionalText }),
  async ({ tx }, input) => {
    const review = await getReview(tx, input.reviewId);
    requireDraft(review);
    const [row] = await tx
      .insert(schema.evidenceLink)
      .values({
        evidenceId: input.evidenceId,
        projectId: review.projectId,
        assuranceReviewId: review.id,
        relevanceNote: input.relevanceNote,
      })
      .returning();
    return row!;
  },
);

export const unlinkReviewEvidence = defineCommand(
  COMMANDS.unlinkAssuranceEvidence,
  z.object({ evidenceLinkId: uuid }),
  async ({ tx }, input) => {
    const [row] = await tx
      .delete(schema.evidenceLink)
      .where(eq(schema.evidenceLink.id, input.evidenceLinkId))
      .returning();
    if (!row?.assuranceReviewId) throw new DomainError("VO_NOT_FOUND", "Review evidence link not found");
    return row;
  },
);

/**
 * Finalises a draft review: it and its positions become immutable. Requires a
 * Value Position for every driver in the authorised version (checked in the DB).
 */
/**
 * Phase 4D.1 formal snapshot: every open Assurance matter, and every matter formally assessed in
 * this review, is recorded as the review saw it. Formal amounts come only from this review's own
 * assessment; an unassessed matter is snapshotted as not yet quantified (null) — never as zero, and
 * never from the working assessment. Runs inside the finalisation transaction.
 */
async function snapshotMatters(tx: Tx, review: typeof schema.assuranceReview.$inferSelect): Promise<Date> {
  const takenAt = new Date();
  const matters = await tx
    .select()
    .from(schema.valueLeakage)
    .where(eq(schema.valueLeakage.projectId, review.projectId));
  const assessed = new Set(
    (
      await tx
        .select({ id: schema.leakageAssessment.valueLeakageId })
        .from(schema.leakageAssessment)
        .where(eq(schema.leakageAssessment.assuranceReviewId, review.id))
    ).map((a) => a.id),
  );
  const links = await tx
    .select({ matterId: schema.valueLeakageDriver.valueLeakageId, driverId: schema.valueLeakageDriver.valueDriverId })
    .from(schema.valueLeakageDriver)
    .where(eq(schema.valueLeakageDriver.projectId, review.projectId));

  for (const m of matters.filter((m) => m.status === "open" || assessed.has(m.id))) {
    const snapshot = {
      snapshotTakenAt: takenAt,
      snapshotStatus: m.status,
      snapshotStage: m.stage,
      snapshotTitle: m.title,
      snapshotDescription: m.description,
      snapshotOwnerPersonId: m.responseOwnerPersonId,
      snapshotDriverIds: links
        .filter((l) => l.matterId === m.id)
        .map((l) => l.driverId)
        .sort(),
      snapshotConsultantAssessment: m.consultantAssessment,
      snapshotRequiredDecisionDate: m.requiredDecisionDate,
      snapshotRemediationPlan: m.remediationPlan,
      snapshotMonitorUntil: m.monitorUntil,
    };
    if (assessed.has(m.id)) {
      await tx
        .update(schema.leakageAssessment)
        .set(snapshot)
        .where(
          and(
            eq(schema.leakageAssessment.valueLeakageId, m.id),
            eq(schema.leakageAssessment.assuranceReviewId, review.id),
          ),
        );
    } else {
      await tx.insert(schema.leakageAssessment).values({
        ...snapshot,
        valueLeakageId: m.id,
        assuranceReviewId: review.id,
        projectId: review.projectId,
        totalAmount: null,
        unrecoverableAmount: null,
      });
    }
  }
  return takenAt;
}

export const finaliseReview = defineCommand(
  COMMANDS.finaliseAssuranceReview,
  z.object({ reviewId: uuid }),
  async ({ tx, actor }, input) => {
    const review = await getReview(tx, input.reviewId);
    requireDraft(review);
    const matterSnapshotAt = await snapshotMatters(tx, review);
    const [row] = await tx
      .update(schema.assuranceReview)
      .set({ status: "finalised", finalisedBy: actor.userId, finalisedAt: new Date(), matterSnapshotAt })
      .where(eq(schema.assuranceReview.id, review.id))
      .returning();
    return row!;
  },
);
