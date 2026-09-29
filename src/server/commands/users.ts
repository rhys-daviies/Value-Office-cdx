import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { db, schema } from "@/server/db/client";

import { COMMANDS } from "./names";
import { runCommand, type Actor } from "./run";

/**
 * Returns the consultant for `email`, creating the app_user on first sight.
 * The creating command is attributed to the new user itself (bootstrap case).
 */
export async function ensureUser(email: string, displayName: string): Promise<Actor> {
  const find = async () => {
    const [row] = await db()
      .select({ id: schema.appUser.id })
      .from(schema.appUser)
      .where(sql`lower(${schema.appUser.email}) = lower(${email})`);
    return row;
  };

  const existing = await find();
  if (existing) return { userId: existing.id };

  const id = randomUUID();
  await runCommand(COMMANDS.ensureUser, { userId: id }, async ({ tx }) => {
    await tx.insert(schema.appUser).values({ id, email, displayName }).onConflictDoNothing();
  });
  const created = await find();
  if (!created) throw new Error(`Failed to create user ${email}`);
  return { userId: created.id };
}
