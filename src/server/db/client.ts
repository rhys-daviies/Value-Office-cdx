import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "@/server/env";

import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// One pool per process; cached on globalThis so dev hot-reload does not leak pools.
const globalForDb = globalThis as unknown as { voPool?: Pool; voDb?: Db };

export function db(): Db {
  if (!globalForDb.voDb) {
    globalForDb.voPool = new Pool({ connectionString: env().DATABASE_URL, max: env().VO_DB_POOL_MAX });
    globalForDb.voDb = drizzle(globalForDb.voPool, { schema, casing: "snake_case" });
  }
  return globalForDb.voDb;
}

export async function closeDb(): Promise<void> {
  await globalForDb.voPool?.end();
  globalForDb.voPool = undefined;
  globalForDb.voDb = undefined;
}

export { schema };
