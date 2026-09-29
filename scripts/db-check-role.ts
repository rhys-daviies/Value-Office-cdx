import { checkApplicationRole, withClient } from "../src/server/db/role";

import { loadLocalEnv } from "./load-env";

// Verifies that DATABASE_URL connects as a safe, least-privilege application role.
loadLocalEnv();
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const result = await withClient(url, checkApplicationRole);
if (result.problems.length) {
  console.error(`✗ ${result.role}: ${result.problems.join("; ")}`);
  process.exit(1);
}
console.log(`✓ ${result.role} is a least-privilege application role`);
