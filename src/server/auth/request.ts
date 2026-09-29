import "server-only";

import { env } from "@/server/env";

// Request-origin checks for the auth route handlers (server actions get Next.js's own
// Origin/Host check). A cross-site form post is refused even before SameSite applies.

export function allowedOrigins(requestUrl: string): string[] {
  const configured = env().VO_APP_ORIGIN;
  return configured ? [new URL(configured).origin] : [new URL(requestUrl).origin];
}

export function isSameOriginPost(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && allowedOrigins(request.url).includes(origin);
}

/** Only same-site relative paths; anything else becomes /projects. */
export function safeNextPath(value: FormDataEntryValue | string | null | undefined): string {
  const v = typeof value === "string" ? value : "";
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") && !v.startsWith("/api/") ? v : "/projects";
}

export function redirectTo(request: Request, path: string, init: ResponseInit = {}): Response {
  const base = allowedOrigins(request.url)[0]!;
  const headers = new Headers(init.headers);
  headers.set("location", new URL(path, base).toString());
  headers.set("cache-control", "no-store");
  return new Response(null, { ...init, status: 303, headers });
}
