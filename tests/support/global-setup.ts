import { Client } from "pg";

import { runMigrations } from "../../scripts/migrate";

/**
 * Resets the test database and applies all migrations once per run.
 * Refuses to touch any database whose name does not end in `_test`.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to reset "${name}": test database names must end in _test`);
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  } finally {
    await client.end();
  }
  await runMigrations(url);
}
