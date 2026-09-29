import { eq } from "drizzle-orm";

import { seedCompactAuthorised } from "@/fixtures/compact";
import { ensureUser } from "@/server/commands/users";
import { closeDb, db, schema } from "@/server/db/client";

import { loadLocalEnv } from "./load-env";

// Seeds the synthetic "Assurance Compact" and "Response Compact" projects (Authorised V1, no reviews). Idempotent by code.
loadLocalEnv();

const email = process.env.VO_DEV_USER_EMAIL ?? "consultant@cardaxia.ai";
try {
  const actor = await ensureUser(email, process.env.VO_DEV_USER_NAME ?? email);
  // Two identical synthetic engagements so Phase 2 and Phase 3 journeys stay independent.
  for (const [code, name] of [
    ["COMPACT", "Assurance Compact"],
    ["RESPONSE", "Response Compact"],
  ] as const) {
    const [existing] = await db().select().from(schema.project).where(eq(schema.project.code, code));
    if (existing) {
      console.log(`${name} already seeded; nothing to do.`);
    } else {
      await seedCompactAuthorised(actor, { code, name });
      console.log(`Seeded ${name}: Authorised V1, no Assurance Reviews`);
    }
  }
} finally {
  await closeDb();
}
