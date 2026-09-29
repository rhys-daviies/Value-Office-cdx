import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { pathToFileURL } from "node:url";

import { grantAppRole, withClient } from "../src/server/db/role";

import { loadLocalEnv } from "./load-env";

/** Apply all pending migrations in ./drizzle to the given database URL. */
export async function runMigrations(url: string): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
  }
}

// CLI: migrations run as the migration (owner) role — MIGRATION_DATABASE_URL, falling back
// to DATABASE_URL for local development. With VO_APP_DB_ROLE set, application-role grants
// are re-applied afterwards so new tables are covered.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  loadLocalEnv();
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL (or DATABASE_URL) is not set");
  const appRole = process.env.VO_APP_DB_ROLE;
  runMigrations(url)
    .then(async () => {
      console.log(`Migrations applied to ${new URL(url).pathname.slice(1)}`);
      if (appRole) {
        await withClient(url, (c) => grantAppRole(c, appRole));
        console.log(`Application role grants applied to ${appRole}`);
      }
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : "Migration failed");
      process.exit(1);
    });
}
