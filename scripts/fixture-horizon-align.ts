import { alignHorizonFixture } from "@/fixtures/horizon-cleanup";
import { ensureUser } from "@/server/commands/users";
import { closeDb } from "@/server/db/client";

import { loadLocalEnv } from "./load-env";

// Development only: aligns an existing Project Horizon fixture's VL-001 narrative with the
// current canonical seed. Explicit: requires --confirm. Refuses production.
loadLocalEnv();
if (!process.argv.includes("--confirm")) {
  console.error("This updates the Horizon development fixture's VL-001 narrative. Re-run with --confirm.");
  process.exit(1);
}
const email = process.env.VO_DEV_USER_EMAIL ?? "consultant@cardaxia.ai";
try {
  const actor = await ensureUser(email, process.env.VO_DEV_USER_NAME ?? email);
  const result = await alignHorizonFixture(actor, process.env.NODE_ENV);
  console.log(
    {
      updated: "Horizon fixture VL-001 narrative aligned with the canonical seed (audited as leakage.update).",
      "already-aligned": "Horizon fixture is already aligned; nothing to do.",
      "no-fixture": "No Horizon fixture project found; nothing to do.",
    }[result.status],
  );
} finally {
  await closeDb();
}
