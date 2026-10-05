import { and, asc, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";

import { toDbMoney } from "@/domain/money";
import type { Outcome } from "@/domain/outcomes";
import type { ValueBasisKind, VersionStatus } from "@/domain/statuses";
import {
  realisedComparable,
  realisedPositionComplete,
  terminalReconciliation,
  trajectoryMeasure,
  trajectoryStatus,
  type TerminalReconciliation,
  type TrajectoryMeasure,
  type TrajectoryStatus,
} from "@/domain/trajectory";
import type { ReportAlternatives, ReportPlan, ReportTrajectory } from "@/domain/reports";
import { db, schema } from "@/server/db/client";

import { getAssuranceReviewList } from "./assurance";
import { getAlternativeValueOutcomes, type AlternativeValueOutcomes } from "./outcomes";
import { getVersionTotal, listVersions } from "./value-case";

// Governed Value Trajectory read model (Phase 4D.9C). Structured data for the 4D.9D/E UI; no chart here.
// Only stored governed records: authorised plan points, finalised reviews' cumulative realised checkpoints and
// formal forecast points, and stored option points. Nothing is interpolated, generated or ranged, and no working
// matter or emerging-driver estimate is read. Contract: docs/architecture.md.

export type TrajectoryPoint = { id: string; asOf: string; value: string; note: string | null };

export type PlanTrajectory = {
  versionId: string;
  versionNumber: number;
  status: VersionStatus;
  authorisedOn: string | null;
  /** Governed terminal: the version's total. */
  total: string;
  points: TrajectoryPoint[];
};

export type RealisedCheckpoint = {
  reviewId: string;
  sequence: number;
  date: string;
  againstVersionNumber: number;
  /** Cumulative realised (attributed + unattributed) at the review; null when none recorded. */
  value: string | null;
  /** The review establishes a complete project-level realised position (`realisedPositionComplete`). */
  complete: boolean;
};

export type FormalForecastTrajectory = {
  reviewId: string;
  sequence: number;
  reviewDate: string;
  againstVersionNumber: number;
  /** Governed terminal: the review's formal forecast; null when incomplete. */
  forecastTotal: string | null;
  points: TrajectoryPoint[];
  /** Measured against a version of the same basis kind as the version in force. */
  comparable: boolean;
};

export type ValueTrajectory = {
  status: TrajectoryStatus;
  measure: TrajectoryMeasure | null;
  inForce: {
    versionId: string;
    versionNumber: number;
    valueBasisKind: ValueBasisKind | null;
    valuePeriodStart: string | null;
    valuePeriodEnd: string | null;
    total: string;
  } | null;
  /** Plan of the version in force, then earlier governed plans of the same kind (history, newest first). */
  plans: PlanTrajectory[];
  /** Cumulative bases only, from comparable finalised reviews; never plotted on a run-rate trajectory. */
  realised: RealisedCheckpoint[];
  /** Cumulative bases only: zero at Value Period start, by definition of the basis. */
  realisedOrigin: { asOf: string; value: "0.00" } | null;
  /** The latest finalised Assurance Review — the formal checkpoint (not Today). */
  latestFormal: FormalForecastTrajectory | null;
  /** Today (UTC date), distinct from the latest formal checkpoint. */
  today: string;
};

async function pointsBy(
  column: "valueCaseVersionId" | "assuranceReviewId" | "scenarioId",
  ids: string[],
): Promise<Map<string, TrajectoryPoint[]>> {
  const out = new Map<string, TrajectoryPoint[]>();
  if (ids.length === 0) return out;
  const t = schema.valueTrajectoryPoint;
  const rows = await db().select().from(t).where(inArray(t[column], ids)).orderBy(asc(t.asOf));
  for (const r of rows) {
    const key = r[column]!;
    out.set(key, [...(out.get(key) ?? []), { id: r.id, asOf: r.asOf, value: r.value, note: r.note }]);
  }
  return out;
}

export async function getValueTrajectory(projectId: string, opts: { today?: string } = {}): Promise<ValueTrajectory> {
  // Today defaults to the UTC date (as elsewhere in the app); tests inject it for determinism.
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const versions = await listVersions(projectId);
  const governed = versions
    .filter((v) => v.kind === "value_case" && (v.status === "authorised" || v.status === "superseded"))
    .sort((a, b) => b.versionNumber - a.versionNumber);
  const inForceRow = governed.find((v) => v.status === "authorised") ?? null;
  const kindOf = new Map(versions.map((v) => [v.versionNumber, v.valueBasisKind]));

  const sameKind = inForceRow ? governed.filter((v) => v.valueBasisKind === inForceRow.valueBasisKind) : [];
  const [planPoints, totals] = await Promise.all([
    pointsBy(
      "valueCaseVersionId",
      sameKind.map((v) => v.id),
    ),
    Promise.all(sameKind.map((v) => getVersionTotal(v.id))),
  ]);
  const plans: PlanTrajectory[] = sameKind.map((v, i) => ({
    versionId: v.id,
    versionNumber: v.versionNumber,
    status: v.status,
    authorisedOn: v.authorisedOn,
    total: toDbMoney(totals[i]!.total),
    points: planPoints.get(v.id) ?? [],
  }));
  const inForcePlan = plans.find((p) => p.status === "authorised");
  const inForce = inForceRow
    ? {
        versionId: inForceRow.id,
        versionNumber: inForceRow.versionNumber,
        valueBasisKind: inForceRow.valueBasisKind,
        valuePeriodStart: inForceRow.valuePeriodStart,
        valuePeriodEnd: inForceRow.valuePeriodEnd,
        total: inForcePlan!.total,
      }
    : null;
  const measure = trajectoryMeasure(inForce?.valueBasisKind ?? null);
  const status = trajectoryStatus(inForce, inForcePlan?.points.length ?? 0);

  const finalised = (await getAssuranceReviewList(projectId)).filter((r) => r.review.status === "finalised");
  const realised: RealisedCheckpoint[] =
    measure === "cumulative"
      ? finalised
          .filter((r) => realisedComparable(inForce!.valueBasisKind, kindOf.get(r.againstVersionNumber) ?? null))
          .map((r) => ({
            reviewId: r.review.id,
            sequence: r.review.sequence,
            date: r.review.reviewDate,
            againstVersionNumber: r.againstVersionNumber,
            value: r.totals.realisedTotal,
            complete: realisedPositionComplete(r.totals),
          }))
      : [];

  const last = finalised.at(-1) ?? null;
  const forecastPoints = await pointsBy("assuranceReviewId", last ? [last.review.id] : []);
  const latestFormal: FormalForecastTrajectory | null = last
    ? {
        reviewId: last.review.id,
        sequence: last.review.sequence,
        reviewDate: last.review.reviewDate,
        againstVersionNumber: last.againstVersionNumber,
        forecastTotal: last.totals.forecastTotal,
        points: forecastPoints.get(last.review.id) ?? [],
        comparable:
          measure !== null && (kindOf.get(last.againstVersionNumber) ?? null) === (inForce?.valueBasisKind ?? null),
      }
    : null;

  return {
    status,
    measure,
    inForce,
    plans,
    realised,
    realisedOrigin:
      measure === "cumulative" && inForce?.valuePeriodStart ? { asOf: inForce.valuePeriodStart, value: "0.00" } : null,
    latestFormal,
    today,
  };
}

export type ScenarioTrajectories = {
  reviewId: string;
  reviewDate: string;
  againstVersionNumber: number;
  valueBasisKind: ValueBasisKind | null;
  valuePeriodEnd: string | null;
  /** Options in the 4D.6 semantic order, each with its stored total and any stored path. */
  options: {
    scenarioId: string;
    label: string;
    totalValue: string;
    recommended: boolean;
    selected: boolean;
    points: TrajectoryPoint[];
  }[];
};

/** Option paths assessed at one review; they share history up to the review date. */
export async function getScenarioTrajectories(
  projectId: string,
  reviewId: string,
): Promise<ScenarioTrajectories | null> {
  const outcomes = await getAlternativeValueOutcomes(projectId, reviewId);
  if (!outcomes) return null;
  const [review] = await db()
    .select({ againstVersionId: schema.assuranceReview.againstVersionId })
    .from(schema.assuranceReview)
    .where(eq(schema.assuranceReview.id, reviewId));
  const [version] = await db()
    .select()
    .from(schema.valueCaseVersion)
    .where(eq(schema.valueCaseVersion.id, review!.againstVersionId));
  const points = await pointsBy(
    "scenarioId",
    outcomes.outcomes.map((o) => o.id),
  );
  return {
    reviewId,
    reviewDate: outcomes.review.date,
    againstVersionNumber: outcomes.review.againstVersionNumber,
    valueBasisKind: version!.valueBasisKind,
    valuePeriodEnd: version!.valuePeriodEnd,
    options: outcomes.outcomes.map((o) => ({
      scenarioId: o.id,
      label: o.label,
      totalValue: o.totalValue,
      recommended: o.recommended,
      selected: o.selected,
      points: points.get(o.id) ?? [],
    })),
  };
}

// ---------------------------------------------------------------------------
// Authoring read models (Phase 4D.9D): what the consultant edits, with display-only reconciliation status.

export type VersionTrajectoryAuthoring = {
  version: {
    id: string;
    versionNumber: number;
    status: VersionStatus;
    valueBasisKind: ValueBasisKind | null;
    valuePeriodStart: string | null;
    valuePeriodEnd: string | null;
  };
  /** The version's total (its governed terminal). */
  total: string;
  status: TrajectoryStatus;
  measure: TrajectoryMeasure | null;
  points: TrajectoryPoint[];
  reconciliation: TerminalReconciliation | null;
  editable: boolean;
  /** Kind fixed by an earlier classified governed version; a later version cannot change it. */
  inheritedKind: ValueBasisKind | null;
  /** The version a Value Change started from (re-phasing context), with its plan exactly as authorised. */
  previous: {
    versionNumber: number;
    status: VersionStatus;
    valueBasisKind: ValueBasisKind | null;
    valuePeriodStart: string | null;
    valuePeriodEnd: string | null;
    points: TrajectoryPoint[];
  } | null;
};

export async function getVersionTrajectoryAuthoring(
  projectId: string,
  versionId: string,
): Promise<VersionTrajectoryAuthoring | null> {
  const [v] = await db()
    .select()
    .from(schema.valueCaseVersion)
    .where(and(eq(schema.valueCaseVersion.id, versionId), eq(schema.valueCaseVersion.projectId, projectId)));
  if (!v || v.kind !== "value_case") return null;
  const [{ total }, points, [change], [classified]] = await Promise.all([
    getVersionTotal(v.id),
    pointsBy("valueCaseVersionId", [v.id]).then((m) => m.get(v.id) ?? []),
    db()
      .select({ fromVersionId: schema.valueChange.fromVersionId })
      .from(schema.valueChange)
      .where(eq(schema.valueChange.toVersionId, v.id)),
    db()
      .select({ kind: schema.valueCaseVersion.valueBasisKind })
      .from(schema.valueCaseVersion)
      .where(
        and(
          eq(schema.valueCaseVersion.valueCaseId, v.valueCaseId),
          ne(schema.valueCaseVersion.id, v.id),
          inArray(schema.valueCaseVersion.status, ["authorised", "superseded"]),
          isNotNull(schema.valueCaseVersion.valueBasisKind),
        ),
      )
      .orderBy(desc(schema.valueCaseVersion.versionNumber))
      .limit(1),
  ]);
  let previous: VersionTrajectoryAuthoring["previous"] = null;
  if (change) {
    const [from] = await db()
      .select()
      .from(schema.valueCaseVersion)
      .where(eq(schema.valueCaseVersion.id, change.fromVersionId));
    previous = {
      versionNumber: from!.versionNumber,
      status: from!.status,
      valueBasisKind: from!.valueBasisKind,
      valuePeriodStart: from!.valuePeriodStart,
      valuePeriodEnd: from!.valuePeriodEnd,
      points: (await pointsBy("valueCaseVersionId", [from!.id])).get(from!.id) ?? [],
    };
  }
  const measure = trajectoryMeasure(v.valueBasisKind);
  const totalStr = toDbMoney(total);
  return {
    version: {
      id: v.id,
      versionNumber: v.versionNumber,
      status: v.status,
      valueBasisKind: v.valueBasisKind,
      valuePeriodStart: v.valuePeriodStart,
      valuePeriodEnd: v.valuePeriodEnd,
    },
    total: totalStr,
    status: trajectoryStatus(v, points.length),
    measure,
    points,
    reconciliation: measure ? terminalReconciliation(points, v.valuePeriodEnd, totalStr) : null,
    editable: v.status === "draft",
    inheritedKind: classified?.kind ?? null,
    previous,
  };
}

export type ReviewTrajectoryAuthoring = {
  reviewDate: string;
  finalised: boolean;
  governing: {
    versionNumber: number;
    valueBasisKind: ValueBasisKind | null;
    valuePeriodStart: string | null;
    valuePeriodEnd: string | null;
  };
  status: TrajectoryStatus;
  measure: TrajectoryMeasure | null;
  forecast: {
    /** The review's formal forecast (governed terminal); null while incomplete. */
    total: string | null;
    points: TrajectoryPoint[];
    reconciliation: TerminalReconciliation | null;
    editable: boolean;
  };
  recommendationIssued: boolean;
  /** Phase 4D.10G: in internal review or ready to issue — option paths read-only until returned. */
  recommendationInReview: boolean;
  options: {
    scenarioId: string;
    label: string;
    totalValue: string;
    points: TrajectoryPoint[];
    reconciliation: TerminalReconciliation | null;
    editable: boolean;
  }[];
};

/** Forecast and option-path authoring for one review. `forecastTotal` is the review's formal forecast (or null). */
export async function getReviewTrajectoryAuthoring(
  projectId: string,
  reviewId: string,
  forecastTotal: string | null,
): Promise<ReviewTrajectoryAuthoring | null> {
  const [r] = await db()
    .select()
    .from(schema.assuranceReview)
    .where(and(eq(schema.assuranceReview.id, reviewId), eq(schema.assuranceReview.projectId, projectId)));
  if (!r) return null;
  const [[v], options, [rec]] = await Promise.all([
    db().select().from(schema.valueCaseVersion).where(eq(schema.valueCaseVersion.id, r.againstVersionId)),
    db()
      .select()
      .from(schema.scenario)
      .where(eq(schema.scenario.assuranceReviewId, r.id))
      .orderBy(asc(schema.scenario.sortOrder), asc(schema.scenario.createdAt)),
    db()
      .select({
        issuedAt: schema.recommendation.issuedAt,
        internalReviewStatus: schema.recommendation.internalReviewStatus,
      })
      .from(schema.recommendation)
      .where(eq(schema.recommendation.assuranceReviewId, r.id)),
  ]);
  const [forecastPoints, optionPoints] = await Promise.all([
    pointsBy("assuranceReviewId", [r.id]),
    pointsBy(
      "scenarioId",
      options.map((o) => o.id),
    ),
  ]);
  const measure = trajectoryMeasure(v!.valueBasisKind);
  const finalised = r.status === "finalised";
  const issued = Boolean(rec?.issuedAt);
  // Phase 4D.10G: option paths are read-only (not frozen) while the recommendation is in internal review.
  const inReview =
    !issued && (rec?.internalReviewStatus === "in_internal_review" || rec?.internalReviewStatus === "ready_to_issue");
  const fp = forecastPoints.get(r.id) ?? [];
  // Status of the governing version's setup (phasing here means this review's forecast milestones).
  const status = trajectoryStatus(v!, fp.length);
  return {
    reviewDate: r.reviewDate,
    finalised,
    governing: {
      versionNumber: v!.versionNumber,
      valueBasisKind: v!.valueBasisKind,
      valuePeriodStart: v!.valuePeriodStart,
      valuePeriodEnd: v!.valuePeriodEnd,
    },
    status,
    measure,
    forecast: {
      total: forecastTotal,
      points: fp,
      reconciliation: measure ? terminalReconciliation(fp, v!.valuePeriodEnd, forecastTotal) : null,
      editable: !finalised,
    },
    recommendationIssued: issued,
    recommendationInReview: inReview,
    options: options.map((o) => {
      const points = optionPoints.get(o.id) ?? [];
      return {
        scenarioId: o.id,
        label: o.label,
        totalValue: o.totalValue,
        points,
        reconciliation: measure ? terminalReconciliation(points, v!.valuePeriodEnd, o.totalValue) : null,
        editable: !finalised && !issued && !inReview,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Primary Value Trajectory chart model (Phase 4D.9E). Composition only — which governed records are drawn and why
// others are not. Every value is a stored governed amount; the single presentation addition is the forecast's
// visual anchor, which reuses the latest review's own realised checkpoint (never stored as a trajectory point).

/** Why part of the chart is absent, shown as a concise note. */
export type TrajectoryChartNote =
  | "plan_phasing_not_entered"
  | "no_formal_position"
  | "forecast_phasing_not_entered"
  | "forecast_not_comparable"
  | "formal_measured_against_earlier_version"
  | "realised_run_rate_not_recorded"
  | "realised_partial_excluded";

export type ValueTrajectoryChart = {
  /** Unavailable when the version in force cannot carry a trajectory (no basis, unsupported basis, no period). */
  available: boolean;
  status: TrajectoryStatus;
  measure: TrajectoryMeasure | null;
  valueBasisKind: ValueBasisKind | null;
  period: { start: string; end: string } | null;
  version: { versionNumber: number; total: string } | null;
  /** Explicit plan points of the CURRENT authorised version only (earlier plans stay in history). */
  plan: TrajectoryPoint[];
  /** Cumulative bases only: zero origin at period start and complete governed checkpoints within the period. */
  realised: {
    origin: { asOf: string; value: "0.00" } | null;
    checkpoints: { sequence: number; asOf: string; value: string }[];
    /** Finalised reviews whose realised value is not plotted (incomplete, not recorded, or outside the period). */
    excluded: { sequence: number; reason: "incomplete" | "not_recorded" | "outside_period" }[];
  } | null;
  /** The latest finalised Assurance Review: the formal checkpoint (not Today). */
  latestFormal: {
    sequence: number;
    reviewDate: string;
    againstVersionNumber: number;
    forecastTotal: string | null;
  } | null;
  /** The latest review's forecast milestones, anchored visually on its realised checkpoint where valid. */
  forecast: {
    reviewDate: string;
    anchor: { asOf: string; value: string } | null;
    points: TrajectoryPoint[];
  } | null;
  today: { asOf: string; inPeriod: boolean };
  /**
   * Phase 4D.9G event: the authorised Value Change that created the version in force (its plan is the line drawn),
   * at its authorisation date. Null for V1, or when no authorised Value Change created the version.
   */
  versionChange: { code: string; versionNumber: number; authorisedOn: string; inPeriod: boolean } | null;
  notes: TrajectoryChartNote[];
};

export async function getValueTrajectoryChart(
  projectId: string,
  opts: { today?: string } = {},
): Promise<ValueTrajectoryChart> {
  const t = await getValueTrajectory(projectId, opts);
  const inForce = t.inForce;
  const period =
    inForce?.valuePeriodStart && inForce.valuePeriodEnd
      ? { start: inForce.valuePeriodStart, end: inForce.valuePeriodEnd }
      : null;
  const available = t.measure !== null && period !== null;
  const within = (d: string) => period !== null && d >= period.start && d <= period.end;
  const plan = available ? (t.plans.find((p) => p.status === "authorised")?.points ?? []) : [];
  const notes: TrajectoryChartNote[] = [];
  if (available && plan.length === 0) notes.push("plan_phasing_not_entered");

  let realised: ValueTrajectoryChart["realised"] = null;
  if (available && t.measure === "cumulative") {
    const checkpoints: { sequence: number; asOf: string; value: string }[] = [];
    const excluded: { sequence: number; reason: "incomplete" | "not_recorded" | "outside_period" }[] = [];
    for (const r of t.realised) {
      if (r.value === null) excluded.push({ sequence: r.sequence, reason: "not_recorded" });
      else if (!r.complete) excluded.push({ sequence: r.sequence, reason: "incomplete" });
      else if (!within(r.date)) excluded.push({ sequence: r.sequence, reason: "outside_period" });
      else checkpoints.push({ sequence: r.sequence, asOf: r.date, value: r.value });
    }
    if (excluded.some((e) => e.reason === "incomplete")) notes.push("realised_partial_excluded");
    realised = { origin: { asOf: period!.start, value: "0.00" }, checkpoints, excluded };
  }
  if (available && t.measure === "run_rate") notes.push("realised_run_rate_not_recorded");

  const last = t.latestFormal;
  const latestFormal = last
    ? {
        sequence: last.sequence,
        reviewDate: last.reviewDate,
        againstVersionNumber: last.againstVersionNumber,
        forecastTotal: last.forecastTotal,
      }
    : null;
  let forecast: ValueTrajectoryChart["forecast"] = null;
  if (available) {
    if (!last) notes.push("no_formal_position");
    else if (!last.comparable) notes.push("forecast_not_comparable");
    else {
      if (inForce && last.againstVersionNumber !== inForce.versionNumber) {
        notes.push("formal_measured_against_earlier_version");
      }
      if (last.points.length === 0) notes.push("forecast_phasing_not_entered");
      else {
        const own = realised?.checkpoints.find((c) => c.sequence === last.sequence) ?? null;
        forecast = {
          reviewDate: last.reviewDate,
          anchor: own ? { asOf: own.asOf, value: own.value } : null,
          points: last.points,
        };
      }
    }
  }

  const [vc] =
    available && inForce
      ? await db()
          .select({ code: schema.valueChange.code, authorisedOn: schema.valueChange.authorisedOn })
          .from(schema.valueChange)
          .where(
            and(eq(schema.valueChange.toVersionId, inForce.versionId), eq(schema.valueChange.status, "authorised")),
          )
      : [];
  const versionChange =
    vc?.authorisedOn && inForce
      ? {
          code: vc.code,
          versionNumber: inForce.versionNumber,
          authorisedOn: vc.authorisedOn,
          inPeriod: within(vc.authorisedOn),
        }
      : null;

  return {
    available,
    status: t.status,
    measure: t.measure,
    valueBasisKind: inForce?.valueBasisKind ?? null,
    period,
    version: inForce ? { versionNumber: inForce.versionNumber, total: inForce.total } : null,
    plan,
    realised,
    latestFormal,
    forecast,
    today: { asOf: t.today, inPeriod: within(t.today) },
    versionChange,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Alternative Value Trajectories (Phase 4D.9F). The option paths assessed at ONE Assurance Review: shared governed
// history up to the review, then each stored option's explicit milestones to the Value Period end. Composition only:
// every value is a stored governed amount. The single presentation addition is the branch anchor — the review's own
// complete realised position — which is never stored as a scenario point.

export type AlternativeTrajectoryStatus =
  "basis_not_classified" | "basis_not_supported" | "period_not_set" | "no_options" | "no_option_paths" | "ready";

export type AlternativeTrajectoryNote =
  | "no_valid_anchor"
  | "draft_no_anchor"
  | "draft_forecast_phasing_not_entered"
  | "realised_run_rate_not_recorded"
  | "realised_partial_excluded"
  | "options_without_phasing"
  | "path_not_reconciled";

export type AlternativeTrajectoryOption = {
  scenarioId: string;
  label: string;
  kind: Outcome["kind"];
  narrative: string | null;
  /** Stored option total: the option's value at the Value Period end (its governed terminal). */
  totalValue: string;
  recommended: boolean;
  selected: boolean;
  /** Explicit stored milestones (after the review date); empty = phasing not entered. */
  points: TrajectoryPoint[];
  reconciliation: TerminalReconciliation;
  /** Saved as Cardaxia's recommendation but NOT issued (draft preview only; never a governed role). */
  pendingRecommendation: boolean;
};

export type AlternativeValueTrajectories = {
  status: AlternativeTrajectoryStatus;
  /** The review is finalised: a governed record. A draft review is a non-governed preview only. */
  governed: boolean;
  /** A time-based chart can be drawn (at least one option has explicit milestones). */
  available: boolean;
  measure: TrajectoryMeasure | null;
  valueBasisKind: ValueBasisKind | null;
  /** Governing Value Period: that of the version the review measured against. */
  period: { start: string; end: string } | null;
  /**
   * Cumulative only: zero origin and earlier finalised reviews' complete realised positions. Shown with a valid anchor
   * (finalised review) or, on a draft preview, as governed history only (the draft's own realised is never an anchor).
   */
  history: {
    origin: { asOf: string; value: "0.00" };
    checkpoints: { sequence: number; asOf: string; value: string }[];
  } | null;
  /** Cumulative only: this finalised review's own complete realised position, at its review date. */
  anchor: { sequence: number; asOf: string; value: string } | null;
  /** In the 4D.6 semantic order (recommendation, other options, client-selected); never ranked by value. */
  options: AlternativeTrajectoryOption[];
  /**
   * Draft preview only (Phase 4D.9H): this draft review's explicitly entered forecast milestones — the working baseline
   * the options are assessed against. Never a governed Formal Forecast; null on a finalised review or without points.
   */
  draftForecast: { points: TrajectoryPoint[] } | null;
  notes: AlternativeTrajectoryNote[];
  /**
   * Client Selected vs Cardaxia Recommendation (stored totals; selected − recommended, exact decimal). Only when a client
   * decision exists against an issued recommendation; never for every option.
   */
  decisionComparison: {
    recommended: { label: string; totalValue: string };
    selected: { label: string; totalValue: string };
    difference: string;
  } | null;
  /** The point-in-time decision economics of the same review (summary, references, endpoint fallback). */
  outcomes: AlternativeValueOutcomes;
};

export async function getAlternativeValueTrajectories(
  projectId: string,
  reviewId: string,
): Promise<AlternativeValueTrajectories | null> {
  const outcomes = await getAlternativeValueOutcomes(projectId, reviewId);
  if (!outcomes) return null;
  const [[review], versions, reviews, [savedRec]] = await Promise.all([
    db()
      .select({ againstVersionId: schema.assuranceReview.againstVersionId })
      .from(schema.assuranceReview)
      .where(eq(schema.assuranceReview.id, reviewId)),
    listVersions(projectId),
    getAssuranceReviewList(projectId),
    db()
      .select({ scenarioId: schema.recommendation.scenarioId, issuedAt: schema.recommendation.issuedAt })
      .from(schema.recommendation)
      .where(eq(schema.recommendation.assuranceReviewId, reviewId)),
  ]);
  const pendingId = savedRec && !savedRec.issuedAt ? savedRec.scenarioId : null;
  const governing = versions.find((v) => v.id === review!.againstVersionId)!;
  const kind = governing.valueBasisKind;
  const measure = trajectoryMeasure(kind);
  const period =
    governing.valuePeriodStart && governing.valuePeriodEnd
      ? { start: governing.valuePeriodStart, end: governing.valuePeriodEnd }
      : null;
  const within = (d: string) => period !== null && d >= period.start && d <= period.end;

  const pathPoints = await pointsBy(
    "scenarioId",
    outcomes.outcomes.map((o) => o.id),
  );
  const options: AlternativeTrajectoryOption[] = outcomes.outcomes.map((o) => {
    const points = measure && period ? (pathPoints.get(o.id) ?? []) : [];
    return {
      scenarioId: o.id,
      label: o.label,
      kind: o.kind,
      narrative: o.narrative,
      totalValue: o.totalValue,
      recommended: o.recommended,
      selected: o.selected,
      points,
      reconciliation: terminalReconciliation(points, period?.end ?? null, o.totalValue),
      pendingRecommendation: o.id === pendingId,
    };
  });

  const status: AlternativeTrajectoryStatus =
    kind === null
      ? "basis_not_classified"
      : measure === null
        ? "basis_not_supported"
        : period === null
          ? "period_not_set"
          : options.length === 0
            ? "no_options"
            : options.every((o) => o.points.length === 0)
              ? "no_option_paths"
              : "ready";
  const available = status === "ready";
  const notes: AlternativeTrajectoryNote[] = [];
  let history: AlternativeValueTrajectories["history"] = null;
  let anchor: AlternativeValueTrajectories["anchor"] = null;

  const self = reviews.find((r) => r.review.id === reviewId)!;
  const governed = self.review.status === "finalised";
  if (available && measure === "cumulative") {
    const kindOf = new Map(versions.map((v) => [v.versionNumber, v.valueBasisKind]));
    if (governed && realisedPositionComplete(self.totals) && within(self.review.reviewDate)) {
      anchor = { sequence: self.review.sequence, asOf: self.review.reviewDate, value: self.totals.realisedTotal! };
    } else notes.push(governed ? "no_valid_anchor" : "draft_no_anchor");
    if (anchor || !governed) {
      // Shared history: earlier finalised reviews only (never later ones), on the same basis kind, complete, in period.
      const earlier = reviews.filter(
        (r) =>
          r.review.status === "finalised" &&
          r.review.sequence < self.review.sequence &&
          realisedComparable(kind, kindOf.get(r.againstVersionNumber) ?? null) &&
          r.totals.realisedTotal !== null &&
          within(r.review.reviewDate),
      );
      if (earlier.some((r) => !realisedPositionComplete(r.totals))) notes.push("realised_partial_excluded");
      history = {
        origin: { asOf: period!.start, value: "0.00" },
        checkpoints: earlier
          .filter((r) => realisedPositionComplete(r.totals))
          .map((r) => ({ sequence: r.review.sequence, asOf: r.review.reviewDate, value: r.totals.realisedTotal! })),
      };
      // A draft preview without any earlier governed checkpoint has no history to show (a lone origin is not history).
      if (!anchor && history.checkpoints.length === 0) history = null;
    }
  }
  if (available && measure === "run_rate") notes.push("realised_run_rate_not_recorded");
  let draftForecast: AlternativeValueTrajectories["draftForecast"] = null;
  if (available && !governed) {
    const fp = (await pointsBy("assuranceReviewId", [reviewId])).get(reviewId) ?? [];
    if (fp.length) draftForecast = { points: fp };
    else notes.push("draft_forecast_phasing_not_entered");
  }
  if (available && options.some((o) => o.points.length === 0)) notes.push("options_without_phasing");
  if (available && options.some((o) => o.points.length > 0 && o.reconciliation.state !== "reconciled")) {
    notes.push("path_not_reconciled");
  }

  const rec = outcomes.outcomes.find((o) => o.recommended);
  const sel = outcomes.outcomes.find((o) => o.selected);
  const decisionComparison =
    rec && sel && outcomes.differenceFromRecommendation !== null
      ? {
          recommended: { label: rec.label, totalValue: rec.totalValue },
          selected: { label: sel.label, totalValue: sel.totalValue },
          difference: outcomes.differenceFromRecommendation,
        }
      : null;

  return {
    status,
    governed,
    available,
    measure,
    valueBasisKind: kind,
    period,
    history,
    anchor,
    options,
    draftForecast,
    notes,
    decisionComparison,
    outcomes,
  };
}

// ---------------------------------------------------------------------------
// Report snapshots (Phase 4D.9J, model v3). Built once at report build/issue time and stored verbatim in the issued
// snapshot; the report renderer never reads live trajectory data. Same governed semantics as the application's
// charts, taken AS AT the report subject (a version, or one Assurance Review) — never "today".

/** One version's plan as recorded (basis, period, milestones, total, availability). */
export async function getVersionPlanSnapshot(versionId: string): Promise<ReportPlan> {
  const [v] = await db().select().from(schema.valueCaseVersion).where(eq(schema.valueCaseVersion.id, versionId));
  const [{ total }, points] = await Promise.all([
    getVersionTotal(v!.id),
    pointsBy("valueCaseVersionId", [v!.id]).then((m) => m.get(v!.id) ?? []),
  ]);
  const supported = trajectoryMeasure(v!.valueBasisKind) !== null && v!.valuePeriodStart && v!.valuePeriodEnd;
  return {
    versionNumber: v!.versionNumber,
    status: v!.status,
    valueBasisKind: v!.valueBasisKind,
    period: v!.valuePeriodStart && v!.valuePeriodEnd ? { start: v!.valuePeriodStart, end: v!.valuePeriodEnd } : null,
    total: toDbMoney(total),
    milestones: supported ? points.map((p) => ({ asOf: p.asOf, value: p.value })) : [],
    availability: trajectoryStatus(v!, points.length),
  };
}

/**
 * The primary Value Trajectory as at one review: the plan of the version it measured against; realised positions of
 * finalised reviews up to and including it (cumulative, comparable, complete, in period); its own forecast milestones,
 * anchored on its own complete realised position; the authorised Value Change that created that version.
 */
export async function getReviewTrajectorySnapshot(projectId: string, reviewId: string): Promise<ReportTrajectory> {
  const [[review], versions, reviews] = await Promise.all([
    db().select().from(schema.assuranceReview).where(eq(schema.assuranceReview.id, reviewId)),
    listVersions(projectId),
    getAssuranceReviewList(projectId),
  ]);
  const plan = await getVersionPlanSnapshot(review!.againstVersionId);
  const measure = trajectoryMeasure(plan.valueBasisKind);
  const available = measure !== null && plan.period !== null;
  const within = (d: string) => plan.period !== null && d >= plan.period.start && d <= plan.period.end;
  const kindOf = new Map(versions.map((v) => [v.versionNumber, v.valueBasisKind]));
  const notes: ReportTrajectory["notes"] = [];
  if (available && plan.milestones.length === 0) notes.push("plan_phasing_not_entered");

  let realised: ReportTrajectory["realised"] = null;
  if (available && measure === "cumulative") {
    const checkpoints: { sequence: number; asOf: string; value: string }[] = [];
    const excluded: { sequence: number; reason: "incomplete" | "not_recorded" | "outside_period" }[] = [];
    for (const r of reviews) {
      const isSelf = r.review.id === reviewId;
      if (!isSelf && (r.review.status !== "finalised" || r.review.sequence > review!.sequence)) continue;
      if (!realisedComparable(plan.valueBasisKind, kindOf.get(r.againstVersionNumber) ?? null)) continue;
      if (r.totals.realisedTotal === null) excluded.push({ sequence: r.review.sequence, reason: "not_recorded" });
      else if (!realisedPositionComplete(r.totals))
        excluded.push({ sequence: r.review.sequence, reason: "incomplete" });
      else if (!within(r.review.reviewDate)) excluded.push({ sequence: r.review.sequence, reason: "outside_period" });
      else checkpoints.push({ sequence: r.review.sequence, asOf: r.review.reviewDate, value: r.totals.realisedTotal });
    }
    if (excluded.some((e) => e.reason === "incomplete")) notes.push("realised_partial_excluded");
    realised = { origin: { asOf: plan.period!.start, value: "0.00" }, checkpoints, excluded };
  }
  if (available && measure === "run_rate") notes.push("realised_run_rate_not_recorded");

  const self = reviews.find((r) => r.review.id === reviewId)!;
  let forecast: ReportTrajectory["forecast"] = null;
  if (available) {
    const fp = (await pointsBy("assuranceReviewId", [reviewId])).get(reviewId) ?? [];
    if (fp.length === 0) notes.push("forecast_phasing_not_entered");
    else {
      const own = realised?.checkpoints.find((c) => c.sequence === self.review.sequence) ?? null;
      forecast = {
        anchor: own ? { asOf: own.asOf, value: own.value } : null,
        points: fp.map((p) => ({ asOf: p.asOf, value: p.value })),
      };
    }
  }

  const [vc] = await db()
    .select({ code: schema.valueChange.code, authorisedOn: schema.valueChange.authorisedOn })
    .from(schema.valueChange)
    .where(
      and(eq(schema.valueChange.toVersionId, review!.againstVersionId), eq(schema.valueChange.status, "authorised")),
    );
  return {
    plan,
    measure: available ? measure : null,
    realised,
    formal: {
      sequence: self.review.sequence,
      reviewDate: self.review.reviewDate,
      forecastTotal: self.totals.forecastTotal,
    },
    forecast,
    versionChange:
      vc?.authorisedOn && available
        ? { code: vc.code, versionNumber: plan.versionNumber, authorisedOn: vc.authorisedOn }
        : null,
    notes,
  };
}

/** Alternative Value Trajectories for a report: null unless at least one option has explicit milestones. */
export async function getAlternativesSnapshot(projectId: string, reviewId: string): Promise<ReportAlternatives | null> {
  const a = await getAlternativeValueTrajectories(projectId, reviewId);
  if (!a || !a.available || !a.measure || !a.period) return null;
  return {
    measure: a.measure,
    period: a.period,
    history: a.history,
    anchor: a.anchor,
    options: a.options.map((o) => ({
      label: o.label,
      kind: o.kind,
      totalValue: o.totalValue,
      recommended: o.recommended,
      selected: o.selected,
      milestones: o.points.map((p) => ({ asOf: p.asOf, value: p.value })),
      reconciled: o.reconciliation.state === "reconciled",
    })),
    notes: a.notes.filter(
      (n): n is ReportAlternatives["notes"][number] =>
        n !== "draft_no_anchor" && n !== "draft_forecast_phasing_not_entered",
    ),
    decisionComparison: a.decisionComparison,
  };
}
