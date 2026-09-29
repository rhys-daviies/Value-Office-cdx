import { eq } from "drizzle-orm";

import { seedCompactAuthorised } from "@/fixtures/compact";
import { ensureUser } from "@/server/commands/users";
import { closeDb, db, schema } from "@/server/db/client";

import { loadLocalEnv } from "./load-env";

// Seeds the synthetic "Assurance Compact" project (Authorised V1, no reviews). Idempotent by code.
loadLocalEnv();

const email = process.env.VO_DEV_USER_EMAIL ?? "consultant@cardaxia.ai";
try {
  const [existing] = await db().select().from(schema.project).where(eq(schema.project.code, "COMPACT"));
  if (existing) {
    console.log("Assurance Compact already seeded; nothing to do.");
  } else {
    await seedCompactAuthorised(await ensureUser(email, process.env.VO_DEV_USER_NAME ?? email));
    console.log("Seeded Assurance Compact: Authorised V1, no Assurance Reviews");
  }
} finally {
  await closeDb();
}
