import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { register } from "@/instrumentation";
import { resetEnvCache } from "@/server/env";

import { seedCompactAuthorised } from "@/fixtures/compact";
import { checkApplicationRole, grantAppRole, withClient } from "@/server/db/role";

import { newActor } from "../support/fixtures";

// The production role model, exercised on the test database: a non-owner application role
// receives the standard grants, can run Value Office operations, and cannot bypass integrity.

const ownerUrl = process.env.DATABASE_URL!;
const ROLE = "vo_app_role_test";
const PASSWORD = `pw-${randomUUID()}`;
let app: Client;

beforeAll(async () => {
  await withClient(ownerUrl, async (c) => {
    const { rowCount } = await c.query("select 1 from pg_roles where rolname = $1", [ROLE]);
    if (!rowCount) await c.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${PASSWORD}'`);
    else await c.query(`ALTER ROLE ${ROLE} LOGIN PASSWORD '${PASSWORD}'`);
    await grantAppRole(c, ROLE);
  });
  const url = new URL(ownerUrl);
  url.username = ROLE;
  url.password = PASSWORD;
  app = new Client({ connectionString: url.toString() });
  await app.connect();
});
afterAll(() => app?.end());

const refused = (sql: string) =>
  app.query(sql).then(
    () => "allowed",
    (e: Error) => e.message,
  );

describe("least-privilege application role", () => {
  it("is recognised as safe, and the owner role as unsafe", async () => {
    expect(await checkApplicationRole(app)).toEqual({ role: ROLE, problems: [] });
    const owner = await withClient(ownerUrl, checkApplicationRole);
    expect(owner.problems.join("; ")).toMatch(/superuser|owns Value Office tables/);
  });

  it("performs normal command-context writes, audited through the SECURITY DEFINER trigger", async () => {
    const actor = await newActor();
    await app.query("BEGIN");
    await app.query("select set_config('vo.actor_id', $1, true), set_config('vo.command', 'client.create', true)", [
      actor.userId,
    ]);
    const { rows } = await app.query<{ id: string }>(
      "insert into client (name) values ('Role test client') returning id",
    );
    await app.query("COMMIT");
    const audit = await app.query("select actor_user_id, command from audit_event where row_id = $1", [rows[0]!.id]);
    expect(audit.rows).toEqual([{ actor_user_id: actor.userId, command: "client.create" }]);
  });

  it("works Continuous Assurance matters (Phase 4D.1) under the same guards", async () => {
    const actor = await newActor();
    const { project } = await seedCompactAuthorised(actor, {
      code: `R-${randomUUID().slice(0, 6)}`,
      name: "Role matter",
    });
    const run = async (command: string, statement: string, params: unknown[]) => {
      await app.query("BEGIN");
      await app.query("select set_config('vo.actor_id', $1, true), set_config('vo.command', $2, true)", [
        actor.userId,
        command,
      ]);
      try {
        const res = await app.query(statement, params);
        await app.query("COMMIT");
        return res;
      } catch (err) {
        await app.query("ROLLBACK");
        throw err;
      }
    };
    const { rows } = await run(
      "matter.create",
      `insert into value_leakage (project_id, value_case_id, code, title, identified_on, stage, created_by)
       select p.id, c.id, 'VL-R1', 'Role matter', current_date, 'identified', $2 from project p join value_case c on c.project_id = p.id where p.id = $1
       returning id`,
      [project.id, actor.userId],
    );
    const id = rows[0]!.id as string;
    await run(
      "matter.assessWorking",
      "update value_leakage set working_total_amount = 10, working_unrecoverable_amount = 0 where id = $1",
      [id],
    );
    const [row] = (await app.query("select working_assessed_by from value_leakage where id = $1", [id])).rows;
    expect(row.working_assessed_by).toBe(actor.userId);
    await expect(
      run("leakage.update", "update value_leakage set stage = 'assessing' where id = $1", [id]),
    ).rejects.toThrow(/VO_WRONG_COMMAND/);
  });

  it("cannot bypass the integrity model", async () => {
    expect(await refused("ALTER TABLE report_issue DISABLE TRIGGER vo_report_issue_guard")).toMatch(/must be owner/);
    expect(await refused("DROP TRIGGER vo_audit ON project")).toMatch(/must be owner/);
    expect(await refused("SET session_replication_role = replica")).toMatch(/permission denied/);
    expect(
      await refused(
        "insert into audit_event (transaction_id, actor_user_id, command, table_name, row_id, action) values (1, gen_random_uuid(), 'x', 'x', gen_random_uuid(), 'INSERT')",
      ),
    ).toMatch(/permission denied/);
    expect(await refused("update report_issue set title = 'x'")).toMatch(/permission denied/);
    expect(await refused("delete from report_issue")).toMatch(/permission denied/);
    expect(await refused("truncate project")).toMatch(/permission denied/);
    expect(await refused("create table sneaky (id int)")).toMatch(/permission denied/);
    expect(
      await refused("CREATE OR REPLACE FUNCTION vo_command() RETURNS text LANGUAGE sql AS $$ select 'x' $$"),
    ).toMatch(/must be owner|permission denied/);
    // Without command context every mutation is still rejected.
    expect(await refused("insert into client (name) values ('no context')")).toMatch(/VO_NO_COMMAND_CONTEXT/);
  });
});

describe("production tier startup", () => {
  it("accepts the intended restricted application role", async () => {
    const url = new URL(ownerUrl);
    url.username = ROLE;
    url.password = PASSWORD;
    const saved = { ...process.env };
    process.env = {
      ...saved,
      NEXT_RUNTIME: "nodejs",
      NODE_ENV: "production",
      VO_DEPLOYMENT_MODE: "production",
      DATABASE_URL: url.toString(),
      VO_SESSION_SECRET: "s".repeat(40),
      VO_APP_ORIGIN: "https://value-office.example.com",
      VO_REPORT_STORAGE: "s3",
      VO_S3_BUCKET: "b",
      VO_S3_REGION: "r",
      VO_S3_ACCESS_KEY_ID: "k",
      VO_S3_SECRET_ACCESS_KEY: "s",
      VO_PDF_RUNTIME: "serverless",
    };
    delete process.env.VO_DEV_USER_EMAIL;
    delete process.env.VO_AUTH_MODE;
    resetEnvCache();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(register()).resolves.toBeUndefined();
      expect(log.mock.calls.at(-1)![0]).toMatch(/deployment=production .*db-role=least-privilege/);
    } finally {
      log.mockRestore();
      process.env = saved;
      resetEnvCache();
    }
  });
});
