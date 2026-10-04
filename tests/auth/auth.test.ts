import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Password mode, with the Next.js request APIs stubbed: a cookie jar and redirect().
const h = vi.hoisted(() => {
  process.env.VO_AUTH_MODE = "password";
  delete process.env.VO_DEV_USER_EMAIL;
  return { jar: new Map<string, string>() };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (h.jar.has(name) ? { name, value: h.jar.get(name)! } : undefined),
    set: (name: string, value: string) => void h.jar.set(name, value),
    delete: (name: string) => void h.jar.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

import { POST as signInRoute } from "@/app/api/auth/sign-in/route";
import { POST as signOutRoute } from "@/app/api/auth/sign-out/route";
import { GET as healthRoute } from "@/app/api/health/route";
import { GET as pdfRoute } from "@/app/projects/[projectId]/reports/issued/[issueId]/pdf/route";
import { proxy } from "@/proxy";
import { createProjectAction } from "@/server/actions/projects";
import { issueReportAction } from "@/server/actions/reports";
import { IDLE } from "@/server/actions/state";
import { createConsultant, disableConsultant } from "@/server/auth/accounts";
import { getCurrentActor, NotAuthenticatedError, requireConsultant } from "@/server/auth/actor";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { endSession, hashSessionToken, resolveSession, signInWithPassword } from "@/server/auth/session";
import { createSession } from "@/server/commands/auth";
import { COMMANDS } from "@/server/commands/names";
import {
  createInformationRequest,
  addInformationRequestItem,
  issueInformationRequest,
} from "@/server/commands/information-request";
import { db, schema } from "@/server/db/client";
import { env } from "@/server/env";
import { issueReport } from "@/server/reports/issue";
import { requireProject } from "@/ui/require";

import { asCommand, expectDomainError, newActor, newProject, sql, uid } from "../support/fixtures";

const PASSWORD = "correct horse battery staple";
const COOKIE = "vo_session"; // non-production cookie name
const ORIGIN = "http://localhost:3000";

async function consultant() {
  const email = `auth-${uid()}@cardaxia.ai`;
  const actor = await createConsultant(email, "Auth Tester", PASSWORD);
  return { email, actor };
}

async function signedIn() {
  const c = await consultant();
  const session = (await signInWithPassword(c.email, PASSWORD))!;
  h.jar.set(COOKIE, session.token);
  return { ...c, session };
}

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

const post = (path: string, fields: Record<string, string>, origin: string | null = ORIGIN) =>
  new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: origin ? { origin } : {},
    body: new URLSearchParams(fields),
  });

beforeEach(() => h.jar.clear());
afterAll(() => h.jar.clear());

describe("password hashing", () => {
  it("stores scrypt hashes, verifies the right password and rejects others", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(hash).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword("correct horse battery stapler", hash)).toBe(false);
    expect(await verifyPassword(PASSWORD, "scrypt$bad")).toBe(false);
    expect(await hashPassword(PASSWORD)).not.toBe(hash); // salted
    await expect(hashPassword("short")).rejects.toThrow(/at least 12/);
  });
});

