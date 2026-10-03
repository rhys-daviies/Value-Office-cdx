import { asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { CANONICAL, canonicalJourney } from "@/fixtures/canonical";
import {
  createCanonicalDemo,
  DemoRefused,
  demoPreconditions,
  governanceDateProblems,
  readDbClock,
  type DbClock,
} from "@/fixtures/demo";
import { db, schema } from "@/server/db/client";
import { getAssuranceWorkspace } from "@/server/queries/assurance";
import { getAlternativeValueTrajectories } from "@/server/queries/trajectory";

import { newActor, uid } from "../support/fixtures";

// Phase 4D.9N.1C.2: the date-independent production demo creator. G (the governance date) comes from the database's
// current_date and applies only to the decision, VC-001 / V2 authorisation and Review #3; system timestamps stay real.

const at = (iso: string) => new Date(iso);
/** A UTC database clock at `nowUtc` (minutes to midnight as the database computes them for a UTC session). */
const utcClock = (currentDate: string, nowUtc: string): DbClock => {
  const n = at(nowUtc);
  const midnight = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1);
  return { currentDate, nowUtc: n, minutesToMidnight: (midnight - n.getTime()) / 60_000, timeZone: "UTC" };
};
const clock = (currentDate: string, nowUtc: string) => async (): Promise<DbClock> => utcClock(currentDate, nowUtc);
/** Writes attributable to this actor (every command write is audited with its actor) and projects with these codes. */
const writes = async (actorId: string, codes: string[]) => {
  const [r] = (
    await db().execute<{ a: number; p: number }>(
      sql`select (select count(*) from audit_event where actor_user_id = ${actorId})::int a,
               (select count(*) from project where code in (${sql.join(
                 codes.map((c) => sql`${c}`),
                 sql`, `,
               )}))::int p`,
    )
  ).rows;
  return r!;
};
const spec = (code: string) => ({
  code,
  name: "Demo creator test",
  context: "SYNTHETIC / INTERNAL DEMO — NOT CLIENT DATA. Test.",
});

