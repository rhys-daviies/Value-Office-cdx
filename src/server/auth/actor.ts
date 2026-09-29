import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ensureUser } from "@/server/commands/users";
import type { Actor } from "@/server/commands/run";
import { env } from "@/server/env";

import { resolveSession, sessionCookieName } from "./session";

// Authentication seam. Everything else asks for the current Actor and never knows how it
// was established, so SSO can replace password sessions here without touching commands.
//
// password (default; the only mode allowed in production): the signed-in session cookie.
// dev (explicit local convenience, refused in production by env validation): the consultant
// named by VO_DEV_USER_EMAIL.

export class NotAuthenticatedError extends Error {
  constructor(message = "Sign in to continue") {
    super(message);
    this.name = "NotAuthenticatedError";
  }
}

export type CurrentActor = Actor & { email: string; displayName: string };

export async function getCurrentActor(): Promise<CurrentActor> {
  const e = env();
  if (e.VO_AUTH_MODE === "dev") {
    if (e.NODE_ENV === "production") throw new NotAuthenticatedError("Development identity is disabled in production");
    const email = e.VO_DEV_USER_EMAIL!;
    const displayName = e.VO_DEV_USER_NAME ?? email;
    return { ...(await ensureUser(email, displayName)), email, displayName };
  }
  const token = (await cookies()).get(sessionCookieName())?.value;
  const consultant = await resolveSession(token);
  if (!consultant) throw new NotAuthenticatedError();
  return { userId: consultant.userId, email: consultant.email, displayName: consultant.displayName };
}

/** For pages and layouts: the signed-in consultant, or a redirect to sign-in. */
export async function requireConsultant(): Promise<CurrentActor> {
  try {
    return await getCurrentActor();
  } catch (err) {
    if (err instanceof NotAuthenticatedError) redirect("/sign-in");
    throw err;
  }
}

/** For route handlers: the signed-in consultant, or null (caller responds 401). */
export async function currentConsultantOrNull(): Promise<CurrentActor | null> {
  try {
    return await getCurrentActor();
  } catch (err) {
    if (err instanceof NotAuthenticatedError) return null;
    throw err;
  }
}