describe("sessions", () => {
  it("valid sign-in opens a session resolving to the consultant; the database holds only a keyed hash", async () => {
    expect(env().VO_AUTH_MODE).toBe("password");
    const { email, actor, session } = await signedIn();
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const resolved = await resolveSession(session.token);
    expect(resolved).toMatchObject({ userId: actor.userId, email });

    const [row] = await db().select().from(schema.appSession).where(eq(schema.appSession.userId, actor.userId));
    expect(row!.tokenHash).toBe(hashSessionToken(session.token));
    expect(row!.tokenHash).not.toContain(session.token);
    const ttlHours = (row!.expiresAt.getTime() - row!.createdAt.getTime()) / 3_600_000;
    expect(Math.round(ttlHours)).toBe(env().VO_SESSION_TTL_HOURS);

    // Audit rows never contain the password hash or token hash.
    const audit = await db()
      .select()
      .from(schema.auditEvent)
      .where(
        sql`${schema.auditEvent.tableName} in ('app_session', 'app_credential') and ${schema.auditEvent.actorUserId} = ${actor.userId}`,
      );
    expect(audit.map((a) => a.command).sort()).toEqual(["auth.signIn", "user.setPassword"]);
    const text = JSON.stringify(audit);
    expect(text).not.toMatch(/password_hash|token_hash|scrypt\$/);
  });

  it("rejects a wrong password, an unknown account and a disabled account — indistinguishably", async () => {
    const { email } = await consultant();
    expect(await signInWithPassword(email, "wrong password entirely")).toBeNull();
    expect(await signInWithPassword(`nobody-${uid()}@cardaxia.ai`, PASSWORD)).toBeNull();
    const ok = (await signInWithPassword(email.toUpperCase(), PASSWORD))!;
    expect(ok).not.toBeNull(); // email is case-insensitive
    await disableConsultant(email);
    expect(await signInWithPassword(email, PASSWORD)).toBeNull();
    expect(await resolveSession(ok.token)).toBeNull(); // disabling revokes open sessions
  });

  it("expires sessions and invalidates them on sign-out", async () => {
    const { session } = await signedIn();
    const later = new Date(session.expiresAt.getTime() + 1000);
    expect(await resolveSession(session.token, later)).toBeNull();
    expect(await resolveSession(session.token)).not.toBeNull();
    await endSession(session.token);
    expect(await resolveSession(session.token)).toBeNull();
    expect(await resolveSession("forged-token")).toBeNull();
    expect(await resolveSession(undefined)).toBeNull();
  });

  it("sessions and credentials change only through their commands, and are never deleted", async () => {
    const { actor, session } = await signedIn();
    await expectDomainError(
      asCommand(actor, COMMANDS.createProject, (tx) =>
        tx.insert(schema.appSession).values({
          userId: actor.userId,
          tokenHash: "a".repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
        }),
      ),
      "VO_WRONG_COMMAND",
    );
    const other = await newActor();
    await expectDomainError(
      createSession(other, { tokenHash: "b".repeat(64), expiresAt: new Date(Date.now() - 1000) }),
      "VO_INVALID_INPUT",
    );
    await expectDomainError(
      asCommand(actor, COMMANDS.signOut, (tx) =>
        tx.delete(schema.appSession).where(eq(schema.appSession.tokenHash, hashSessionToken(session.token))),
      ),
      "VO_SESSION_IMMUTABLE",
    );
    await expectDomainError(
      asCommand(actor, COMMANDS.createProject, (tx) =>
        tx.update(schema.appCredential).set({ disabledAt: null }).where(eq(schema.appCredential.userId, actor.userId)),
      ),
      "VO_WRONG_COMMAND",
    );
    // Another consultant cannot sign out someone else's session.
    await expectDomainError(
      asCommand(other, COMMANDS.signOut, (tx) =>
        tx
          .update(schema.appSession)
          .set({ revokedAt: new Date() })
          .where(eq(schema.appSession.tokenHash, hashSessionToken(session.token))),
      ),
      "VO_ACTOR_MISMATCH",
    );
  });
});

