import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/server/env";

// First line of defence, on every request:
//  1. Unauthenticated requests (no session cookie) never reach application routes: pages
//     redirect to /sign-in; everything else (server actions, PDFs) gets 401.
//     This is an optimistic check only — every page, action and route handler still
//     verifies the session against the database (src/server/auth/actor.ts).
//  2. A per-request nonce-based Content-Security-Policy for pages.

const PUBLIC = [/^\/sign-in$/, /^\/api\/auth\//, /^\/api\/health$/];

/** Optimistic: is there a session to verify? (Auth mode comes from the validated configuration.) */
export function mayBeAuthenticated(request: NextRequest, config = env()): boolean {
  if (config.VO_AUTH_MODE === "dev") return config.NODE_ENV !== "production";
  return request.cookies.has(config.NODE_ENV === "production" ? "__Host-vo_session" : "vo_session");
}

export function contentSecurityPolicy(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes and the report stylesheet are used by the report renderer.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!PUBLIC.some((p) => p.test(pathname)) && !mayBeAuthenticated(request)) {
    const isPage = request.method === "GET" && !pathname.startsWith("/api/") && !request.headers.has("next-action");
    if (!isPage) {
      return new NextResponse("Authentication required", {
        status: 401,
        headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
      });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
