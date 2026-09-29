import { revalidatePath } from "next/cache";

import { getCurrentActor, NotAuthenticatedError } from "@/server/auth/actor";
import type { Actor } from "@/server/commands/run";

import { toActionState } from "./errors";
import type { ActionState } from "./state";

/**
 * Runs a command-calling function as the current consultant, then refreshes the
 * project's pages. Errors become consultant-facing ActionState, never thrown.
 */
export async function perform(
  projectId: string | null,
  fn: (actor: Actor) => Promise<string | void>,
): Promise<ActionState> {
  try {
    const actor = await getCurrentActor();
    const message = await fn(actor);
    if (projectId) revalidatePath(`/projects/${projectId}`, "layout");
    revalidatePath("/projects");
    return { status: "ok", message: message || "Saved", nonce: Date.now() };
  } catch (err) {
    if (err instanceof NotAuthenticatedError) return { status: "error", message: err.message, nonce: Date.now() };
    return toActionState(err);
  }
}
