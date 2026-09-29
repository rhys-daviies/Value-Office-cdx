import { cookies } from "next/headers";

import { isSameOriginPost, redirectTo, safeNextPath } from "@/server/auth/request";
import { sessionCookieName, sessionCookieOptions, signInWithPassword } from "@/server/auth/session";
import { env } from "@/server/env";

export const dynamic = "force-dynamic";

/** Email + password form post → session cookie. Failures are deliberately indistinguishable. */
export async function POST(request: Request) {
  if (!isSameOriginPost(request)) return new Response("Forbidden", { status: 403 });
  if (env().VO_AUTH_MODE !== "password") return redirectTo(request, "/projects");

  const form = await request.formData().catch(() => null);
  const email = form?.get("email");
  const password = form?.get("password");
  const next = safeNextPath(form?.get("next"));
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return redirectTo(request, `/sign-in?error=1&next=${encodeURIComponent(next)}`);
  }

  const session = await signInWithPassword(email, password);
  if (!session) return redirectTo(request, `/sign-in?error=1&next=${encodeURIComponent(next)}`);

  (await cookies()).set(sessionCookieName(), session.token, sessionCookieOptions(session.expiresAt));
  return redirectTo(request, next);
}
