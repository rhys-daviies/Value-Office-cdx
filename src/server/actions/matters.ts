"use server";

import { redirect } from "next/navigation";

import { ASSURANCE_STAGES, type AssuranceStage } from "@/domain/statuses";
import {
  assessMatterWorking,
  closeMatter,
  createMatter,
  reopenMatter,
  setMatterOwner,
  setMatterRemediation,
  setMatterStage,
} from "@/server/commands/matters";

import { clear, FormInputError, moneyField, opt, required } from "./form";
import { perform } from "./perform";
import type { ActionState } from "./state";

// Continuous Assurance matter actions (Phase 4D.1): FormData → one named command each.

const projectOf = (fd: FormData) => required(fd, "projectId");
const matterOf = (fd: FormData) => required(fd, "matterId");
const driverIdsOf = (fd: FormData) => fd.getAll("driverIds").filter((v): v is string => typeof v === "string" && !!v);

export async function createMatterAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let matterId: string | undefined;
  const state = await perform(projectOf(fd), async (actor) => {
    const matter = await createMatter(actor, {
      projectId: projectOf(fd),
      code: required(fd, "code").toUpperCase(),
      title: required(fd, "title"),
      description: opt(fd, "description"),
      identifiedOn: opt(fd, "identifiedOn"),
      responseOwnerPersonId: opt(fd, "responseOwnerPersonId"),
      requiredDecisionDate: opt(fd, "requiredDecisionDate"),
      driverIds: driverIdsOf(fd),
    });
    matterId = matter.id;
  });
  if (state.status === "ok" && matterId) redirect(`/projects/${projectOf(fd)}/assurance/matters/${matterId}`);
  return state;
}

export async function setMatterStageAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const stage = required(fd, "stage");
    if (!(ASSURANCE_STAGES as readonly string[]).includes(stage)) throw new FormInputError("stage", "Choose a stage");
    await setMatterStage(actor, { matterId: matterOf(fd), stage: stage as AssuranceStage });
    return "Working stage updated";
  });
}

export async function setMatterOwnerAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await setMatterOwner(actor, {
      matterId: matterOf(fd),
      responseOwnerPersonId: opt(fd, "responseOwnerPersonId") ?? null,
    });
    return "Risk / Leakage Owner updated";
  });
}

export async function assessMatterWorkingAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const clearIt = required(fd, "intent") === "clear";
    await assessMatterWorking(actor, {
      matterId: matterOf(fd),
      workingTotalAmount: clearIt ? null : (moneyField(fd, "workingTotalAmount", "update") ?? null),
      workingUnrecoverableAmount: clearIt ? null : (moneyField(fd, "workingUnrecoverableAmount", "update") ?? null),
      workingUnrecoverableRationale: clearIt ? undefined : opt(fd, "workingUnrecoverableRationale"),
    });
    return clearIt ? "Working assessment cleared — not yet quantified" : "Working assessment recorded";
  });
}

export async function setMatterRemediationAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await setMatterRemediation(actor, {
      matterId: matterOf(fd),
      remediationPlan: clear(fd, "remediationPlan"),
      monitorUntil: clear(fd, "monitorUntil"),
    });
    return "Remediation saved";
  });
}

export async function closeMatterAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const note = opt(fd, "closureNote");
    if (!note) throw new FormInputError("closureNote", "Record how the matter was resolved");
    await closeMatter(actor, { matterId: matterOf(fd), closureNote: note });
    return "Matter closed";
  });
}

export async function reopenMatterAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await reopenMatter(actor, { matterId: matterOf(fd) });
    return "Matter reopened";
  });
}
