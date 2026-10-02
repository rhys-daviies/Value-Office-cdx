import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { seedCompactTrajectory, seedCompactTrajectoryDraft } from "@/fixtures/compact";
import { createReview, finaliseReview, upsertValuePositions } from "@/server/commands/assurance";
import { recordEvidence } from "@/server/commands/evidence";
import type { Actor } from "@/server/commands/run";
import { removePlanPoint, setForecastPoint, setPlanPoint, setVersionBasis } from "@/server/commands/trajectory";
import { authoriseInitialVersion, proposeVersion } from "@/server/commands/value-case";
import { authoriseValueChange, createValueChange, proposeValueChange } from "@/server/commands/value-change";
import { db, schema } from "@/server/db/client";
import { getValueTrajectoryChart } from "@/server/queries/trajectory";
import { buildTrajectoryPresentation, epoch, timeTicks } from "@/ui/trajectory/model";
import { ValueTrajectory } from "@/ui/trajectory/trajectory";

import { newActor, proposedV1, uid } from "../support/fixtures";

// Phase 4D.9E: primary Value Trajectory read model and presentation. Today is injected for determinism.

const TODAY = "2027-03-15";
const text = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(el)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
const render = (chart: Awaited<ReturnType<typeof getValueTrajectoryChart>>) =>
  text(createElement(ValueTrajectory, { chart, currency: "USD" }));

async function driverIds(projectId: string) {
  const rows = await db().select().from(schema.valueDriver).where(eq(schema.valueDriver.projectId, projectId));
  return (code: string) => rows.find((r) => r.code === code)!.id;
}

/** Trajectory Executive: authorised $30m plan, finalised reviews 31 Mar (realised $1.0m) and 30 Sep 2026. */
async function executive() {
  const actor = await newActor();
  const ctx = await seedCompactTrajectory(actor, { code: `TX-${uid()}`, name: "Trajectory Executive", formal: true });
  return { actor, ...ctx };
}

async function review(
  actor: Actor,
  projectId: string,
  date: string,
  positions: { code: string; forecast: string; realised?: string }[],
  forecastPoints: [string, string][] = [],
) {
  const id = await driverIds(projectId);
  const r = await createReview(actor, { projectId, trigger: "ad_hoc", reviewDate: date });
  await upsertValuePositions(actor, {
    reviewId: r.id,
    positions: positions.map((p) => ({
      valueDriverId: id(p.code),
      currentForecast: p.forecast,
      realisedValue: p.realised,
    })),
  });
  for (const [asOf, value] of forecastPoints) await setForecastPoint(actor, { reviewId: r.id, asOf, value });
  await finaliseReview(actor, { reviewId: r.id });
  return r;
}

/** Draft V1 ($30m) classified, optionally phased, then authorised. */
async function authorised(
  kind: "cumulative_benefit" | "annual_run_rate" | "net_present_value" | "other" | null,
  opts: { period?: boolean; plan?: boolean } = {},
) {
  const actor = await newActor();
  const ctx = await seedCompactTrajectoryDraft(actor, { code: `TA-${uid()}`, name: "Trajectory" });
  if (kind || opts.period !== false) {
    await setVersionBasis(actor, {
      versionId: ctx.v1.id,
      valueBasisKind: kind,
      valuePeriodStart: opts.period === false ? null : "2026-01-01",
      valuePeriodEnd: opts.period === false ? null : "2028-12-31",
    });
  }
  if (opts.plan) {
    await setPlanPoint(actor, { versionId: ctx.v1.id, asOf: "2026-12-31", value: "8000000.00" });
    await setPlanPoint(actor, { versionId: ctx.v1.id, asOf: "2028-12-31", value: "30000000.00" });
  }
  await proposeVersion(actor, { versionId: ctx.v1.id });
  const ev = await recordEvidence(actor, { projectId: ctx.project.id, code: "E-1", title: "Authorisation" });
  await authoriseInitialVersion(actor, {
    versionId: ctx.v1.id,
    authorisedByPersonId: ctx.vco.id,
    authorisedOn: "2026-01-15",
    authorisationEvidenceId: ev.id,
  });
  return { actor, ...ctx };
}

