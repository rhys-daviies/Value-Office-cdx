import { sql } from "drizzle-orm";
import { z } from "zod";

import { DomainError } from "@/domain/errors";
import { db, type Tx } from "@/server/db/client";

import type { CommandName } from "./names";

/** The consultant performing a command. */
export type Actor = { userId: string };

export type CommandContext = { tx: Tx; actor: Actor };

/**
 * Run `fn` as the named command: one transaction, with actor and command name
 * set transaction-locally so the audit trigger can attribute every row change.
 * Database rule violations (raised as `VO_<CODE>: message`) become DomainErrors.
 */
export async function runCommand<R>(
  name: CommandName,
  actor: Actor,
  fn: (ctx: CommandContext) => Promise<R>,
): Promise<R> {
  try {
    return await db().transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('vo.actor_id', ${actor.userId}, true), set_config('vo.command', ${name}, true)`,
      );
      return fn({ tx, actor });
    });
  } catch (err) {
    throw toDomainError(err) ?? err;
  }
}

/**
 * Define a command: validated input → one audited transaction.
 * Server actions and scripts call the returned function; nothing else writes.
 */
export function defineCommand<S extends z.ZodType, R>(
  name: CommandName,
  input: S,
  handler: (ctx: CommandContext, input: z.output<S>) => Promise<R>,
): (actor: Actor, raw: z.input<S>) => Promise<R> {
  return async (actor, raw) => {
    const parsed = input.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
      throw new DomainError("VO_INVALID_INPUT", z.prettifyError(parsed.error), { issues });
    }
    return runCommand(name, actor, (ctx) => handler(ctx, parsed.data));
  };
}

const DB_RULE = /^(VO_[A-Z_]+): (.*)$/s;

const CONSTRAINT_CODES: Record<string, string> = {
  "23505": "VO_UNIQUE_VIOLATION",
  "23503": "VO_REFERENCE_VIOLATION",
  "23514": "VO_CHECK_VIOLATION",
  "22P02": "VO_INVALID_VALUE",
};

function toDomainError(err: unknown): DomainError | undefined {
  if (err instanceof DomainError) return err;
  const pg = findPgError(err);
  if (!pg) return undefined;
  const rule = DB_RULE.exec(pg.message);
  if (rule) return new DomainError(rule[1]!, rule[2]!);
  const code = pg.code && CONSTRAINT_CODES[pg.code];
  if (code) {
    return new DomainError(code, pg.constraint ? `${pg.message} (${pg.constraint})` : pg.message, {
      constraint: pg.constraint,
    });
  }
  return undefined;
}

type PgErrorLike = { message: string; code?: string; constraint?: string };

function findPgError(err: unknown): PgErrorLike | undefined {
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 5; depth++) {
    const e = cur as { message?: unknown; code?: unknown; severity?: unknown; cause?: unknown };
    if (typeof e.severity === "string" && typeof e.message === "string") return e as PgErrorLike;
    cur = e.cause;
  }
  return undefined;
}
