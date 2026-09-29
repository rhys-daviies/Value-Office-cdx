import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import { and, eq, gt, isNull, sql } from "drizzle-orm";

import { createSession, revokeSession } from "@/server/commands/auth";
import { db, schema } from "@/server/db/client";
import { env } from "@/server/env";

import { dummyPasswordHash, verifyPassword } from "./password";

// Opaque server-side sessions. The cookie holds 32 random bytes; the database stores only
// HMAC-SHA256(VO_SESSION_SECRET, token), so neither a database read nor an audit row can be
// replayed as a cookie. Sessions expire (VO_SESSION_TTL_HOURS) and are revoked on sign-out.

export type SessionConsultant = { userId: string; email: string; displayName: string; expiresAt: Date };

export function sessionCookieName(): string {
  // __Host- binds the cookie to this origin over HTTPS (Secure, Path=/, no Domain).
  return env().NODE_ENV === "production" ? "__Host-vo_session" : "vo_session";
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env().NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}

export function hashSessionToken(token: string): string {
  const secret = env().VO_SESSION_SECRET;
  if (!secret) throw new Error("VO_SESSION_SECRET is not configured");
  return createHmac("sha256", secret).update(token, "utf8").digest("hex");
}

/**
 * Verify email + password and open a session. Returns null for any failure — unknown
 * account, wrong password or disabled account — without saying which, in similar time.
 */
export async function signInWithPassword(
  email: string,
  password: string,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date; userId: string } | null> {
  const [row] = await db()
    .select({
      userId: schema.appUser.id,
      passwordHash: schema.appCredential.passwordHash,
      disabledAt: schema.appCredential.disabledAt,
    })
    .from(schema.appUser)
    .innerJoin(schema.appCredential, eq(schema.appCredential.userId, schema.appUser.id))
    .where(sql`lower(${schema.appUser.email}) = lower(${email.trim()})`);

  const ok = await verifyPassword(password, row?.passwordHash ?? (await dummyPasswordHash()));
  if (!row || !ok || row.disabledAt) return null;

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + env().VO_SESSION_TTL_HOURS * 3_600_000);
  await createSession({ userId: row.userId }, { tokenHash: hashSessionToken(token), expiresAt });
  return { token, expiresAt, userId: row.userId };
}

/** The consultant for a session token, if the session is live and the account enabled. */
export async function resolveSession(token: string | undefined, now = new Date()): Promise<SessionConsultant | null> {
  if (!token || token.length > 128) return null;
  const [row] = await db()
    .select({
      userId: schema.appUser.id,
      email: schema.appUser.email,
      displayName: schema.appUser.displayName,
      expiresAt: schema.appSession.expiresAt,
    })
    .from(schema.appSession)
    .innerJoin(schema.appUser, eq(schema.appUser.id, schema.appSession.userId))
    .innerJoin(schema.appCredential, eq(schema.appCredential.userId, schema.appUser.id))
    .where(
      and(
        eq(schema.appSession.tokenHash, hashSessionToken(token)),
        isNull(schema.appSession.revokedAt),
        gt(schema.appSession.expiresAt, now),
        isNull(schema.appCredential.disabledAt),
      ),
    );
  return row ?? null;
}

export async function endSession(token: string | undefined): Promise<void> {
  const consultant = await resolveSession(token);
  if (!consultant || !token) return;
  await revokeSession({ userId: consultant.userId }, { tokenHash: hashSessionToken(token) });
}
