import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { pathToFileURL } from "node:url";

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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  loadLocalEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  runMigrations(url)
    .then(() => console.log(`Migrations applied to ${new URL(url).pathname.slice(1)}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