describe("the authenticated consultant is the actor", () => {
  it("resolves from the session cookie; no cookie means not authenticated", async () => {
    await expect(getCurrentActor()).rejects.toBeInstanceOf(NotAuthenticatedError);
    await expect(requireConsultant()).rejects.toMatchObject({ url: "/sign-in" });
    const { actor, email } = await signedIn();
    expect(await getCurrentActor()).toMatchObject({ userId: actor.userId, email });
  });

  it("server mutations are refused without a session, and audited to the signed-in consultant with one", async () => {
    const name = `Auth Project ${uid()}`;
    const fields = { clientMode: "new", clientId: "", newClientName: "Auth Client", name, currency: "USD" };
    const refused = await createProjectAction(IDLE, form(fields));
    expect(refused).toMatchObject({ status: "error", message: "Sign in to continue" });
    expect(await db().select().from(schema.project).where(eq(schema.project.name, name))).toHaveLength(0);

    const { actor } = await signedIn();
    const done = await createProjectAction(IDLE, form(fields)).catch((e: { url?: string }) => e);
    expect((done as { url?: string }).url).toMatch(/^\/projects\//);
    const [project] = await db().select().from(schema.project).where(eq(schema.project.name, name));
    const [audit] = await db()
      .select()
      .from(schema.auditEvent)
      .where(and(eq(schema.auditEvent.tableName, "project"), eq(schema.auditEvent.rowId, project!.id)));
    expect(audit).toMatchObject({ actorUserId: actor.userId, command: "project.create" });
  });

  it("report previews and issued PDFs require authentication", async () => {
    const owner = await newActor();
    const { project } = await newProject(owner);
    const ir = await createInformationRequest(owner, { projectId: project.id, reference: "IR-A", title: "Data" });
    await addInformationRequestItem(owner, { informationRequestId: ir.id, description: "Item" });
    await issueInformationRequest(owner, {
      informationRequestId: ir.id,
      issuedOn: new Date().toISOString().slice(0, 10),
    });
    const issue = await issueReport(owner, { type: "information_request", projectId: project.id, subjectId: ir.id });
    const ctx = { params: Promise.resolve({ projectId: project.id, issueId: issue.id }) };
    const url = `${ORIGIN}/projects/${project.id}/reports/issued/${issue.id}/pdf`;

    // Unauthenticated: preview (via requireProject) redirects; PDF is 401; issuing is refused.
    await expect(requireProject(project.id)).rejects.toMatchObject({ url: "/sign-in" });
    const denied = await pdfRoute(new Request(url), ctx as never);
    expect(denied.status).toBe(401);
    expect(await denied.text()).not.toContain("%PDF");
    const refused = await issueReportAction(
      IDLE,
      form({ projectId: project.id, type: "information_request", subjectId: ir.id, confirm: "on" }),
    );
    expect(refused.status).toBe("error");

    await signedIn();
    const ok = await pdfRoute(new Request(url), ctx as never);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/pdf");
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    const bytes = Buffer.from(await ok.arrayBuffer());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(ok.headers.get("x-content-sha256")).toBe(issue.documentSha256);
  }, 60_000);
});

describe("sign-in and sign-out routes", () => {
  it("signs in with a same-origin form post, refuses cross-origin posts and leaks nothing on failure", async () => {
    const { email } = await consultant();
    expect(
      (await signInRoute(post("/api/auth/sign-in", { email, password: PASSWORD }, "https://evil.example"))).status,
    ).toBe(403);
    expect((await signInRoute(post("/api/auth/sign-in", { email, password: PASSWORD }, null))).status).toBe(403);

    const bad = await signInRoute(post("/api/auth/sign-in", { email, password: "not the password!" }));
    expect(bad.status).toBe(303);
    expect(bad.headers.get("location")).toBe(`${ORIGIN}/sign-in?error=1&next=%2Fprojects`);
    expect(bad.headers.get("location")).not.toContain(email);
    expect(h.jar.size).toBe(0);

    const good = await signInRoute(post("/api/auth/sign-in", { email, password: PASSWORD, next: "/projects/abc" }));
    expect(good.headers.get("location")).toBe(`${ORIGIN}/projects/abc`);
    const token = h.jar.get(COOKIE)!;
    expect(await resolveSession(token)).toMatchObject({ email });

    // Open redirects are refused.
    const evil = await signInRoute(post("/api/auth/sign-in", { email, password: PASSWORD, next: "//evil.example" }));
    expect(evil.headers.get("location")).toBe(`${ORIGIN}/projects`);

    const latest = h.jar.get(COOKIE)!;
    const out = await signOutRoute(post("/api/auth/sign-out", {}));
    expect(out.headers.get("location")).toBe(`${ORIGIN}/sign-in?signedOut=1`);
    expect(h.jar.get(COOKIE)).toBe(""); // expired with matching attributes
    expect(await resolveSession(latest)).toBeNull();
    expect(await resolveSession(token)).not.toBeNull(); // other sessions are unaffected by this sign-out
  });
});

describe("proxy", () => {
  const req = (path: string, init: { method?: string; cookie?: string; headers?: Record<string, string> } = {}) =>
    new NextRequest(`${ORIGIN}${path}`, {
      method: init.method ?? "GET",
      headers: { ...(init.cookie ? { cookie: `${COOKIE}=${init.cookie}` } : {}), ...init.headers },
    });

  it("redirects unauthenticated pages to sign-in and refuses unauthenticated actions and files", () => {
    const page = proxy(req("/projects/123/reports"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe(`${ORIGIN}/sign-in?next=%2Fprojects%2F123%2Freports`);
    expect(proxy(req("/projects", { method: "POST", headers: { "next-action": "abc" } })).status).toBe(401);
    expect(proxy(req("/projects/1/reports/issued/2/pdf", { method: "POST" })).status).toBe(401);
    // Public routes pass.
    expect(proxy(req("/sign-in")).status).toBe(200);
    expect(proxy(req("/api/health")).status).toBe(200);
  });

  it("sets a per-request nonce CSP that forbids framing and inline scripts", () => {
    const a = proxy(req("/projects", { cookie: "x" }));
    const b = proxy(req("/projects", { cookie: "x" }));
    const csp = a.headers.get("content-security-policy")!;
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toBe(b.headers.get("content-security-policy"));
  });
});

describe("health", () => {
  it("reports only status and database reachability", async () => {
    const res = await healthRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok", database: "ok" });
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/postgres|value_office|5433|version|password/i);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
