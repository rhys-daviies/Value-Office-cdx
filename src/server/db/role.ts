import { Client, type ClientBase } from "pg";

// Least-privilege application role (Phase 4B).
//
//   migration role  owns the schema, tables and integrity functions; runs migrations.
//   app role        DML only. It cannot alter or disable triggers (not an owner), cannot
//                   write audit_event directly (the audit trigger is SECURITY DEFINER),
//                   cannot update/delete issued reports, and cannot truncate anything.
//
// Grants are re-applied after every migration so new tables are covered.

export const APP_ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

export async function grantAppRole(db: ClientBase, role: string): Promise<void> {
  if (!APP_ROLE_PATTERN.test(role)) throw new Error("Invalid role name");
  const r = `"${role}"`;
  await db.query("BEGIN");
  try {
    for (const stmt of [
      `GRANT USAGE ON SCHEMA public TO ${r}`,
      `REVOKE CREATE ON SCHEMA public FROM ${r}`,
      `REVOKE CREATE ON SCHEMA public FROM PUBLIC`,
      `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${r}`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${r}`,
      // Append-only / insert-only records.
      `REVOKE INSERT, UPDATE, DELETE ON audit_event FROM ${r}`,
      `REVOKE UPDATE, DELETE ON report_issue FROM ${r}`,
      `REVOKE DELETE ON app_session, app_credential FROM ${r}`,
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${r}`,
      `REVOKE ALL ON SEQUENCE audit_event_id_seq FROM ${r}`,
      // Health reads the applied-migration count.
      `GRANT USAGE ON SCHEMA drizzle TO ${r}`,
      `GRANT SELECT ON drizzle.__drizzle_migrations TO ${r}`,
    ]) {
      await db.query(stmt);
    }
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

export type RoleCheck = { role: string; problems: string[] };

/** Why the connected role is unsafe for the application (empty when safe). */
export async function checkApplicationRole(db: ClientBase): Promise<RoleCheck> {
  const { rows } = await db.query<{
    role: string;
    superuser: boolean;
    bypassrls: boolean;
    createrole: boolean;
    owned: number;
    can_create: boolean;
  }>(`
    select current_user as role,
           r.rolsuper as superuser,
           r.rolbypassrls as bypassrls,
           r.rolcreaterole as createrole,
           (select count(*)::int from pg_tables t where t.schemaname = 'public' and t.tableowner = current_user) as owned,
           has_schema_privilege(current_user, 'public', 'CREATE') as can_create
    from pg_roles r where r.rolname = current_user`);
  const row = rows[0]!;
  const problems: string[] = [];
  if (row.superuser) problems.push("the database role is a superuser");
  if (row.owned > 0) problems.push("the database role owns Value Office tables (use a non-owner application role)");
  if (row.can_create) problems.push("the database role can create objects in schema public");
  if (row.bypassrls) problems.push("the database role has BYPASSRLS");
  if (row.createrole) problems.push("the database role has CREATEROLE");
  return { role: row.role, problems };
}

export async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
