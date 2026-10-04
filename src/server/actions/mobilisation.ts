"use server";

import { additionalItems, selectedSuggestions } from "@/domain/day-one-requests";
import { DomainError } from "@/domain/errors";
import {
  addInformationRequestItem,
  createInformationRequest,
  formatRequestReference,
} from "@/server/commands/information-request";
import { getMobilisationStatus } from "@/server/queries/projects";

import { opt, required } from "./form";
import { perform } from "./perform";
import type { ActionState } from "./state";

// Day-1 Information Request from Mobilisation (4D.10C). A thin composition of the existing commands —
// informationRequest.create, then informationRequest.addItem once per item — so every write takes the normal
// command and audit path. It never creates a second Mobilisation request.

const projectOf = (fd: FormData) => required(fd, "projectId");
const keysOf = (fd: FormData) => fd.getAll("suggestion").filter((v): v is string => typeof v === "string");

export async function createDayOneRequestAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const m = await getMobilisationStatus(projectOf(fd));
    if (!m) throw new DomainError("VO_NOT_FOUND", "Project not found");
    if (m.dayOneRequest) {
      throw new DomainError(
        "VO_ALREADY_EXISTS",
        `${m.dayOneRequest.reference} already exists — add items to it on the Information Requests page`,
      );
    }
    const suggested = selectedSuggestions(keysOf(fd));
    const items = [...suggested, ...additionalItems(opt(fd, "additionalItems"), suggested)];
    const request = await createInformationRequest(actor, {
      projectId: projectOf(fd),
      reference: formatRequestReference(m.allReferences),
      title: opt(fd, "title") ?? "Day-1 Information Request",
      purpose: "mobilisation",
    });
    for (const description of items) {
      await addInformationRequestItem(actor, { informationRequestId: request.id, description });
    }
    return `${request.reference} created with ${items.length} ${items.length === 1 ? "item" : "items"}`;
  });
}

export async function addDayOneItemsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const m = await getMobilisationStatus(projectOf(fd));
    const request = m?.dayOneRequest;
    if (!request || request.id !== required(fd, "informationRequestId")) {
      throw new DomainError("VO_NOT_FOUND", "Day-1 Information Request not found");
    }
    if (request.status === "closed") {
      throw new DomainError("VO_INVALID_TRANSITION", `${request.reference} is closed — raise a new request instead`);
    }
    const suggested = selectedSuggestions(keysOf(fd), request.descriptions);
    const items = [
      ...suggested,
      ...additionalItems(opt(fd, "additionalItems"), [...request.descriptions, ...suggested]),
    ];
    if (items.length === 0) return "Nothing new to add";
    for (const description of items) {
      await addInformationRequestItem(actor, { informationRequestId: request.id, description });
    }
    return `${items.length} ${items.length === 1 ? "item" : "items"} added to ${request.reference}`;
  });
}
