import { ensureUser } from "@/server/commands/users";
import type { Actor } from "@/server/commands/run";
import { env } from "@/server/env";

// Authentication seam. Everything else asks for the current Actor and never
// knows how it was established, so Auth.js / Entra / Google can replace the
// dev mechanism here without touching commands or the domain model.
//
// Development mode: the actor is the consultant named by VO_DEV_USER_EMAIL.
// Production: refused until a real identity provider is configured.

export class NotAuthenticatedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotAuthenticatedError";
  }
}

export async function getCurrentActor(): Promise<Actor & { email: string }> {
  const e = env();
  if (e.NODE_ENV === "production") {
    throw new NotAuthenticatedError("No production identity provider is configured yet");
  }
  if (!e.VO_DEV_USER_EMAIL) {
    throw new NotAuthenticatedError("Set VO_DEV_USER_EMAIL in .env.local to use development authentication");
  }
  const actor = await ensureUser(e.VO_DEV_USER_EMAIL, e.VO_DEV_USER_NAME ?? e.VO_DEV_USER_EMAIL);
  return { ...actor, email: e.VO_DEV_USER_EMAIL };
}
