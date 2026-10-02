"use server";

import { and, eq } from "drizzle-orm";

import { VALUE_BASIS_KINDS, type ValueBasisKind } from "@/domain/statuses";
import {
  removeForecastPoint,
  removePlanPoint,
  removeScenarioPoint,
  setForecastPoint,
  setPlanPoint,
  setScenarioPoint,
  setVersionBasis,
} from "@/server/commands/trajectory";
import { db, schema } from "@/server/db/client";

import { FormInputError, moneyField, opt, required } from "./form";
import { perform } from "./perform";
import type { ActionState } from "./state";

// Value Trajectory authoring (Phase 4D.9D): FormData → the 4D.9C commands. The database guards are the authority for
// editability, basis, dates and reconciliation; these actions only translate forms and locate the right command.

const projectOf = (fd: FormData) => required(fd, "projectId");

/** Basis kind and Value Period of a draft version (explicit save; nothing is copied implicitly). */
export async function setVersionBasisAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const kind = opt(fd, "valueBasisKind");
    if (kind !== undefined && !(VALUE_BASIS_KINDS as readonly string[]).includes(kind)) {
      throw new FormInputError("valueBasisKind", "Choose a Value Basis");
    }
    await setVersionBasis(actor, {
      versionId: required(fd, "versionId"),
      valueBasisKind: (kind as ValueBasisKind | undefined) ?? null,
      valuePeriodStart: opt(fd, "valuePeriodStart") ?? null,
      valuePeriodEnd: opt(fd, "valuePeriodEnd") ?? null,
    });
    return "Value Basis and Value Period saved";
  });
}

type ParentKind = "version" | "review" | "scenario";
const PARENTS: readonly ParentKind[] = ["version", "review", "scenario"];

function parentOf(fd: FormData): { kind: ParentKind; id: string } {
  const kind = required(fd, "parent") as ParentKind;
  if (!PARENTS.includes(kind)) throw new FormInputError("parent", "Unknown trajectory");
  return { kind, id: required(fd, "parentId") };
}

const pointColumn = {
  version: schema.valueTrajectoryPoint.valueCaseVersionId,
  review: schema.valueTrajectoryPoint.assuranceReviewId,
  scenario: schema.valueTrajectoryPoint.scenarioId,
} as const;

/**
 * Add a milestone, or edit one. A changed date is a new milestone replacing the old one (dates are immutable in the
 * domain): the new date is set first, so a refused date never loses the existing milestone.
 */
export async function saveTrajectoryPointAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const parent = parentOf(fd);
    const asOf = required(fd, "asOf");
    if (!asOf) throw new FormInputError("asOf", "Enter the milestone date");
    const value = moneyField(fd, "value", "create");
    if (value === undefined) throw new FormInputError("value", "Enter the milestone value");
    const note = opt(fd, "note");
    const replacing = opt(fd, "pointId");
    const previousAsOf = opt(fd, "previousAsOf");

    if (!replacing || asOf !== previousAsOf) {
      const [clash] = await db()
        .select({ id: schema.valueTrajectoryPoint.id })
        .from(schema.valueTrajectoryPoint)
        .where(and(eq(pointColumn[parent.kind], parent.id), eq(schema.valueTrajectoryPoint.asOf, asOf)));
      if (clash) throw new FormInputError("asOf", "There is already a milestone on this date — edit that one");
    }

    const point = { asOf, value, note };
    if (parent.kind === "version") await setPlanPoint(actor, { versionId: parent.id, ...point });
    else if (parent.kind === "review") await setForecastPoint(actor, { reviewId: parent.id, ...point });
    else await setScenarioPoint(actor, { scenarioId: parent.id, ...point });

    if (replacing && previousAsOf && asOf !== previousAsOf) await removePoint(actor, parent.kind, replacing);
    return replacing ? "Milestone updated" : "Milestone added";
  });
}

async function removePoint(actor: { userId: string }, kind: ParentKind, pointId: string) {
  if (kind === "version") await removePlanPoint(actor, { pointId });
  else if (kind === "review") await removeForecastPoint(actor, { pointId });
  else await removeScenarioPoint(actor, { pointId });
}

export async function removeTrajectoryPointAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await removePoint(actor, parentOf(fd).kind, required(fd, "pointId"));
    return "Milestone removed";
  });
}
