import { money, toDbMoney } from "./money";
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

/**
 * Whether a finalised review establishes a complete PROJECT-LEVEL realised position that a trajectory may plot
 * (PMO decision, Phase 4D.9F). Realised value is project-level: attribution to drivers is not required, so either
 * - every financial driver has a realised value (plus any unattributed realised value); or
 * - no driver-level realised value is recorded and the review formally records the whole position as unattributed
 *   realised value (a project-level aggregate, which always carries its rationale).
 * A position recorded for only some drivers stays incomplete — even with an unattributed amount alongside, the review
 * does not say whether the unassessed drivers are covered by it — and is never plotted as a partial total.
 */
export function realisedPositionComplete(t: {
  financialDriverCount: number;
  realisedAssessed: number;
  unattributedRealised: string | null;
  realisedTotal: string | null;
}): boolean {
  if (t.realisedTotal === null) return false;
  if (t.financialDriverCount > 0 && t.realisedAssessed === t.financialDriverCount) return true;
  return t.realisedAssessed === 0 && t.unattributedRealised !== null;
}

// ---------------------------------------------------------------------------
// Authoring support (Phase 4D.9D). Display-only status: the database gates (drizzle/0020) remain the authority.

export type Milestone = { asOf: string; value: string };

/** Chronological order regardless of creation order (ISO dates sort lexically). */
export function sortMilestones<T extends Milestone>(points: readonly T[]): T[] {
  return [...points].sort((a, b) => a.asOf.localeCompare(b.asOf));
}

/**
 * How a line's milestones stand against its governed terminal amount. Drafts may be in any state; the lifecycle gate
 * (proposal, recommendation issue, finalisation) refuses anything but `no_points` or `reconciled`.
 * - no_points: phasing not entered (always allowed)
 * - no_terminal: no milestone on the Value Period end
 * - governed_missing: the governed amount does not exist yet (e.g. incomplete formal forecast)
 * - mismatch: the period-end milestone differs from the governed amount (`difference` = milestone − governed)
 */
export type TerminalReconciliation =
  | { state: "no_points" }
  | { state: "no_terminal"; periodEnd: string }
  | { state: "governed_missing"; terminal: string | null }
  | { state: "mismatch"; terminal: string; governed: string; difference: string }
  | { state: "reconciled"; terminal: string; governed: string };

export function terminalReconciliation(
  points: readonly Milestone[],
  periodEnd: string | null,
  governed: string | null,
): TerminalReconciliation {
  if (points.length === 0) return { state: "no_points" };
  const terminal = periodEnd ? (points.find((p) => p.asOf === periodEnd)?.value ?? null) : null;
  if (governed === null) return { state: "governed_missing", terminal };
  if (terminal === null) return { state: "no_terminal", periodEnd: periodEnd ?? "" };
  if (!money(terminal).equals(money(governed))) {
    return { state: "mismatch", terminal, governed, difference: toDbMoney(money(terminal).minus(money(governed))) };
  }
  return { state: "reconciled", terminal, governed };
}

/** A draft plan against the plan it was copied from (Value Change re-phasing context). Equality only, no arithmetic. */
export type PhasingChange = "unchanged" | "changed" | "added";

export function comparePhasing(
  draft: readonly Milestone[],
  previous: readonly Milestone[],
): { changes: Map<string, PhasingChange>; removed: Milestone[]; anyChange: boolean } {
  const prev = new Map(previous.map((p) => [p.asOf, p.value]));
  const changes = new Map<string, PhasingChange>();
  for (const p of draft) {
    const before = prev.get(p.asOf);
    changes.set(
      p.asOf,
      before === undefined ? "added" : money(before).equals(money(p.value)) ? "unchanged" : "changed",
    );
  }
  const removed = previous.filter((p) => !draft.some((d) => d.asOf === p.asOf));
  return { changes, removed, anyChange: removed.length > 0 || [...changes.values()].some((c) => c !== "unchanged") };
}
