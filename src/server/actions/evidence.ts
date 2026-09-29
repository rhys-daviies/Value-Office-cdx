"use server";

import { recordEvidence, updateEvidence } from "@/server/commands/evidence";
import { linkEvidence, unlinkEvidence } from "@/server/commands/value-case";

import { bool, clear, opt, required } from "./form";
import { perform } from "./perform";
import type { ActionState } from "./state";

const projectOf = (fd: FormData) => required(fd, "projectId");

export async function recordEvidenceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const e = await recordEvidence(actor, {
      projectId: projectOf(fd),
      code: required(fd, "code").toUpperCase(),
      title: required(fd, "title"),
      summary: opt(fd, "summary"),
      documentId: opt(fd, "documentId"),
      sourcePersonId: opt(fd, "sourcePersonId"),
      evidenceDate: opt(fd, "evidenceDate"),
      receivedOn: opt(fd, "receivedOn"),
      supersedesEvidenceId: opt(fd, "supersedesEvidenceId"),
      isMaterialChange: bool(fd, "isMaterialChange"),
      materialChangeNote: opt(fd, "materialChangeNote"),
    });
    return `Evidence ${e.code} recorded`;
  });
}

export async function updateEvidenceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await updateEvidence(actor, {
      evidenceId: required(fd, "evidenceId"),
      title: required(fd, "title"),
      summary: clear(fd, "summary"),
      documentId: clear(fd, "documentId"),
      sourcePersonId: clear(fd, "sourcePersonId"),
      evidenceDate: clear(fd, "evidenceDate"),
      receivedOn: clear(fd, "receivedOn"),
      supersedesEvidenceId: clear(fd, "supersedesEvidenceId"),
      isMaterialChange: bool(fd, "isMaterialChange"),
      materialChangeNote: clear(fd, "materialChangeNote"),
    });
    return "Evidence saved";
  });
}

/** Target is "driver:<driverVersionId>" or "assumption:<assumptionId>". */
export async function linkEvidenceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const [kind, id] = required(fd, "target").split(":");
    await linkEvidence(actor, {
      evidenceId: required(fd, "evidenceId"),
      driverVersionId: kind === "driver" ? id : undefined,
      assumptionId: kind === "assumption" ? id : undefined,
      relevanceNote: opt(fd, "relevanceNote"),
    });
    return "Evidence linked";
  });
}

export async function unlinkEvidenceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await unlinkEvidence(actor, { evidenceLinkId: required(fd, "evidenceLinkId") });
    return "Evidence unlinked";
  });
}
