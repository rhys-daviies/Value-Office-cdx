"use server";

import { INFORMATION_REQUEST_ITEM_STATUSES, INFORMATION_REQUEST_PURPOSES } from "@/domain/statuses";
import {
  addInformationRequestItem,
  closeInformationRequest,
  createInformationRequest,
  issueInformationRequest,
  removeInformationRequestItem,
  updateInformationRequestItem,
} from "@/server/commands/information-request";

import { clear, opt, required } from "./form";
import { perform } from "./perform";
import type { ActionState } from "./state";

const projectOf = (fd: FormData) => required(fd, "projectId");
const today = () => new Date().toISOString().slice(0, 10);

export async function createInformationRequestAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await createInformationRequest(actor, {
      projectId: projectOf(fd),
      reference: required(fd, "reference"),
      title: required(fd, "title"),
      purpose: INFORMATION_REQUEST_PURPOSES.find((p) => p === opt(fd, "purpose")),
    });
    return "Information Request created";
  });
}

export async function addRequestItemAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await addInformationRequestItem(actor, {
      informationRequestId: required(fd, "informationRequestId"),
      description: required(fd, "description"),
      requestedFromPersonId: opt(fd, "requestedFromPersonId"),
      dueOn: opt(fd, "dueOn"),
      valueDriverId: opt(fd, "valueDriverId"),
      valueLeakageId: opt(fd, "valueLeakageId"),
      notes: opt(fd, "notes"),
    });
    return "Item added";
  });
}

export async function updateRequestItemAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const status = required(fd, "status");
    await updateInformationRequestItem(actor, {
      itemId: required(fd, "itemId"),
      description: required(fd, "description"),
      requestedFromPersonId: clear(fd, "requestedFromPersonId"),
      dueOn: clear(fd, "dueOn"),
      valueDriverId: clear(fd, "valueDriverId"),
      status: (INFORMATION_REQUEST_ITEM_STATUSES as readonly string[]).includes(status)
        ? (status as (typeof INFORMATION_REQUEST_ITEM_STATUSES)[number])
        : undefined,
      fulfilledByEvidenceId: clear(fd, "fulfilledByEvidenceId"),
      notes: clear(fd, "notes"),
    });
    return "Item saved";
  });
}

export async function removeRequestItemAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await removeInformationRequestItem(actor, { itemId: required(fd, "itemId") });
    return "Item removed";
  });
}

export async function issueInformationRequestAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await issueInformationRequest(actor, {
      informationRequestId: required(fd, "informationRequestId"),
      issuedOn: opt(fd, "issuedOn") ?? today(),
    });
    return "Information Request issued";
  });
}

export async function closeInformationRequestAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await closeInformationRequest(actor, {
      informationRequestId: required(fd, "informationRequestId"),
      closedOn: opt(fd, "closedOn") ?? today(),
    });
    return "Information Request closed";
  });
}
