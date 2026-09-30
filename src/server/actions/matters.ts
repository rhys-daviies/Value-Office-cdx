"use server";

import { redirect } from "next/navigation";

import { ASSURANCE_STAGES, type AssuranceStage, INFORMATION_REQUEST_ITEM_STATUSES } from "@/domain/statuses";
import { updateInformationRequestItem } from "@/server/commands/information-request";
import {
  documentMatterEvidence,
  linkMatterEvidence,
  requestMatterEvidence,
  unlinkMatterEvidence,
} from "@/server/commands/matter-evidence";
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

// Continuous Assurance matter actions (Phases 4D.1–4D.2): FormData → one named command each.

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

// --- Evidence for a matter (Phase 4D.2) ----------------------------------------
// Working links only. None of these moves the matter's stage or working figures.

export async function documentMatterEvidenceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const e = await documentMatterEvidence(actor, {
      matterId: matterOf(fd),
      code: required(fd, "code").toUpperCase(),
      title: required(fd, "title"),
      summary: opt(fd, "summary"),
      sourcePersonId: opt(fd, "sourcePersonId"),
      evidenceDate: opt(fd, "evidenceDate"),
      receivedOn: opt(fd, "receivedOn"),
      relevanceNote: opt(fd, "relevanceNote"),
      valueDriverId: opt(fd, "valueDriverId"),
    });
    return `Evidence ${e.code} recorded and linked to this matter`;
  });
}

export async function linkMatterEvidenceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await linkMatterEvidence(actor, {
      matterId: matterOf(fd),
      evidenceId: required(fd, "evidenceId"),
      relevanceNote: opt(fd, "relevanceNote"),
    });
    return "Evidence linked to this matter";
  });
}

export async function unlinkMatterEvidenceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await unlinkMatterEvidence(actor, { evidenceLinkId: required(fd, "evidenceLinkId") });
    return "Working link removed";
  });
}

/** `informationRequestId` = "new" raises a new Assurance Information Request in the same transaction. */
export async function requestMatterEvidenceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const target = required(fd, "informationRequestId");
    const item = await requestMatterEvidence(actor, {
      matterId: matterOf(fd),
      informationRequestId: target && target !== "new" ? target : undefined,
      newRequestTitle: target === "new" || !target ? required(fd, "newRequestTitle") || undefined : undefined,
      description: required(fd, "description"),
      requestedFromPersonId: opt(fd, "requestedFromPersonId"),
      dueOn: opt(fd, "dueOn"),
      valueDriverId: opt(fd, "valueDriverId"),
      notes: opt(fd, "notes"),
    });
    return `Evidence requested (item #${item.sequence})`;
  });
}

/** Records what arrived against a request item, through the existing fulfilment mechanism. */
export async function fulfilRequestItemAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const status = required(fd, "status");
    if (!(INFORMATION_REQUEST_ITEM_STATUSES as readonly string[]).includes(status)) {
      throw new FormInputError("status", "Choose a status");
    }
    await updateInformationRequestItem(actor, {
      itemId: required(fd, "itemId"),
      status: status as (typeof INFORMATION_REQUEST_ITEM_STATUSES)[number],
      fulfilledByEvidenceId: clear(fd, "fulfilledByEvidenceId"),
    });
    return "Request item updated";
  });
}
