import { execFileSync } from "node:child_process";

import { Client } from "pg";

import { runMigrations } from "../scripts/migrate";

import { request } from "@playwright/test";

import { E2E_AUTH_STATE, E2E_CONSULTANT, e2eDatabaseUrl } from "./env";

/**
 * Fresh database for every e2e run: create if missing, reset, migrate, then
 * seed Project Horizon and the synthetic Assurance Compact project through the public commands.
 * Refuses any database whose name does not end in `_e2e`.
 */
export default async function globalSetup(config: { projects: { use: { baseURL?: string } }[] }) {
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

  // Seeds are attributed to the e2e consultant, who then gets a password sign-in.
  const seedEnv = {
    ...process.env,
    DATABASE_URL: url,
    VO_DEV_USER_EMAIL: E2E_CONSULTANT.email,
    VO_DEV_USER_NAME: E2E_CONSULTANT.name,
  };
  for (const seed of ["db:seed:horizon", "db:seed:compact"]) {
    execFileSync("npm", ["run", "-s", seed], { env: seedEnv, stdio: "inherit" });
  }
  execFileSync(
    "npm",
    [
      "run",
      "-s",
      "user:create",
      "--",
      "--email",
      E2E_CONSULTANT.email,
      "--name",
      E2E_CONSULTANT.name,
      "--password-stdin",
    ],
    { env: seedEnv, input: E2E_CONSULTANT.password, stdio: ["pipe", "inherit", "inherit"] },
  );

  // Sign in once through the real form endpoint; journeys reuse the session cookie.
  const baseURL = config.projects[0]!.use.baseURL!;
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post("/api/auth/sign-in", {
    headers: { origin: baseURL },
    form: { email: E2E_CONSULTANT.email, password: E2E_CONSULTANT.password, next: "/projects" },
    maxRedirects: 0,
  });
  if (res.status() !== 303 || !(await ctx.storageState()).cookies.some((c) => c.name === "vo_session")) {
    throw new Error(`e2e sign-in failed (${res.status()})`);
  }
  await ctx.storageState({ path: E2E_AUTH_STATE });
  await ctx.dispose();
}
