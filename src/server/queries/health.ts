import { sql } from "drizzle-orm";

import { db } from "@/server/db/client";

export type DbHealth = { ok: true; migrationsApplied: number } | { ok: false };

/** Database reachability and applied-migration count. Failure detail is logged, never returned. */
export async function getDbHealth(): Promise<DbHealth> {
  try {
    const result = await db().execute<{ migrations: number }>(
      sql`select (select count(*)::int from drizzle.__drizzle_migrations) as migrations`,
    );
    return { ok: true, migrationsApplied: result.rows[0]!.migrations };
  } catch (err) {
    console.error("[health] database check failed:", err instanceof Error ? err.name : "unknown error");
    return { ok: false };
  }
}
