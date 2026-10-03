import { todayIso } from "@/domain/attention";
import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { seedCompactTrajectory, seedCompactTrajectoryDraft } from "@/fixtures/compact";
import { createReview, finaliseReview, updateReview, upsertValuePositions } from "@/server/commands/assurance";
import { recordEvidence } from "@/server/commands/evidence";
import { issueRecommendation, recordDecision, saveRecommendation, upsertScenario } from "@/server/commands/options";
import { setPlanPoint, setScenarioPoint, setVersionBasis } from "@/server/commands/trajectory";
import { authoriseInitialVersion, proposeVersion } from "@/server/commands/value-case";
import { db, schema } from "@/server/db/client";
import { getAlternativeValueTrajectories } from "@/server/queries/trajectory";
import { formatMoneyShort } from "@/ui/format";
import { ReviewOptionsVisual } from "@/ui/trajectory/alternatives";
import { buildAlternativePresentation } from "@/ui/trajectory/alternatives-model";
import { epoch } from "@/ui/trajectory/model";

import { newActor, uid } from "../support/fixtures";
import { atDateWithoutObservation, untraced } from "../support/tooltip-trace";

// Phase 4D.9F: Alternative Value Trajectories read model and presentation (one review's assessed option paths).

const text = (a: NonNullable<Awaited<ReturnType<typeof getAlternativeValueTrajectories>>>) =>
  renderToStaticMarkup(createElement(ReviewOptionsVisual, { data: a }))
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

type Kind = "cumulative_benefit" | "annual_run_rate" | "net_present_value" | "other" | null;
type OptionSpec = { label: string; total: string; path?: [string, string][] };

/**
 * Authorised V1 ($30m; VD-01 $20m, VD-02 $10m) of the given kind, then one review on 30 Sep 2026 with the given
 * realised position and options; recommendation issued and decision recorded as requested; review finalised.
 */
async function reviewWithOptions(
  kind: Kind,
  opts: {
    period?: boolean;
    realised?: "complete" | "unattributed" | "partial" | "none";
    earlier?: "complete" | "partial";
    options: OptionSpec[];
    recommend?: number;
    select?: number;
  },
) {
  const actor = await newActor();
  const ctx = await seedCompactTrajectoryDraft(actor, { code: `AT-${uid()}`, name: "Alternatives" });
  const period = opts.period !== false;
  if (kind || period) {
    await setVersionBasis(actor, {
      versionId: ctx.v1.id,
      valueBasisKind: kind,
      valuePeriodStart: period ? "2026-01-01" : null,
      valuePeriodEnd: period ? "2028-12-31" : null,
    });
  }
  if (kind === "cumulative_benefit" || kind === "annual_run_rate") {
    if (period) await setPlanPoint(actor, { versionId: ctx.v1.id, asOf: "2028-12-31", value: "30000000.00" });
  }
  await proposeVersion(actor, { versionId: ctx.v1.id });
  const ev = await recordEvidence(actor, { projectId: ctx.project.id, code: "E-1", title: "Authorisation" });
  await authoriseInitialVersion(actor, {
    versionId: ctx.v1.id,
    authorisedByPersonId: ctx.vco.id,
    authorisedOn: "2026-01-15",
    authorisationEvidenceId: ev.id,
  });
  const drivers = await db().select().from(schema.valueDriver).where(eq(schema.valueDriver.projectId, ctx.project.id));
  const id = (code: string) => drivers.find((d) => d.code === code)!.id;

  const position = async (
    reviewId: string,
    realised: "complete" | "unattributed" | "partial" | "none",
    amounts: [string, string],
  ) => {
    await upsertValuePositions(actor, {
      reviewId,
      positions: [
        {
          valueDriverId: id("VD-01"),
          currentForecast: "19000000.00",
          realisedValue: realised === "complete" || realised === "partial" ? amounts[0] : undefined,
        },
        {
          valueDriverId: id("VD-02"),
          currentForecast: "9000000.00",
          realisedValue: realised === "complete" ? amounts[1] : undefined,
        },
      ],
    });
    if (realised === "unattributed") {
      await updateReview(actor, {
        reviewId,
        unattributedRealisedValue: "2800000.00",
        unattributedRealisedRationale: "Known only at project level",
      });
    }
  };

  if (opts.earlier) {
    const first = await createReview(actor, {
      projectId: ctx.project.id,
      trigger: "kickoff",
      reviewDate: "2026-03-31",
    });
    await position(first.id, opts.earlier, ["600000.00", "400000.00"]);
    await finaliseReview(actor, { reviewId: first.id });
  }
  const review = await createReview(actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate: "2026-09-30" });
  await position(review.id, opts.realised ?? "complete", ["1500000.00", "500000.00"]);
  const scenarios = [];
  for (const [i, o] of opts.options.entries()) {
    const s = await upsertScenario(actor, {
      reviewId: review.id,
      label: o.label,
      kind: i === opts.recommend ? "recommended" : "alternative",
      totalValue: o.total,
      sortOrder: i + 1,
    });
    for (const [asOf, value] of o.path ?? []) await setScenarioPoint(actor, { scenarioId: s.id, asOf, value });
    scenarios.push(s);
  }
  if (opts.recommend !== undefined) {
    await saveRecommendation(actor, {
      reviewId: review.id,
      scenarioId: scenarios[opts.recommend]!.id,
      narrative: "Recommended",
    });
    await issueRecommendation(actor, { reviewId: review.id });
  }
  await finaliseReview(actor, { reviewId: review.id });
  if (opts.select !== undefined) {
    await recordDecision(actor, {
      reviewId: review.id,
      selectedScenarioId: scenarios[opts.select]!.id,
      decidedByPersonId: ctx.vco.id,
      decidedOn: todayIso(), // after the recommendation was issued (4D.9K temporal order)
    });
  }
  const a = (await getAlternativeValueTrajectories(ctx.project.id, review.id))!;
  return { actor, ctx, review, scenarios, a };
}

