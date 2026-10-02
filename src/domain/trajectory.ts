import type { ValueBasisKind } from "./statuses";

// Value Trajectory domain (Phase 4D.9C). Contract: docs/architecture.md, "Value Trajectory methodology contract".
// Pure classification only — no values are derived, interpolated or generated here.

/** What a trajectory value means on a basis that supports trajectories. */
export type TrajectoryMeasure = "cumulative" | "run_rate";

/** cumulative_benefit → cumulative; annual_run_rate → run-rate; NPV / other / unclassified → no trajectory. */
export function trajectoryMeasure(kind: ValueBasisKind | null): TrajectoryMeasure | null {
  if (kind === "cumulative_benefit") return "cumulative";
  if (kind === "annual_run_rate") return "run_rate";
  return null;
}

/**
 * Why a governed trajectory can or cannot be shown for a version, most fundamental reason first.
 * Every non-ready state is a valid (legacy or deliberate) state, never an error.
 */
export type TrajectoryStatus =
  | "no_authorised_version"
  | "basis_not_classified"
  | "basis_not_supported"
  | "period_not_set"
  | "phasing_not_entered"
  | "ready";

export function trajectoryStatus(
  version: {
    valueBasisKind: ValueBasisKind | null;
    valuePeriodStart: string | null;
    valuePeriodEnd: string | null;
  } | null,
  planPointCount: number,
): TrajectoryStatus {
  if (!version) return "no_authorised_version";
  if (version.valueBasisKind === null) return "basis_not_classified";
  if (trajectoryMeasure(version.valueBasisKind) === null) return "basis_not_supported";
  if (!version.valuePeriodStart || !version.valuePeriodEnd) return "period_not_set";
  if (planPointCount === 0) return "phasing_not_entered";
  return "ready";
}

/**
 * Cumulative realised value is comparable with a trajectory only on a cumulative basis, and only when the review
 * was measured against a version classified with the same kind (no silent conversion between bases).
 */
export function realisedComparable(inForceKind: ValueBasisKind | null, againstKind: ValueBasisKind | null): boolean {
  return inForceKind === "cumulative_benefit" && againstKind === inForceKind;
}
