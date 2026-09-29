import "server-only";

import { sql } from "drizzle-orm";

import { disableUser, setPassword } from "@/server/commands/auth";
import { ensureUser } from "@/server/commands/users";
import { db, schema } from "@/server/db/client";

import { hashPassword, passwordPolicyProblem } from "./password";

// Operator account management (no public sign-up). Used by scripts/user.ts.
// Provisioning is attributed to the account being provisioned (bootstrap: there may be no
// other consultant yet); the command name (user.setPassword / user.disable) records what happened.

async function findUser(email: string) {
  const [row] = await db()
    .select({ id: schema.appUser.id, email: schema.appUser.email })
    .from(schema.appUser)
    .where(sql`lower(${schema.appUser.email}) = lower(${email})`);
  return row ?? null;
}

export async function createConsultant(email: string, displayName: string, password: string) {
  const problem = passwordPolicyProblem(password);
  if (problem) throw new Error(problem);
  const existing = await findUser(email);
  if (existing) {
    const [cred] = await db()
      .select({ id: schema.appCredential.id })
      .from(schema.appCredential)
      .where(sql`${schema.appCredential.userId} = ${existing.id}`);
    if (cred) throw new Error(`${email} already has a sign-in; use set-password to change it`);
  }
  const actor = existing ? { userId: existing.id } : await ensureUser(email, displayName);
  await setPassword(actor, { userId: actor.userId, passwordHash: await hashPassword(password) });
  return actor;
}

export async function resetConsultantPassword(email: string, password: string) {
  const user = await findUser(email);
  if (!user) throw new Error(`No consultant ${email}`);
  const actor = { userId: user.id };
  await setPassword(actor, { userId: user.id, passwordHash: await hashPassword(password) });
  return actor;
}

export async function disableConsultant(email: string) {
  const user = await findUser(email);
  if (!user) throw new Error(`No consultant ${email}`);
  await disableUser({ userId: user.id }, { userId: user.id });
}
