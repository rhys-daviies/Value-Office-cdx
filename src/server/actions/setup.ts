"use server";

import { recordDocumentReference } from "@/server/commands/evidence";
import { addKeyDate, removeKeyDate, setProjectValueBasis, updateProjectDetails } from "@/server/commands/project";
import { addStakeholder, setValueCaseOwner, updateStakeholder } from "@/server/commands/stakeholders";
import { KEY_DATE_KINDS, type KeyDateKind } from "@/domain/statuses";

import { clear, opt, required } from "./form";
import { perform } from "./perform";
import type { ActionState } from "./state";

const projectOf = (fd: FormData) => required(fd, "projectId");

export async function updateProjectDetailsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await updateProjectDetails(actor, {
      projectId: projectOf(fd),
      name: required(fd, "name"),
      context: clear(fd, "context"),
    });
    return "Project details saved";
  });
}

export async function setValueBasisAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await setProjectValueBasis(actor, {
      projectId: projectOf(fd),
      valueBasisDescription: required(fd, "valueBasisDescription"),
      valuePeriodStart: opt(fd, "valuePeriodStart") ?? null,
      valuePeriodEnd: opt(fd, "valuePeriodEnd") ?? null,
    });
    return "Value Basis saved";
  });
}

const KEY_DATE_DEFAULT_LABELS: Record<KeyDateKind, string> = {
  kickoff: "Kick-off",
  go_live: "Go-Live",
  six_month_review: "Six-month review",
  other: "",
};

export async function addKeyDateAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const kindRaw = required(fd, "kind");
    const kind = (KEY_DATE_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as KeyDateKind) : "other";
    await addKeyDate(actor, {
      projectId: projectOf(fd),
      kind,
      label: opt(fd, "label") ?? KEY_DATE_DEFAULT_LABELS[kind],
      date: required(fd, "date"),
      notes: opt(fd, "notes"),
    });
    return "Key date added";
  });
}

export async function removeKeyDateAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await removeKeyDate(actor, { projectId: projectOf(fd), keyDateId: required(fd, "keyDateId") });
    return "Key date removed";
  });
}

export async function addStakeholderAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const { person } = await addStakeholder(actor, {
      projectId: projectOf(fd),
      name: required(fd, "name"),
      title: opt(fd, "title"),
      organisation: opt(fd, "organisation"),
      email: opt(fd, "email"),
      roleDescription: opt(fd, "roleDescription"),
    });
    if (fd.get("makeVco") === "on") {
      await setValueCaseOwner(actor, { projectId: projectOf(fd), personId: person.id });
      return `${person.name} added as Value Case Owner`;
    }
    return `${person.name} added`;
  });
}

export async function updateStakeholderAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await updateStakeholder(actor, {
      projectId: projectOf(fd),
      personId: required(fd, "personId"),
      name: required(fd, "name"),
      title: clear(fd, "title"),
      organisation: clear(fd, "organisation"),
      email: clear(fd, "email"),
      roleDescription: clear(fd, "roleDescription"),
    });
    return "Stakeholder saved";
  });
}

export async function setVcoAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await setValueCaseOwner(actor, { projectId: projectOf(fd), personId: required(fd, "personId") });
    return "Value Case Owner nominated";
  });
}

export async function recordDocumentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const sizeRaw = opt(fd, "sizeBytes");
    await recordDocumentReference(actor, {
      projectId: projectOf(fd),
      title: required(fd, "title"),
      sourceDescription: required(fd, "sourceDescription"),
      sourcePersonId: opt(fd, "sourcePersonId"),
      uri: opt(fd, "uri"),
      originalFilename: opt(fd, "originalFilename"),
      sha256: opt(fd, "sha256")?.toLowerCase(),
      sizeBytes: sizeRaw === undefined ? undefined : Number(sizeRaw),
      receivedOn: opt(fd, "receivedOn"),
    });
    return "Document reference recorded";
  });
}
