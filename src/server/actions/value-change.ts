"use server";

import { redirect } from "next/navigation";

import {
  authoriseValueChange,
  createValueChange,
  determineValueCaseImpact,
  includeDriverInValueChange,
  proposeValueChange,
  rejectValueChange,
  returnValueChange,
  updateValueChange,
  withdrawValueChange,
} from "@/server/commands/value-change";

import { VALUE_CHANGE_DETERMINATIONS, type ValueChangeDetermination } from "@/domain/statuses";

import { clear, moneyField, opt, required } from "./form";
import { perform } from "./perform";
import type { ActionState } from "./state";

const projectOf = (fd: FormData) => required(fd, "projectId");
const changeOf = (fd: FormData) => required(fd, "changeId");

/** Phase 4D.10H: the Value Case impact of a management decision (never creates a Value Change). */
export async function determineValueCaseImpactAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const v = required(fd, "determination");
    const determination = (VALUE_CHANGE_DETERMINATIONS as readonly string[]).includes(v)
      ? (v as ValueChangeDetermination)
      : ("" as ValueChangeDetermination);
    await determineValueCaseImpact(actor, {
      reviewId: required(fd, "reviewId"),
      determination,
      rationale: required(fd, "rationale"),
    });
    return determination === "no_value_change_required"
      ? "Recorded: No Value Change Required — the Authorised Value Case is unchanged"
      : "Recorded: Value Change Proposed — prepare the Value Change to propose the authorised change";
  });
}

export async function createValueChangeAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let changeId: string | undefined;
  const state = await perform(projectOf(fd), async (actor) => {
    const { change } = await createValueChange(actor, {
      projectId: projectOf(fd),
      code: required(fd, "code").toUpperCase(),
      reason: opt(fd, "reason"),
      economicImpactNarrative: opt(fd, "economicImpactNarrative"),
      statedChangeAmount: moneyField(fd, "statedChangeAmount", "create"),
      assuranceReviewId: opt(fd, "assuranceReviewId"),
      decisionId: opt(fd, "decisionId"),
    });
    changeId = change.id;
  });
  if (state.status === "ok" && changeId) redirect(`/projects/${projectOf(fd)}/changes/${changeId}`);
  return state;
}

export async function updateValueChangeAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await updateValueChange(actor, {
      changeId: changeOf(fd),
      code: required(fd, "code").toUpperCase(),
      reason: clear(fd, "reason"),
      economicImpactNarrative: clear(fd, "economicImpactNarrative"),
      statedChangeAmount: moneyField(fd, "statedChangeAmount", "update"),
    });
    return "Value Change saved";
  });
}

export async function proposeValueChangeAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const c = await proposeValueChange(actor, { changeId: changeOf(fd) });
    return `${c.code} proposed to the VCO — the proposed version is locked`;
  });
}

export async function returnValueChangeAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const c = await returnValueChange(actor, { changeId: changeOf(fd) });
    return `${c.code} returned to draft for revision`;
  });
}

export async function authoriseValueChangeAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const c = await authoriseValueChange(actor, {
      changeId: changeOf(fd),
      authorisedByPersonId: required(fd, "authorisedByPersonId"),
      authorisedOn: required(fd, "authorisedOn"),
      authorisationEvidenceId: required(fd, "authorisationEvidenceId"),
      authorisationNote: opt(fd, "authorisationNote"),
    });
    return `${c.code} authorised — the new version is now the Authorised Value Case in force`;
  });
}

export async function rejectValueChangeAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const c = await rejectValueChange(actor, { changeId: changeOf(fd), closureNote: required(fd, "closureNote") });
    return `${c.code} recorded as rejected by the VCO`;
  });
}

export async function withdrawValueChangeAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const c = await withdrawValueChange(actor, { changeId: changeOf(fd), closureNote: required(fd, "closureNote") });
    return `${c.code} withdrawn`;
  });
}

/** Phase 4D.3: add an existing (typically emerging) driver identity to the proposed version only. */
export async function includeDriverAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const dv = await includeDriverInValueChange(actor, {
      changeId: changeOf(fd),
      valueDriverId: required(fd, "valueDriverId"),
    });
    return `${dv.name} added to the proposed Value Case`;
  });
}
