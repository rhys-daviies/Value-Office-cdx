import { cookies } from "next/headers";

import { isSameOriginPost, redirectTo } from "@/server/auth/request";
import { endSession, sessionCookieName, sessionCookieOptions } from "@/server/auth/session";

export const dynamic = "force-dynamic";

/** Revokes the session server-side (the token stops working everywhere) and clears the cookie. */
export async function POST(request: Request) {
  if (!isSameOriginPost(request)) return new Response("Forbidden", { status: 403 });
  const jar = await cookies();
  await endSession(jar.get(sessionCookieName())?.value);
  // Expire with the same attributes it was set with: a __Host- cookie is only replaced by a Secure one.
  jar.set(sessionCookieName(), "", { ...sessionCookieOptions(new Date(0)), maxAge: 0 });
  return redirectTo(request, "/sign-in?signedOut=1");
}
