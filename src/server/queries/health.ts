import { sql } from "drizzle-orm";

import { db } from "@/server/db/client";

export type DbHealth =
  { ok: true; database: string; serverVersion: string; migrationsApplied: number } | { ok: false; error: string };

export async function getDbHealth(): Promise<DbHealth> {
  try {
    const result = await db().execute<{ database: string; version: string; migrations: number }>(sql`
      select current_database() as database,
             current_setting('server_version') as version,
             (select count(*)::int from drizzle.__drizzle_migrations) as migrations`);
    const row = result.rows[0]!;
    return { ok: true, database: row.database, serverVersion: row.version, migrationsApplied: row.migrations };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
