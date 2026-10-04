"use server";

import { redirect } from "next/navigation";

import { createProject } from "@/server/commands/project";

import { FormInputError, opt, required } from "./form";
import { perform } from "./perform";
import type { ActionState } from "./state";

export async function createProjectAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let projectId: string | undefined;
  const state = await perform(null, async (actor) => {
    // 4D.10C: the consultant chooses explicitly; only the chosen field is used, so both can never be submitted.
    const mode = required(fd, "clientMode");
    const clientId = mode === "existing" ? opt(fd, "clientId") : undefined;
    const newClientName = mode === "new" ? opt(fd, "newClientName") : undefined;
    if (mode === "existing" && !clientId) throw new FormInputError("clientId", "Choose a client");
    if (mode === "new" && !newClientName) throw new FormInputError("newClientName", "Enter the new client's name");
    if (mode !== "existing" && mode !== "new")
      throw new FormInputError("clientMode", "Choose an existing or a new client");
    const { project } = await createProject(actor, {
      clientId,
      newClientName,
      code: opt(fd, "code")?.toUpperCase(),
      name: required(fd, "name"),
      context: opt(fd, "context"),
      currency: required(fd, "currency").toUpperCase(),
      valueBasisDescription: opt(fd, "valueBasisDescription"),
      valuePeriodStart: opt(fd, "valuePeriodStart"),
      valuePeriodEnd: opt(fd, "valuePeriodEnd"),
      kickoffDate: opt(fd, "kickoffDate"),
      goLiveDate: opt(fd, "goLiveDate"),
    });
    projectId = project.id;
  });
  if (state.status === "ok" && projectId) redirect(`/projects/${projectId}`);
  return state;
}
