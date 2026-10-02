import { asc, eq, inArray } from "drizzle-orm";

import { toDbMoney } from "@/domain/money";
import type { ValueBasisKind, VersionStatus } from "@/domain/statuses";
import {
  realisedComparable,
  trajectoryMeasure,
  trajectoryStatus,
  type TrajectoryMeasure,
  type TrajectoryStatus,
} from "@/domain/trajectory";
import { db, schema } from "@/server/db/client";

import { getAssuranceReviewList } from "./assurance";
import { getAlternativeValueOutcomes } from "./outcomes";
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
  /** Every financial driver had a realised value recorded at the review. */
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

export async function getValueTrajectory(projectId: string): Promise<ValueTrajectory> {
  const today = new Date().toISOString().slice(0, 10);
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
            complete: r.totals.financialDriverCount > 0 && r.totals.realisedAssessed === r.totals.financialDriverCount,
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
