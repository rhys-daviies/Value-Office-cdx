import { eq, sql } from "drizzle-orm";

import { DomainError } from "@/domain/errors";
import { updateProjectDetails } from "@/server/commands/project";
import { db, schema } from "@/server/db/client";

import { canonicalJourney } from "./canonical";

// Synthetic production demo creation (Phase 4D.9N.1C.2). Runs the accepted canonical journey through normal commands
// with the governance date G taken from the database's own current_date: the decision, VC-001 / V2 authorisation and
// Review #3 fall on the day the demo is really created, while system timestamps (issue, finalisation, recording) are
// the real clock. Every guard runs before the first write; a refusal leaves the database untouched.

type Actor = { userId: string };

/** G must follow Review #2 (30 Sep 2026) and precede the 30 Dec 2026 pivot and Review #3's first 31 Dec milestone. */
export const DEMO_GOVERNANCE_WINDOW = { first: "2026-10-01", last: "2026-12-29" } as const;
/** No creation this close to UTC midnight: G must not change while the journey runs. */
export const DEMO_MIDNIGHT_MARGIN_MINUTES = 15;

/**
 * The database clock, all in the database session's own time zone (the zone its current_date and the authorisation
 * "not in the future" guard use): current_date, the current instant, minutes to the next midnight, and the zone name.
 */
export type DbClock = { currentDate: string; nowUtc: Date; minutesToMidnight: number; timeZone: string };

export async function readDbClock(): Promise<DbClock> {
  const [r] = (
    await db().execute<{ d: string; n: string; m: string; z: string }>(
      sql`select to_char(current_date, 'YYYY-MM-DD') d,
                 to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') n,
                 (extract(epoch from ((current_date + 1)::timestamptz - now())) / 60)::text m,
                 current_setting('TimeZone') z`,
    )
  ).rows;
  return { currentDate: r!.d, nowUtc: new Date(r!.n), minutesToMidnight: Number(r!.m), timeZone: r!.z };
}

/** Why G (the database's current date) cannot be used now; empty when it can. */
export function governanceDateProblems(c: DbClock): string[] {
  const out: string[] = [];
  const { first, last } = DEMO_GOVERNANCE_WINDOW;
  if (c.currentDate < first || c.currentDate > last)
    out.push(`governance date ${c.currentDate} is outside ${first} – ${last}`);
  if (c.minutesToMidnight < DEMO_MIDNIGHT_MARGIN_MINUTES)
    out.push(
      `within ${DEMO_MIDNIGHT_MARGIN_MINUTES} minutes of midnight (${c.timeZone}; ${Math.floor(c.minutesToMidnight)} min left)`,
    );
  return out;
}

export type DemoSpec = { code: string; name: string; context: string };

export class DemoRefused extends Error {}

/** Facts checked before any write, both at preflight and again immediately before the first mutation. */
export async function demoPreconditions(spec: DemoSpec, clock: () => Promise<DbClock> = readDbClock) {
  const c = await clock();
  const [who] = (await db().execute<{ u: string }>(sql`select current_user u`)).rows;
  const [mig] = (
    await db().execute<{ n: number; last: string }>(
      sql`select count(*)::int n, (select hash from drizzle.__drizzle_migrations order by id desc limit 1) last from drizzle.__drizzle_migrations`,
    )
  ).rows;
  const [clash] = await db()
    .select({ id: schema.project.id })
    .from(schema.project)
    .where(eq(schema.project.code, spec.code));
  return {
    clock: c,
    governanceDate: c.currentDate,
    problems: governanceDateProblems(c),
    role: who!.u,
    migrations: mig!,
    exists: Boolean(clash),
  };
}

/**
 * Creates the demo project on governance date G = `expectedG`. Re-checks, before the first write, that the project is
 * still absent, the database date still equals G and the midnight margin holds (plus any caller check, e.g. role and
 * migration head); otherwise throws DemoRefused with zero writes. Stages report progress through `log`.
 */
export async function createCanonicalDemo(
  actor: Actor,
  spec: DemoSpec,
  opts: {
    expectedG: string;
    clock?: () => Promise<DbClock>;
    recheck?: (p: Awaited<ReturnType<typeof demoPreconditions>>) => string[];
    log?: (line: string) => void;
  },
) {
  const log = opts.log ?? (() => {});
  const pre = await demoPreconditions(spec, opts.clock);
  const problems = [
    ...(pre.exists ? [`a project with code ${spec.code} already exists`] : []),
    ...(pre.governanceDate !== opts.expectedG
      ? [`database date ${pre.governanceDate} no longer equals the preflight G ${opts.expectedG}`]
      : []),
    ...pre.problems,
    ...(opts.recheck?.(pre) ?? []),
  ];
  if (problems.length) throw new DemoRefused(`refused before any write: ${problems.join("; ")}`);
  log(
    `ok  pre-mutation recheck: ${spec.code} absent · G ${pre.governanceDate} unchanged · outside the midnight margin`,
  );

  const j = canonicalJourney(actor, { code: spec.code, name: spec.name, governanceDate: pre.governanceDate });
  const stages: [string, () => Promise<unknown>][] = [
    [
      "establish (project, VCO, V0, V1 drivers + qualification, basis/period, plan, propose, authorise V1)",
      () => j.establish({ inherited: true }),
    ],
    [
      "assure (Review #1, VL-001 + evidence, Review #2 positions/paths/options, recommendation, leakage, issue, finalise, decision)",
      () => j.assure(),
    ],
    ["change (create VC-001, re-baseline VD-01, re-phase V2 plan)", () => j.change()],
    ["proposeChange (propose VC-001)", () => j.proposeChange()],
    ["authoriseChange (E-004, VCO authorises V2)", () => j.authoriseChange()],
    ["continueAssurance (Review #3, positions, forecast path, finalise)", () => j.continueAssurance()],
    [
      "label (updateProjectDetails: synthetic context)",
      () => updateProjectDetails(actor, { projectId: j.state.project.id, context: spec.context }),
    ],
  ];
  for (const [label, run] of stages) {
    try {
      await run();
      log(`ok  ${label}`);
    } catch (e) {
      const code = e instanceof DomainError ? e.code : "ERROR";
      throw new Error(
        `FAILED ${label}: ${code} ${(e as Error).message.slice(0, 200)} — partial state, project ${j.state.project?.id ?? "(not created)"}; no repair attempted`,
      );
    }
  }
  return { projectId: j.state.project.id, governanceDate: pre.governanceDate, state: j.state };
}