const ACT: OptionSpec = {
  label: "Act now",
  total: "29000000.00",
  path: [
    ["2027-12-31", "18000000.00"],
    ["2028-12-31", "29000000.00"],
  ],
};
const DELAY: OptionSpec = {
  label: "Delay 3 months",
  total: "27000000.00",
  path: [
    ["2027-12-31", "16500000.00"],
    ["2028-12-31", "27000000.00"],
  ],
};
const NONE: OptionSpec = {
  label: "No action",
  total: "23000000.00",
  path: [
    ["2027-12-31", "15000000.00"],
    ["2028-12-31", "23000000.00"],
  ],
};

describe("Alternative Value Trajectories read model", () => {
  it("5–14. canonical: shared history, review anchor, three explicit paths, stored terminals, recommendation ≠ selection", async () => {
    const actor = await newActor();
    const x = await seedCompactTrajectory(actor, { code: `TX-${uid()}`, name: "Trajectory Executive", formal: true });
    const a = (await getAlternativeValueTrajectories(x.project.id, x.review.id))!;
    expect(a).toMatchObject({
      status: "ready",
      available: true,
      measure: "cumulative",
      period: { start: "2026-01-01", end: "2028-12-31" },
      anchor: { sequence: 2, asOf: "2026-09-30", value: "4000000.00" },
      history: {
        origin: { asOf: "2026-01-01", value: "0.00" },
        checkpoints: [{ sequence: 1, asOf: "2026-03-31", value: "1000000.00" }],
      },
      notes: [],
    });
    // Semantic order (recommendation, others, client-selected); stored totals; exact differences.
    expect(a.options.map((o) => [o.label, o.totalValue, o.recommended, o.selected])).toEqual([
      ["Act now", "29000000.00", true, false],
      ["No action", "23000000.00", false, false],
      ["Delay 3 months", "27000000.00", false, true],
    ]);
    // 4D.9G: the decision comparison is Client Selected vs Cardaxia Recommendation only.
    expect(a.governed).toBe(true);
    expect(a.decisionComparison).toEqual({
      recommended: { label: "Act now", totalValue: "29000000.00" },
      selected: { label: "Delay 3 months", totalValue: "27000000.00" },
      difference: "-2000000.00",
    });
    // 4D.9N.1A: explicit stored milestones only. No action and Delay share the 30 Dec 2026 scenario assessment ($5.0m);
    // the delayed-action pivot is the note stored on Delay's milestone — never inferred from the name.
    expect(a.options.map((o) => [o.label, o.points.map((p) => [p.asOf, p.value, p.note])])).toEqual([
      [
        "Act now",
        [
          ["2027-12-31", "18000000.00", null],
          ["2028-12-31", "29000000.00", null],
        ],
      ],
      [
        "No action",
        [
          ["2026-12-30", "5000000.00", null],
          ["2027-12-31", "15000000.00", null],
          ["2028-12-31", "23000000.00", null],
        ],
      ],
      [
        "Delay 3 months",
        [
          ["2026-12-30", "5000000.00", "Management acts — delayed action"],
          ["2027-12-31", "16500000.00", null],
          ["2028-12-31", "27000000.00", null],
        ],
      ],
    ]);
    expect(a.options.every((o) => o.reconciliation.state === "reconciled")).toBe(true);
    // The anchor is composition only: no scenario point exists at the review date.
    const stored = await db()
      .select()
      .from(schema.valueTrajectoryPoint)
      .where(eq(schema.valueTrajectoryPoint.projectId, x.project.id));
    expect(stored.filter((p) => p.scenarioId && p.asOf <= "2026-09-30")).toEqual([]);

    const p = buildAlternativePresentation(a, "USD")!;
    const valued = p.rows.filter((r) => Object.keys(r.values).length > 0 || r.history !== null);
    expect(valued.map((r) => r.t)).toEqual(
      ["2026-01-01", "2026-03-31", "2026-09-30", "2026-12-30", "2027-12-31", "2028-12-31"].map(epoch),
    );
    expect(p.domain).toEqual([epoch("2026-01-01"), epoch("2028-12-31")]);
    const at = (d: string) => p.rows.find((r) => r.t === epoch(d))!;
    // Options never reach back into history.
    expect(at("2026-03-31").values).toEqual({});
    // Act now and No action leave the branch point; Delay shares No action's stored opening, drawn once, and its own
    // line starts at the stored pivot (it diverges only after 30 Dec 2026).
    expect(at("2026-09-30")).toMatchObject({
      anchor: true,
      history: 4000000,
      values: { o0: 4000000, o1: 4000000 },
      tip: ["30 Sept 2026", "Formal realised position · Review #2: $4.0m"],
    });
    expect(at("2026-12-30").values).toEqual({ o1: 5000000, o2: 5000000 });
    expect(p.series.map((s) => [s.label, s.shared])).toEqual([
      ["Act now", null],
      ["No action", null],
      ["Delay 3 months", { with: "No action", until: "2026-12-30" }],
    ]);
    expect(p.pivots).toEqual([
      {
        t: epoch("2026-12-30"),
        label: "Management acts — delayed action",
        option: "Delay 3 months",
        color: p.series[2]!.color,
      },
    ]);
    expect(at("2027-12-31").values).toEqual({ o0: 18000000, o1: 15000000, o2: 16500000 }); // diverged after the pivot
    expect(at("2027-12-31").tip).toEqual([
      "31 Dec 2027",
      "Act now: $18.0m · Cardaxia recommendation",
      "No action: $15.0m",
      "Delay 3 months: $16.5m · Client selected",
    ]);
    // 24. Every table line is one stored observation (origin, Review #1, anchor, 8 option milestones).
    expect(p.rows.flatMap((r) => r.tip.slice(1))).toHaveLength(1 + 1 + 1 + 8);

    // Monthly cursor: between the review and the pivot, Delay is stated as sharing No action's path; values are only
    // Previous / Next stored milestones; the pivot row names the stored note as an event.
    const nov = p.rows.find((r) => r.month && r.cursor.heading === "Nov 2026")!;
    const blk = (r: typeof nov, label: string) => r.cursor.blocks.find((b) => b.series === label)!;
    expect(blk(nov, "Delay 3 months")).toMatchObject({
      badges: ["Client selected"],
      note: "Same path as No action until 30 Dec 2026",
      entries: [{ tag: "Next", date: "30 Dec 2026", value: "$5.0m", detail: "Management acts — delayed action" }],
    });
    expect(blk(nov, "Act now")).toMatchObject({
      badges: ["Cardaxia recommendation"],
      entries: [{ tag: "Next", date: "31 Dec 2027", value: "$18.0m" }],
    });
    expect(blk(nov, "Realised (formal)").entries).toEqual([
      { tag: "Latest formal", date: "30 Sept 2026", value: "$4.0m", detail: "Review #2 · branch point" },
    ]);
    expect(nov.cursor.footer).toEqual([
      "Option totals at Value Period end: Act now $29.0m · No action $23.0m · Delay 3 months $27.0m",
      "Client selected − Cardaxia recommendation = -$2.0m",
    ]);
    const pivot = at("2026-12-30");
    expect(pivot.cursor.events).toEqual(["Delay 3 months: Management acts — delayed action"]);
    expect(blk(pivot, "Delay 3 months").entries).toEqual([
      { tag: "Scenario", value: "$5.0m", detail: "Management acts — delayed action" },
    ]);
    expect(blk(pivot, "No action").entries).toEqual([{ tag: "Scenario", value: "$5.0m", detail: undefined }]);
    // Proof: every tooltip money string is a stored scenario value or total, a formal realised value or the stored
    // selected − recommended difference; no value AT a value-free month.
    const governed = new Set(
      [
        ...a.options.flatMap((o) => [o.totalValue, ...o.points.map((x) => x.value)]),
        "0.00",
        ...a.history!.checkpoints.map((k) => k.value),
        a.anchor!.value,
      ].map((v) => formatMoneyShort(v, "USD")),
    );
    governed.add("-$2.0m");
    expect(
      untraced(
        p.rows.map((r) => r.cursor),
        governed,
      ),
    ).toEqual([]);
    expect(atDateWithoutObservation(p.rows)).toEqual([]);
    expect(p.labels.map((l) => [l.key, l.lines])).toEqual([
      ["o0", ["$29.0m Act now", "Cardaxia recommendation"]],
      ["o1", ["$23.0m No action"]],
      ["o2", ["$27.0m Delay 3 months", "Client selected"]],
    ]);
    expect(p.series.map((s) => [s.label, s.emphasis, s.endpointOnly])).toEqual([
      ["Act now", true, false],
      ["No action", false, false],
      ["Delay 3 months", false, false],
    ]);
    expect(p.review.label).toBe("Review #2 · 30 Sept 2026 · options assessed");

    const html = text(a);
    expect(html).toContain("Alternative Value Trajectories");
    expect(html).toContain("All options share the history to the review and differ only after it.");
    expect(html).toContain("Realised (shared history)");
    expect(html).toContain("same path as No action until 30 Dec 2026");
    expect(html).not.toContain("Difference from Cardaxia recommendation"); // no per-option difference metric
    expect(html).not.toMatch(/best|optimal|cost of delay/i);
    expect(html).not.toContain("Alternative Value Outcomes"); // no second, redundant endpoint chart
  });

  it("13. recommendation and client selection on the same option carry both labels", async () => {
    const { a } = await reviewWithOptions("cumulative_benefit", { options: [ACT, DELAY], recommend: 0, select: 0 });
    expect(a.options.map((o) => [o.label, o.recommended, o.selected])).toEqual([
      ["Act now", true, true],
      ["Delay 3 months", false, false],
    ]);
    const p = buildAlternativePresentation(a, "USD")!;
    expect(p.labels[0]!.lines).toEqual(["$29.0m Act now", "Cardaxia recommendation · Client selected"]);
    expect(a.decisionComparison!.difference).toBe("0.00");
    expect(text(a)).toContain("Client selected Cardaxia's recommendation");
  });

  it("no recommendation and no client decision: options only, no roles invented", async () => {
    const { a } = await reviewWithOptions("cumulative_benefit", { options: [ACT, NONE] });
    expect(a.options.every((o) => !o.recommended && !o.selected)).toBe(true);
    expect(a.decisionComparison).toBeNull();
    expect(a.outcomes.recommendation).toBeNull();
    expect(a.outcomes.decision).toBeNull();
    const html = text(a);
    expect(html).toContain("No recommendation issued");
    expect(html).toContain("No client decision recorded yet.");
    expect(buildAlternativePresentation(a, "USD")!.labels.every((l) => l.lines.length === 1)).toBe(true);
  });

  it("8. no valid anchor: incomplete realised at the review → no history, paths begin at their first milestones", async () => {
    const { a } = await reviewWithOptions("cumulative_benefit", {
      realised: "partial",
      earlier: "complete",
      options: [ACT, NONE],
      recommend: 0,
    });
    expect(a).toMatchObject({ anchor: null, history: null, notes: ["no_valid_anchor"] });
    const p = buildAlternativePresentation(a, "USD")!;
    // Values only at stored milestones (the review row is an event row; month rows are value-free cursor positions).
    expect(p.rows.filter((r) => Object.keys(r.values).length > 0 || r.history !== null).map((r) => r.t)).toEqual(
      ["2027-12-31", "2028-12-31"].map(epoch),
    );
    expect(p.domain[0]).toBe(epoch("2026-09-30")); // axis starts at the review, not at invented history
    expect(text(a)).toContain(
      "Review #2 does not establish a complete realised position, so each path begins at its first entered milestone.",
    );
  });

  it("1 (4D.9E correction). an all-unattributed project-level realised position anchors the branch", async () => {
    const { a } = await reviewWithOptions("cumulative_benefit", {
      realised: "unattributed",
      options: [ACT],
      recommend: 0,
    });
    expect(a.anchor).toEqual({ sequence: 1, asOf: "2026-09-30", value: "2800000.00" });
  });

  it("15/16. mixed phased and unphased options: no fabricated line; the unphased one is an end marker at its stored total", async () => {
    const { a } = await reviewWithOptions("cumulative_benefit", {
      options: [ACT, { label: "No action", total: "23000000.00" }],
      recommend: 0,
    });
    expect(a.status).toBe("ready");
    expect(a.options[1]).toMatchObject({ points: [], reconciliation: { state: "no_points" } });
    expect(a.notes).toEqual(["options_without_phasing"]);
    const p = buildAlternativePresentation(a, "USD")!;
    expect(p.series[1]).toMatchObject({ endpointOnly: true });
    // Its only observation is the stored total at the Value Period end — nothing at the anchor or in between.
    const withO1 = p.rows.filter((r) => r.values.o1 !== undefined);
    expect(withO1.map((r) => [r.t, r.values.o1])).toEqual([[epoch("2028-12-31"), 23000000]]);
    expect(p.rows.find((r) => r.anchor)!.values).toEqual({ o0: 2000000 });
    expect(p.labels[1]!.lines).toEqual(["$23.0m No action", "Phasing not entered"]);
    const html = text(a);
    expect(html).toContain(
      "Phasing not entered for No action: shown as its stored total at the Value Period end, with no path.",
    );
  });

  it("15. the recommended option may have no path: issue and finalisation succeed and it is endpoint-only", async () => {
    const { a } = await reviewWithOptions("cumulative_benefit", {
      options: [{ label: "Act now", total: "29000000.00" }, NONE],
      recommend: 0,
    });
    expect(a.outcomes.recommendation).not.toBeNull();
    expect(buildAlternativePresentation(a, "USD")!.labels[0]!.lines).toEqual([
      "$29.0m Act now",
      "Phasing not entered · Cardaxia recommendation",
    ]);
  });

  it("17. no option paths → the 4D.6 endpoint-only Alternative Value Outcomes, with the reason", async () => {
    const { a } = await reviewWithOptions("cumulative_benefit", {
      options: [
        { label: "Act now", total: "29000000.00" },
        { label: "No action", total: "23000000.00" },
      ],
      recommend: 0,
    });
    expect(a).toMatchObject({ status: "no_option_paths", available: false });
    expect(buildAlternativePresentation(a, "USD")).toBeNull();
    const html = text(a);
    expect(html).toContain("Alternative Value Outcomes");
    expect(html).toContain("Option phasing not entered, so each option is shown as its stored total.");
  });

  it("18. annual run-rate: no cumulative realised history or anchor; paths begin at their first milestones", async () => {
    const { a } = await reviewWithOptions("annual_run_rate", { options: [ACT, NONE], recommend: 0 });
    expect(a).toMatchObject({
      status: "ready",
      measure: "run_rate",
      history: null,
      anchor: null,
      notes: ["realised_run_rate_not_recorded"],
    });
    const p = buildAlternativePresentation(a, "USD")!;
    expect(p.rows.some((r) => r.anchor || r.history !== null)).toBe(false);
    const html = text(a);
    expect(html).toContain("Annual Run Rate");
    expect(html).toContain("Realised run-rate is not currently recorded");
    expect(html).not.toContain("Realised (shared history)");
  });

  it("19–22. NPV, Other, unclassified and missing period: no trajectory; endpoint outcomes retained", async () => {
    for (const [kind, status, note] of [
      ["net_present_value", "basis_not_supported", "Value trajectory is not available for NPV"],
      ["other", "basis_not_supported", "Value trajectory is not available for this Value Basis"],
      [null, "basis_not_classified", null],
    ] as const) {
      const { a } = await reviewWithOptions(kind, { options: [{ label: "Act now", total: "29000000.00" }] });
      expect(a).toMatchObject({ status, available: false, measure: null });
      const html = text(a);
      expect(html).toContain("Alternative Value Outcomes");
      if (note) expect(html).toContain(note);
      else expect(html).not.toContain("so each option is shown as its stored total"); // legacy: unchanged
    }
    const { a } = await reviewWithOptions("cumulative_benefit", {
      period: false,
      options: [{ label: "Act now", total: "29000000.00" }],
    });
    expect(a).toMatchObject({ status: "period_not_set", available: false });
    expect(text(a)).toContain("Value Period not set, so each option is shown as its stored total.");
  });

  it("23. no options", async () => {
    const { a } = await reviewWithOptions("cumulative_benefit", { options: [] });
    expect(a).toMatchObject({ status: "no_options", available: false, options: [] });
  });

  it("6. earlier incomplete realised is excluded from shared history (noted), never partially plotted", async () => {
    const { a } = await reviewWithOptions("cumulative_benefit", {
      earlier: "partial",
      options: [ACT],
      recommend: 0,
    });
    expect(a.history!.checkpoints).toEqual([]);
    expect(a.anchor!.value).toBe("2000000.00");
    expect(a.notes).toEqual(["realised_partial_excluded"]);
  });

  it("25. a finalised review's option paths are immutable and reading them writes nothing", async () => {
    const { actor, ctx, scenarios, review } = await reviewWithOptions("cumulative_benefit", {
      options: [ACT],
      recommend: 0,
    });
    const before = await db()
      .select()
      .from(schema.valueTrajectoryPoint)
      .where(eq(schema.valueTrajectoryPoint.projectId, ctx.project.id));
    await expect(
      setScenarioPoint(actor, { scenarioId: scenarios[0]!.id, asOf: "2028-06-30", value: "25000000.00" }),
    ).rejects.toThrow();
    await getAlternativeValueTrajectories(ctx.project.id, review.id);
    const after = await db()
      .select()
      .from(schema.valueTrajectoryPoint)
      .where(eq(schema.valueTrajectoryPoint.projectId, ctx.project.id));
    expect(after).toEqual(before);
  });
});
