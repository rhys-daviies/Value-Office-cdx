import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { DomainError } from "@/domain/errors";
import { VALUE_BASIS_KINDS } from "@/domain/statuses";
import { schema, type Tx } from "@/server/db/client";

import { COMMANDS } from "./names";
import { defineCommand } from "./run";
import { isoDate, moneyString, optionalText, uuid } from "./schemas";

// Phase 4D.9C: governed Value Trajectory commands. The contract is in docs/architecture.md ("Value Trajectory
// methodology contract"). Points are consultant-entered values at real dates; nothing here derives, interpolates
// or generates a value. The database (drizzle/0020) enforces parent editability, basis kind, dates and terminal
// reconciliation; these commands only locate the parent and give clear errors for the common cases.

/** A version's basis kind and Value Period: draft versions only (immutable from proposal). */
export const setVersionBasis = defineCommand(
  COMMANDS.setVersionBasis,
  z
    .object({
      versionId: uuid,
      valueBasisKind: z.enum(VALUE_BASIS_KINDS).nullable(),
      valuePeriodStart: isoDate.nullable(),
      valuePeriodEnd: isoDate.nullable(),
    })
    .refine((v) => !v.valuePeriodStart || !v.valuePeriodEnd || v.valuePeriodStart <= v.valuePeriodEnd, {
      message: "The Value Period cannot end before it starts",
      path: ["valuePeriodEnd"],
    }),
  async ({ tx }, input) => {
    const [version] = await tx
      .select()
      .from(schema.valueCaseVersion)
      .where(eq(schema.valueCaseVersion.id, input.versionId));
    if (!version) throw new DomainError("VO_NOT_FOUND", "Value Case version not found");
    if (version.kind !== "value_case") {
      throw new DomainError(
        "VO_TRAJECTORY_INHERITED_CASE",
        "The inherited Business Case (V0) has no basis kind or Value Period",
      );
    }
    if (version.status !== "draft") {
      throw new DomainError(
        "VO_VERSION_IMMUTABLE",
        `V${version.versionNumber} is ${version.status}; its basis and Value Period change only through a Value Change`,
      );
    }
    const [row] = await tx
      .update(schema.valueCaseVersion)
      .set({
        valueBasisKind: input.valueBasisKind,
        valuePeriodStart: input.valuePeriodStart,
        valuePeriodEnd: input.valuePeriodEnd,
      })
      .where(eq(schema.valueCaseVersion.id, version.id))
      .returning();
    return row!;
  },
);

const pointInput = { asOf: isoDate, value: moneyString, note: optionalText };
type Parent = { valueCaseVersionId: string } | { assuranceReviewId: string } | { scenarioId: string };

/** Insert, or update the value and note of the point on the same date (one point per parent and date). */
async function upsertPoint(
  tx: Tx,
  createdBy: string,
  projectId: string,
  parent: Parent,
  input: { asOf: string; value: string; note?: string },
) {
  const t = schema.valueTrajectoryPoint;
  const parentMatch =
    "valueCaseVersionId" in parent
      ? eq(t.valueCaseVersionId, parent.valueCaseVersionId)
      : "assuranceReviewId" in parent
        ? eq(t.assuranceReviewId, parent.assuranceReviewId)
        : eq(t.scenarioId, parent.scenarioId);
  const [existing] = await tx
    .select()
    .from(t)
    .where(and(parentMatch, eq(t.asOf, input.asOf)));
  if (existing) {
    const [row] = await tx
      .update(t)
      .set({ value: input.value, note: input.note ?? null })
      .where(eq(t.id, existing.id))
      .returning();
    return row!;
  }
  const [row] = await tx
    .insert(t)
    .values({ projectId, ...parent, asOf: input.asOf, value: input.value, note: input.note, createdBy })
    .returning();
  return row!;
}

async function removePoint(tx: Tx, pointId: string, parent: "version" | "review" | "scenario") {
  const t = schema.valueTrajectoryPoint;
  const [point] = await tx.select().from(t).where(eq(t.id, pointId));
  const owned =
    point &&
    (parent === "version"
      ? point.valueCaseVersionId !== null
      : parent === "review"
        ? point.assuranceReviewId !== null
        : point.scenarioId !== null);
  if (!owned) throw new DomainError("VO_NOT_FOUND", "Trajectory point not found");
  const [row] = await tx.delete(t).where(eq(t.id, pointId)).returning();
  return row!;
}

/** Authorised plan point on a draft Value Case version (V1+). */
export const setPlanPoint = defineCommand(
  COMMANDS.setPlanPoint,
  z.object({ versionId: uuid, ...pointInput }),
  async ({ tx, actor }, input) => {
    const [version] = await tx
      .select({ projectId: schema.valueCaseVersion.projectId })
      .from(schema.valueCaseVersion)
      .where(eq(schema.valueCaseVersion.id, input.versionId));
    if (!version) throw new DomainError("VO_NOT_FOUND", "Value Case version not found");
    return upsertPoint(tx, actor.userId, version.projectId, { valueCaseVersionId: input.versionId }, input);
  },
);

export const removePlanPoint = defineCommand(COMMANDS.removePlanPoint, z.object({ pointId: uuid }), ({ tx }, input) =>
  removePoint(tx, input.pointId, "version"),
);

/** Formal forecast path point on a draft Assurance Review (after its review date). */
export const setForecastPoint = defineCommand(
  COMMANDS.setForecastPoint,
  z.object({ reviewId: uuid, ...pointInput }),
  async ({ tx, actor }, input) => {
    const [review] = await tx
      .select({ projectId: schema.assuranceReview.projectId })
      .from(schema.assuranceReview)
      .where(eq(schema.assuranceReview.id, input.reviewId));
    if (!review) throw new DomainError("VO_NOT_FOUND", "Assurance Review not found");
    return upsertPoint(tx, actor.userId, review.projectId, { assuranceReviewId: input.reviewId }, input);
  },
);

export const removeForecastPoint = defineCommand(
  COMMANDS.removeForecastPoint,
  z.object({ pointId: uuid }),
  ({ tx }, input) => removePoint(tx, input.pointId, "review"),
);

/** Option path point (draft review, recommendation not issued; after the review date). */
export const setScenarioPoint = defineCommand(
  COMMANDS.setScenarioPoint,
  z.object({ scenarioId: uuid, ...pointInput }),
  async ({ tx, actor }, input) => {
    const [option] = await tx
      .select({ projectId: schema.scenario.projectId })
      .from(schema.scenario)
      .where(eq(schema.scenario.id, input.scenarioId));
    if (!option) throw new DomainError("VO_NOT_FOUND", "Option not found");
    return upsertPoint(tx, actor.userId, option.projectId, { scenarioId: input.scenarioId }, input);
  },
);

export const removeScenarioPoint = defineCommand(
  COMMANDS.removeScenarioPoint,
  z.object({ pointId: uuid }),
  ({ tx }, input) => removePoint(tx, input.pointId, "scenario"),
);
