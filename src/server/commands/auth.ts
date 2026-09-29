import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { DomainError } from "@/domain/errors";
import { schema } from "@/server/db/client";

import { COMMANDS } from "./names";
import { defineCommand } from "./run";
import { uuid } from "./schemas";

// Sign-in commands. Secrets never reach these inputs in clear: passwords arrive already
// hashed, session tokens as their keyed hash. Audit rows redact both (drizzle/0010).

const passwordHash = z.string().regex(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
const tokenHash = z.string().regex(/^[0-9a-f]{64}$/);

/** Set (or replace) a consultant's password. */
export const setPassword = defineCommand(
  COMMANDS.setPassword,
  z.object({ userId: uuid, passwordHash }),
  async ({ tx }, input) => {
    const [row] = await tx
      .insert(schema.appCredential)
      .values({ userId: input.userId, passwordHash: input.passwordHash })
      .onConflictDoUpdate({
        target: schema.appCredential.userId,
        set: { passwordHash: input.passwordHash, passwordSetAt: new Date() },
      })
      .returning({ id: schema.appCredential.id });
    return row!;
  },
);

/** Disable a consultant's sign-in and revoke their open sessions. */
export const disableUser = defineCommand(COMMANDS.disableUser, z.object({ userId: uuid }), async ({ tx }, input) => {
  const [row] = await tx
    .update(schema.appCredential)
    .set({ disabledAt: new Date() })
    .where(and(eq(schema.appCredential.userId, input.userId), isNull(schema.appCredential.disabledAt)))
    .returning({ id: schema.appCredential.id });
  if (!row) throw new DomainError("VO_NOT_FOUND", "No active credential for that consultant");
  await tx
    .update(schema.appSession)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.appSession.userId, input.userId), isNull(schema.appSession.revokedAt)));
  return row;
});

/** Record a new session for the acting consultant (the actor is the user signing in). */
export const createSession = defineCommand(
  COMMANDS.signIn,
  z.object({ tokenHash, expiresAt: z.date() }),
  async ({ tx, actor }, input) => {
    const [row] = await tx
      .insert(schema.appSession)
      .values({ userId: actor.userId, tokenHash: input.tokenHash, expiresAt: input.expiresAt })
      .returning({ id: schema.appSession.id, expiresAt: schema.appSession.expiresAt });
    return row!;
  },
);

/** Revoke the acting consultant's session. */
export const revokeSession = defineCommand(COMMANDS.signOut, z.object({ tokenHash }), async ({ tx, actor }, input) => {
  await tx
    .update(schema.appSession)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.appSession.tokenHash, input.tokenHash),
        eq(schema.appSession.userId, actor.userId),
        isNull(schema.appSession.revokedAt),
      ),
    );
});
