import { eq } from "drizzle-orm";

import { seedCompactAuthorised, seedCompactDecided, seedCompactOperating } from "@/fixtures/compact";
import { ensureUser } from "@/server/commands/users";
import { closeDb, db, schema } from "@/server/db/client";

import { loadLocalEnv } from "./load-env";

// Seeds the synthetic "Assurance Compact", "Response Compact", "Matters Compact", "Evidence Compact", "Drivers Compact" and "Office Compact" projects (Authorised V1; Drivers Compact adds a decided review, Office Compact live Assurance work). Idempotent by code.
loadLocalEnv();

const email = process.env.VO_DEV_USER_EMAIL ?? "consultant@cardaxia.ai";
try {
  const actor = await ensureUser(email, process.env.VO_DEV_USER_NAME ?? email);
  // Identical synthetic engagements so the Phase 2, Phase 3, Phase 4D.1–4D.4 journeys stay independent.
  for (const [code, name] of [
    ["COMPACT", "Assurance Compact"],
    ["RESPONSE", "Response Compact"],
    ["MATTERS", "Matters Compact"],
    ["EVIDENCE", "Evidence Compact"],
    ["DRIVERS", "Drivers Compact"],
    ["OFFICE", "Office Compact"],
  ] as const) {
    const [existing] = await db().select().from(schema.project).where(eq(schema.project.code, code));
    if (existing) {
      console.log(`${name} already seeded; nothing to do.`);
    } else {
      if (code === "OFFICE") {
        await seedCompactOperating(actor, { code, name });
        console.log(`Seeded ${name}: Authorised V1, Review #1 finalised, live Continuous Assurance`);
      } else if (code === "DRIVERS") {
        await seedCompactDecided(actor, { code, name });
        console.log(`Seeded ${name}: Authorised V1, Review #1 finalised with a client decision`);
      } else {
        await seedCompactAuthorised(actor, { code, name });
        console.log(`Seeded ${name}: Authorised V1, no Assurance Reviews`);
      }
    }
  }
} finally {
  await closeDb();
}
