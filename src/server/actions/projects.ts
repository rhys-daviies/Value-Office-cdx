"use server";

import { redirect } from "next/navigation";

import { createProject } from "@/server/commands/project";

import { opt, required } from "./form";
import { perform } from "./perform";
import type { ActionState } from "./state";

export async function createProjectAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let projectId: string | undefined;
  const state = await perform(null, async (actor) => {
    const clientChoice = opt(fd, "clientId");
    const { project } = await createProject(actor, {
      clientId: clientChoice && clientChoice !== "new" ? clientChoice : undefined,
      newClientName: clientChoice && clientChoice !== "new" ? undefined : opt(fd, "newClientName"),
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
