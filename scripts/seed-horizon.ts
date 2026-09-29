import { eq } from "drizzle-orm";

import { toMillions } from "@/domain/money";
import { seedHorizon } from "@/fixtures/horizon";
import { ensureUser } from "@/server/commands/users";
import { closeDb, db, schema } from "@/server/db/client";
import { getVersionTotal } from "@/server/queries/value-case";

import { loadLocalEnv } from "./load-env";

// Seeds Project Horizon (through Authorised V1) into DATABASE_URL. Idempotent by project code.
loadLocalEnv();

const email = process.env.VO_DEV_USER_EMAIL ?? "consultant@cardaxia.ai";
try {
  const [existing] = await db().select().from(schema.project).where(eq(schema.project.code, "HORIZON"));
  if (existing) {
    console.log("Project Horizon already seeded; nothing to do.");
  } else {
    const actor = await ensureUser(email, process.env.VO_DEV_USER_NAME ?? email);
    const { v1 } = await seedHorizon(actor);
    const { total } = await getVersionTotal(v1.id);
    console.log(`Seeded Project Horizon: V${v1.versionNumber} ${v1.status}, total ${toMillions(total)}m`);
  }
} finally {
  await closeDb();
}
