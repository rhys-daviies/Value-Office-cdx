import { execFileSync } from "node:child_process";

import { Client } from "pg";

import { runMigrations } from "../scripts/migrate";

import { e2eDatabaseUrl } from "./env";

/**
 * Fresh database for every e2e run: create if missing, reset, migrate, then
 * seed Project Horizon through the public commands (the seed script).
 * Refuses any database whose name does not end in `_e2e`.
 */
export default async function globalSetup() {
  const url = e2eDatabaseUrl();
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith("_e2e")) throw new Error(`Refusing to reset "${name}": e2e database names must end in _e2e`);

  const admin = new URL(url);
  admin.pathname = "/postgres";
  const adminClient = new Client({ connectionString: admin.toString() });
  await adminClient.connect();
  try {
    const exists = await adminClient.query("select 1 from pg_database where datname = $1", [name]);
    if (exists.rowCount === 0) await adminClient.query(`create database "${name}"`);
  } finally {
    await adminClient.end();
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  } finally {
    await client.end();
  }
  await runMigrations(url);

  execFileSync("npm", ["run", "-s", "db:seed:horizon"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
}