describe("demo governance date G (4D.9N.1C.2)", () => {
  it("the canonical journey's default stays the fixed 3 Oct 2026 journey date", () => {
    expect(CANONICAL.journeyDate).toBe("2026-10-03");
    expect(canonicalJourney({ userId: "x" }, { code: "C", name: "C" }).journeyDate).toBe("2026-10-03");
    expect(canonicalJourney({ userId: "x" }, { code: "C", name: "C", governanceDate: "2026-10-01" }).journeyDate).toBe(
      "2026-10-01",
    );
  });

  it("safe window 1 Oct – 29 Dec 2026 and the 15-minute midnight margin", () => {
    const ok = (d: string, t = "12:00:00") => governanceDateProblems(utcClock(d, `${d}T${t}Z`));
    expect(ok("2026-10-01")).toEqual([]);
    expect(ok("2026-12-29")).toEqual([]);
    expect(ok("2026-09-30")).toEqual(["governance date 2026-09-30 is outside 2026-10-01 – 2026-12-29"]);
    expect(ok("2026-12-30")).toEqual(["governance date 2026-12-30 is outside 2026-10-01 – 2026-12-29"]);
    expect(ok("2027-01-04")).toHaveLength(1);
    expect(ok("2026-11-02", "23:44:59")).toEqual([]);
    expect(ok("2026-11-02", "23:45:01")).toEqual(["within 15 minutes of midnight (UTC; 14 min left)"]);
    expect(ok("2026-11-02", "23:59:30")).toHaveLength(1);
  });

  it("the margin is measured in the database's own time zone (its current_date's zone), not UTC", () => {
    // A non-UTC session (e.g. a developer database in NZ): 23:50 local is 10 minutes before ITS midnight.
    const nz: DbClock = {
      currentDate: "2026-11-02",
      nowUtc: at("2026-11-02T10:50:00Z"),
      minutesToMidnight: 10,
      timeZone: "Pacific/Auckland",
    };
    expect(governanceDateProblems(nz)).toEqual(["within 15 minutes of midnight (Pacific/Auckland; 10 min left)"]);
  });

  it("the live database clock is self-consistent", async () => {
    const c = await readDbClock();
    expect(c.currentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(c.minutesToMidnight).toBeGreaterThan(0);
    expect(c.minutesToMidnight).toBeLessThanOrEqual(25 * 60);
    expect(c.timeZone.length).toBeGreaterThan(0);
  });

  it("refusals happen before any write: out-of-window G, midnight margin, G changed since preflight, failed recheck", async () => {
    const a = await newActor();
    const codes = Array.from({ length: 5 }, () => `DR-${uid()}`);
    const before = await writes(a.userId, codes);
    let i = 0;
    const attempt = (o: Parameters<typeof createCanonicalDemo>[2]) => createCanonicalDemo(a, spec(codes[i++]!), o);
    await expect(
      attempt({ expectedG: "2026-09-30", clock: clock("2026-09-30", "2026-09-30T10:00:00Z") }),
    ).rejects.toThrow(/outside 2026-10-01 – 2026-12-29/);
    await expect(
      attempt({ expectedG: "2026-12-30", clock: clock("2026-12-30", "2026-12-30T10:00:00Z") }),
    ).rejects.toThrow(/outside/);
    await expect(
      attempt({ expectedG: "2026-10-01", clock: clock("2026-10-01", "2026-10-01T23:50:00Z") }),
    ).rejects.toThrow(/of midnight/);
    // Preflight read G = 1 Oct; by the pre-mutation recheck the database date is 2 Oct.
    await expect(
      attempt({ expectedG: "2026-10-01", clock: clock("2026-10-02", "2026-10-02T00:00:30Z") }),
    ).rejects.toThrow(/no longer equals the preflight G 2026-10-01/);
    await expect(
      attempt({
        expectedG: "2026-10-01",
        clock: clock("2026-10-01", "2026-10-01T10:00:00Z"),
        recheck: () => ["write identity is not vo_runtime"],
      }),
    ).rejects.toThrow(DemoRefused);
    expect(i).toBe(5);
    expect(await writes(a.userId, codes)).toEqual(before); // zero writes: no audit rows by this actor, no project
  });

  it("G applies only to the decision, VC-001 / V2 and Review #3; system timestamps are real; economics unchanged", async () => {
    const a = await newActor();
    const G = "2026-10-01"; // inside the window and not after the database's own date, unlike the 3 Oct default
    const code = `DG-${uid()}`;
    const pre = await demoPreconditions(spec(code), clock(G, `${G}T10:00:00Z`));
    expect(pre).toMatchObject({ exists: false, governanceDate: G, problems: [] });
    const started = new Date(Date.now() - 1000);
    const lines: string[] = [];
    const { projectId, state: s } = await createCanonicalDemo(a, spec(code), {
      expectedG: G,
      clock: clock(G, `${G}T10:00:00Z`),
      log: (l) => lines.push(l),
    });
    const ended = new Date(Date.now() + 1000);
    expect(lines).toHaveLength(8); // recheck + 7 stages
    const real = (t: Date | null | undefined, what: string) =>
      expect(t && t >= started && t <= ended, `${what} is the real system time`).toBe(true);

    // Business / governance dates: the accepted retrospective dates, and G for the post-Review #2 events.
    const reviews = await db()
      .select()
      .from(schema.assuranceReview)
      .where(eq(schema.assuranceReview.projectId, projectId))
      .orderBy(asc(schema.assuranceReview.sequence));
    expect(reviews.map((r) => r.reviewDate)).toEqual(["2026-03-31", "2026-09-30", G]);
    const [decision] = await db().select().from(schema.decision).where(eq(schema.decision.projectId, projectId));
    const [rec] = await db()
      .select()
      .from(schema.recommendation)
      .where(eq(schema.recommendation.assuranceReviewId, s.review2.id));
    const [vc] = await db().select().from(schema.valueChange).where(eq(schema.valueChange.projectId, projectId));
    const versions = await db()
      .select()
      .from(schema.valueCaseVersion)
      .where(eq(schema.valueCaseVersion.projectId, projectId))
      .orderBy(asc(schema.valueCaseVersion.versionNumber));
    expect(decision!.decidedOn).toBe(G);
    expect(vc!.authorisedOn).toBe(G);
    expect(versions.map((v) => [v.versionNumber, v.status, v.authorisedOn])).toEqual([
      [0, "recorded", null],
      [1, "superseded", "2026-01-15"],
      [2, "authorised", G],
    ]);

    // System timestamps: real clock, never parameterised; recommendation issued before the decision was recorded.
    real(rec!.issuedAt, "recommendation issuedAt");
    real(decision!.recordedAt, "decision recordedAt");
    expect(rec!.issuedAt! <= decision!.recordedAt).toBe(true);
    for (const r of reviews) {
      real(r.createdAt, `Review #${r.sequence} createdAt`);
      real(r.finalisedAt, `Review #${r.sequence} finalisedAt`);
    }
    real(vc!.createdAt, "VC-001 createdAt");
    real(vc!.proposedAt, "VC-001 proposedAt");
    real(vc!.authorisationRecordedAt, "VC-001 authorisationRecordedAt");
    real(versions[2]!.authorisationRecordedAt, "V2 authorisationRecordedAt");
    real(versions[1]!.supersededAt, "V1 supersededAt");
    expect(vc!.authorisationRecordedAt!.getTime()).toBe(versions[2]!.authorisationRecordedAt!.getTime());

    // Economics and trajectory dates unchanged by G.
    const w2 = (await getAssuranceWorkspace(projectId, s.review2.id))!.totals;
    const w3 = (await getAssuranceWorkspace(projectId, s.review3.id))!;
    expect(w2).toMatchObject({ forecastTotal: "26000000.00", realisedTotal: "4000000.00", valueGap: "4000000.00" });
    expect([
      w3.againstVersion.versionNumber,
      w3.totals.forecastTotal,
      w3.totals.realisedTotal,
      w3.totals.valueGap,
    ]).toEqual([2, "25000000.00", "4600000.00", "2000000.00"]);
    const alt = (await getAlternativeValueTrajectories(projectId, s.review2.id))!;
    expect(alt.options.map((o) => [o.label, o.totalValue])).toEqual([
      ["Act now", "29000000.00"],
      ["No action", "23000000.00"],
      ["Delay 3 months", "27000000.00"],
    ]);
    expect(alt.decisionComparison?.difference).toBe("-2000000.00");
    const points = await db()
      .select()
      .from(schema.valueTrajectoryPoint)
      .where(eq(schema.valueTrajectoryPoint.projectId, projectId));
    expect(points).toHaveLength(21);
    expect(
      points
        .filter((p) => p.assuranceReviewId === s.review3.id)
        .map((p) => [p.asOf, p.value])
        .sort(),
    ).toEqual([
      ["2026-12-31", "5000000.00"],
      ["2027-12-31", "15500000.00"],
      ["2028-12-31", "25000000.00"],
    ]);
    expect(
      points
        .filter((p) => p.asOf === "2026-12-30")
        .map((p) => [p.value, p.note])
        .sort(),
    ).toEqual([
      ["5000000.00", null],
      ["5000000.00", "Management acts — delayed action"],
    ]);
    const [project] = await db().select().from(schema.project).where(eq(schema.project.id, projectId));
    expect(project!.context).toContain("SYNTHETIC / INTERNAL DEMO — NOT CLIENT DATA");

    // A second creation with the same code is refused before any write.
    const before = await writes(a.userId, [code]);
    await expect(
      createCanonicalDemo(a, spec(code), { expectedG: G, clock: clock(G, `${G}T10:00:00Z`) }),
    ).rejects.toThrow(/already exists/);
    expect(await writes(a.userId, [code])).toEqual(before);
    const issued = await db().select().from(schema.reportIssue).where(eq(schema.reportIssue.projectId, projectId));
    expect(issued).toHaveLength(0);
  }, 120_000);
});