describe("primary Value Trajectory read model", () => {
  it("1/3/5/8. cumulative: current plan, realised checkpoints from the period-start origin, latest forecast anchored", async () => {
    const x = await executive();
    const c = await getValueTrajectoryChart(x.project.id, { today: TODAY });
    expect(c).toMatchObject({
      available: true,
      status: "ready",
      measure: "cumulative",
      period: { start: "2026-01-01", end: "2028-12-31" },
      version: { versionNumber: 1, total: "30000000.00" },
      latestFormal: { sequence: 2, reviewDate: "2026-09-30", forecastTotal: "26000000.00" },
      today: { asOf: TODAY, inPeriod: true },
      notes: [],
    });
    expect(c.plan.map((p) => [p.asOf, p.value])).toEqual([
      ["2026-01-01", "0.00"],
      ["2026-12-31", "6000000.00"],
      ["2027-12-31", "18000000.00"],
      ["2028-12-31", "30000000.00"],
    ]);
    expect(c.realised).toEqual({
      origin: { asOf: "2026-01-01", value: "0.00" },
      checkpoints: [
        { sequence: 1, asOf: "2026-03-31", value: "1000000.00" },
        { sequence: 2, asOf: "2026-09-30", value: "4000000.00" },
      ],
      excluded: [],
    });
    expect(c.forecast!.anchor).toEqual({ asOf: "2026-09-30", value: "4000000.00" }); // the review's own realised
    expect(c.forecast!.points.map((p) => [p.asOf, p.value])).toEqual([
      ["2027-12-31", "16000000.00"],
      ["2028-12-31", "26000000.00"],
    ]);
    // Nothing was stored for the anchor.
    const review2 = await db()
      .select()
      .from(schema.valueTrajectoryPoint)
      .where(eq(schema.valueTrajectoryPoint.assuranceReviewId, x.review.id));
    expect(review2.map((p) => p.asOf)).toEqual(expect.not.arrayContaining(["2026-09-30"]));

    // 8. Today and the formal checkpoint are distinct markers; the age of the position is stated.
    const p = buildTrajectoryPresentation(c, "USD")!;
    expect(p.today).toEqual({ t: epoch(TODAY), label: "Today" });
    expect(p.checkpoint).toEqual({ t: epoch("2026-09-30"), label: "Formal position 30 Sept 2026" });
    expect(render(c)).toContain("Formal position as at 30 Sept 2026 (Review #2); today is 15 Mar 2027.");
    const same = buildTrajectoryPresentation({ ...c, today: { asOf: "2026-09-30", inPeriod: true } }, "USD")!;
    expect(same.checkpoint).toBeNull();
    expect(same.today!.label).toBe("Today · formal position");
  });

  it("20. rows exist only at explicit dates; tooltips name only stored observations; the anchor is not a forecast", async () => {
    const x = await executive();
    const p = buildTrajectoryPresentation(await getValueTrajectoryChart(x.project.id, { today: TODAY }), "USD")!;
    expect(p.rows.map((r) => r.t)).toEqual(
      ["2026-01-01", "2026-03-31", "2026-09-30", "2026-12-31", "2027-12-31", "2028-12-31"].map(epoch),
    );
    const at = (d: string) => p.rows.find((r) => r.t === epoch(d))!;
    expect(at("2026-09-30")).toMatchObject({ forecast: 4000000, forecastAnchor: true, plan: null });
    expect(at("2026-09-30").tip).toEqual(["30 Sept 2026", "Realised · Review #2: $4.0m"]);
    expect(at("2027-12-31").tip).toEqual([
      "31 Dec 2027",
      "Authorised Plan (V1): $18.0m",
      "Formal Forecast: $16.0m — formal position as at 30 Sept 2026",
    ]);
    expect(at("2028-12-31").endLabel).toEqual({ plan: "$30.0m", forecast: "$26.0m" });
    expect(at("2026-01-01").tip).toEqual([
      "1 Jan 2026",
      "Authorised Plan (V1): $0",
      "Realised: $0 at Value Period start (cumulative basis)",
    ]);
    // Every tooltip line is one stored point (plus the definitional origin) — none are derived.
    expect(p.rows.flatMap((r) => r.tip.slice(1))).toHaveLength(4 + 3 + 2);
    expect(timeTicks("2026-01-01", "2028-12-31").map(([, l]) => l)).toEqual([
      "Jan 26",
      "Jul 26",
      "Jan 27",
      "Jul 27",
      "Jan 28",
      "Jul 28",
    ]);
  });

  it("4/6/7. only the latest finalised review's forecast; no anchor when its realised is incomplete", async () => {
    const x = await executive();
    // A newer draft review never displaces the latest FINALISED one.
    await createReview(x.actor, { projectId: x.project.id, trigger: "ad_hoc", reviewDate: "2027-01-31" });
    expect((await getValueTrajectoryChart(x.project.id, { today: TODAY })).latestFormal!.sequence).toBe(2);
    const [draft] = await db()
      .select()
      .from(schema.assuranceReview)
      .where(eq(schema.assuranceReview.projectId, x.project.id))
      .then((rs) => rs.filter((r) => r.status === "draft"));
    // Finalise Review #3 with incomplete realised (VD-02, VD-03 not recorded) and its own forecast path.
    const id = await driverIds(x.project.id);
    await upsertValuePositions(x.actor, {
      reviewId: draft!.id,
      positions: [
        { valueDriverId: id("VD-01"), currentForecast: "12000000.00", realisedValue: "3000000.00" },
        { valueDriverId: id("VD-02"), currentForecast: "8000000.00" },
        { valueDriverId: id("VD-03"), currentForecast: "4000000.00" },
      ],
    });
    await setForecastPoint(x.actor, { reviewId: draft!.id, asOf: "2028-06-30", value: "17000000.00" });
    await setForecastPoint(x.actor, { reviewId: draft!.id, asOf: "2028-12-31", value: "24000000.00" });
    await finaliseReview(x.actor, { reviewId: draft!.id });

    const c = await getValueTrajectoryChart(x.project.id, { today: TODAY });
    expect(c.latestFormal).toMatchObject({ sequence: 3, reviewDate: "2027-01-31", forecastTotal: "24000000.00" });
    expect(c.forecast!.points.map((p) => p.value)).toEqual(["17000000.00", "24000000.00"]); // Review #2's not merged
    expect(c.forecast!.anchor).toBeNull(); // Review #3's realised is incomplete: no invented anchor
    expect(c.realised!.excluded).toEqual([{ sequence: 3, reason: "incomplete" }]);
    expect(c.notes).toContain("realised_partial_excluded");
    expect(render(c)).toContain("Realised not plotted where incomplete (Review #3");
  });

  it("9. Today outside the Value Period: no Today marker, a note instead", async () => {
    const x = await executive();
    const c = await getValueTrajectoryChart(x.project.id, { today: "2030-02-01" });
    expect(c.today).toEqual({ asOf: "2030-02-01", inPeriod: false });
    expect(buildTrajectoryPresentation(c, "USD")!.today).toBeNull();
    expect(render(c)).toContain("Today (1 Feb 2030) is outside the Value Period.");
  });

  it("10. annual run-rate: plan and forecast only, no cumulative realised and no anchor", async () => {
    const a = await authorised("annual_run_rate", { plan: true });
    await review(
      a.actor,
      a.project.id,
      "2026-09-30",
      [
        { code: "VD-01", forecast: "18000000.00", realised: "2000000.00" },
        { code: "VD-02", forecast: "9000000.00", realised: "1000000.00" },
      ],
      [["2028-12-31", "27000000.00"]],
    );
    const c = await getValueTrajectoryChart(a.project.id, { today: TODAY });
    expect(c).toMatchObject({ measure: "run_rate", realised: null, notes: ["realised_run_rate_not_recorded"] });
    expect(c.forecast!.anchor).toBeNull();
    const html = render(c);
    expect(html).toContain("Realised run-rate is not currently recorded.");
    expect(html).toContain("Annual Run Rate");
    expect(html).not.toContain("Realised (formal checkpoints)");
  });

  it("11–15. NPV, Other, unclassified and missing period are unavailable; missing plan phasing is noted", async () => {
    for (const [kind, message] of [
      ["net_present_value", "Value trajectory is not available for NPV."],
      ["other", "Value trajectory is not available for this Value Basis."],
      [null, "Value Basis not classified."],
    ] as const) {
      const a = await authorised(kind);
      const c = await getValueTrajectoryChart(a.project.id, { today: TODAY });
      expect(c.available).toBe(false);
      expect(buildTrajectoryPresentation(c, "USD")).toBeNull();
      expect(render(c)).toContain(message);
    }
    const noPeriod = await authorised("cumulative_benefit", { period: false });
    const np = await getValueTrajectoryChart(noPeriod.project.id, { today: TODAY });
    expect(np).toMatchObject({ available: false, status: "period_not_set" });
    expect(render(np)).toContain("Value Period not set.");

    const noPlan = await authorised("cumulative_benefit");
    const c = await getValueTrajectoryChart(noPlan.project.id, { today: TODAY });
    expect(c).toMatchObject({ available: true, status: "phasing_not_entered", plan: [] });
    expect(c.notes).toEqual(["plan_phasing_not_entered", "no_formal_position"]);
    expect(render(c)).toContain("Authorised plan phasing not entered.");
  });

  it("2/16/17. plan only before any review; a review without forecast phasing still plots realised", async () => {
    const a = await authorised("cumulative_benefit", { plan: true });
    let c = await getValueTrajectoryChart(a.project.id, { today: TODAY });
    expect(c).toMatchObject({ latestFormal: null, forecast: null, notes: ["no_formal_position"] });
    expect(c.realised!.checkpoints).toEqual([]);
    expect(render(c)).toContain("No formal Assurance position yet.");
    expect(buildTrajectoryPresentation(c, "USD")!.checkpoint).toBeNull();

    await review(a.actor, a.project.id, "2026-06-30", [
      { code: "VD-01", forecast: "19000000.00", realised: "1500000.00" },
      { code: "VD-02", forecast: "9000000.00", realised: "500000.00" },
    ]);
    c = await getValueTrajectoryChart(a.project.id, { today: TODAY });
    expect(c.notes).toEqual(["forecast_phasing_not_entered"]);
    expect(c.forecast).toBeNull();
    expect(c.realised!.checkpoints).toEqual([{ sequence: 1, asOf: "2026-06-30", value: "2000000.00" }]);
    expect(render(c)).toContain("Formal forecast phasing not entered.");
  });

  it("18/19. V2 in force: only V2's plan is the main line; V1's plan is unchanged; the formal basis is stated", async () => {
    const x = await executive();
    const v1Before = await db()
      .select()
      .from(schema.valueTrajectoryPoint)
      .where(eq(schema.valueTrajectoryPoint.valueCaseVersionId, x.v1.id));
    const { change, version: v2 } = await createValueChange(x.actor, {
      projectId: x.project.id,
      code: "VC-001",
      reason: "Re-phase",
      statedChangeAmount: "0.00",
    });
    const copied = await db()
      .select()
      .from(schema.valueTrajectoryPoint)
      .where(eq(schema.valueTrajectoryPoint.valueCaseVersionId, v2.id));
    await removePlanPoint(x.actor, { pointId: copied.find((p) => p.asOf === "2026-12-31")!.id });
    await setPlanPoint(x.actor, { versionId: v2.id, asOf: "2027-06-30", value: "9000000.00" });
    await proposeValueChange(x.actor, { changeId: change.id });
    const ev = await recordEvidence(x.actor, { projectId: x.project.id, code: "E-VC1", title: "VCO approval" });
    await authoriseValueChange(x.actor, {
      changeId: change.id,
      authorisedByPersonId: x.vco.id,
      authorisedOn: "2026-10-01",
      authorisationEvidenceId: ev.id,
    });
    const c = await getValueTrajectoryChart(x.project.id, { today: TODAY });
    expect(c.version!.versionNumber).toBe(2);
    expect(c.plan.map((p) => p.asOf)).toEqual(["2026-01-01", "2027-06-30", "2027-12-31", "2028-12-31"]);
    expect(c.notes).toEqual(["formal_measured_against_earlier_version"]);
    expect(render(c)).toContain("The latest formal position was measured against V1.");
    expect(render(c)).toContain("Authorised Plan (V2)");
    const v1After = await db()
      .select()
      .from(schema.valueTrajectoryPoint)
      .where(eq(schema.valueTrajectoryPoint.valueCaseVersionId, x.v1.id));
    expect(v1After).toEqual(v1Before);
  });

  it("legacy authorised project (no basis) shows the unavailable state; no authorised version renders nothing", async () => {
    const actor = await newActor();
    const legacy = await proposedV1(actor);
    expect(render(await getValueTrajectoryChart(legacy.project.id))).toBe("");
    await authoriseInitialVersion(actor, {
      versionId: legacy.v1.id,
      authorisedByPersonId: legacy.vco.id,
      authorisedOn: "2026-01-15",
      authorisationEvidenceId: legacy.evidence.id,
    });
    expect(render(await getValueTrajectoryChart(legacy.project.id))).toContain("Value Basis not classified.");
  });
});
