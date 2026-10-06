import { firstNeedingAttention, todayIso, type AttentionItem } from "@/domain/attention";
import type { PositionTotals } from "@/domain/assurance";
import type { RequirementStatus } from "@/domain/assurance-cadence";
import type { LeakageAmounts, LeakageSummary } from "@/domain/response";
import type { AssuranceStage } from "@/domain/statuses";

import { getValueCaseEvolution } from "./evolution";
import { getGovernanceState, type GovernanceState } from "./governance";
import { getLatestValueDecision, type LatestValueDecision } from "./outcomes";
import { getValueTrajectoryChart, type ValueTrajectoryChart } from "./trajectory";
import { loadVersionDrivers } from "./value-case";
import { getValueCaseSummary, type ValueCaseSummary } from "./value-case-summary";
import { getOverviewValueOfficeState } from "./workspace";

// Executive Overview (Phase 4D.9I): one composition of existing read models, in the order the page tells the story —
// value position → Value Trajectory → value requiring attention → latest value decision → governed commitment.
// Nothing is recalculated: every amount comes from the existing governed (or explicitly working) read models.

export type AttentionMatter = {
  id: string;
  code: string;
  title: string;
  stage: AssuranceStage | null;
  ownerName: string | null;
  drivers: { code: string; name: string | null }[];
  /** Conditions other than "not yet quantified", most pressing first (existing derivation). */
  conditions: AttentionItem[];
  /** Latest finalised review's formal Value Leakage for the matter (Total = Recoverable + Unrecoverable). */
  formal: { reviewSequence: number; amounts: LeakageAmounts } | null;
  /** The consultant's living working assessment — never formal. */
  working: LeakageAmounts | null;
};

export type ExecutiveOverview = {
  currency: string;
  authorised: { versionNumber: number; total: string | null } | null;
  /** The latest finalised Assurance Review: the formal position and the date it was established. */
  formal: {
    reviewId: string;
    sequence: number;
    date: string;
    againstVersionNumber: number;
    totals: PositionTotals;
  } | null;
  nextRequirement: { label: string; date: string | null; status: RequirementStatus } | null;
  trajectory: ValueTrajectoryChart;
  attention: {
    openCount: number;
    needsAttentionCount: number;
    /** Selected by firstNeedingAttention (existing condition order, then matter code) — not a materiality ranking. */
    matter: AttentionMatter | null;
    /** Existing governed summary: open matters' latest finalised assessments (independent of Value Gap). */
    formalLeakage: LeakageSummary;
    openLeakageCount: number;
    /** Phase 4D.10H: working (never formal) view and visibility of what is outstanding. */
    working: { total: string | null };
    evidenceOutstanding: { items: number; matters: number };
    remediation: { planned: number; unplanned: number; monitored: number };
    /** Phase 4D.13: small operational signals — overdue request items and evidence needing classification. */
    operational: { overdueRequestItems: number; evidenceNeedingClassification: number };
  };
  /** Phase 4D.10H: what is happening in governance, and the one next governed action. */
  governance: GovernanceState;
  /** Latest recorded management value decision (any finalised review) and any recommendation awaiting decision. */
  decision: LatestValueDecision;
  valueCase: ValueCaseSummary;
};

export async function getExecutiveOverview(projectId: string, today = todayIso()): Promise<ExecutiveOverview> {
  const [state, evolution, decision, trajectory, governance] = await Promise.all([
    getOverviewValueOfficeState(projectId, today),
    getValueCaseEvolution(projectId),
    getLatestValueDecision(projectId),
    getValueTrajectoryChart(projectId, { today }),
    getGovernanceState(projectId),
  ]);
  const { position, cadence, response, workspace } = state;
  const valueCase = await getValueCaseSummary(projectId, evolution);

  const focal = firstNeedingAttention(workspace.matters);
  const names = position.authorised
    ? new Map((await loadVersionDrivers(position.authorised.id)).map((d) => [d.valueDriverId, d.name]))
    : new Map<string, string>();
  const matter: AttentionMatter | null = focal
    ? {
        id: focal.entry.leakage.id,
        code: focal.entry.leakage.code,
        title: focal.entry.leakage.title,
        stage: focal.entry.leakage.stage,
        ownerName: focal.entry.ownerName,
        drivers: focal.entry.drivers.map((d) => ({ code: d.code, name: names.get(d.valueDriverId) ?? null })),
        conditions: focal.attention.filter((a) => a.kind !== "unquantified"),
        formal: focal.entry.latestFinalised
          ? { reviewSequence: focal.entry.latestFinalised.reviewSequence, amounts: focal.entry.latestFinalised.amounts }
          : null,
        working: focal.entry.working,
      }
    : null;

  const latest = position.latest;
  return {
    currency: evolution.currency,
    authorised: position.authorised
      ? { versionNumber: position.authorised.versionNumber, total: position.authorisedTotal }
      : null,
    formal: latest
      ? {
          reviewId: latest.review.id,
          sequence: latest.review.sequence,
          date: latest.review.reviewDate,
          againstVersionNumber: latest.againstVersionNumber,
          totals: latest.totals,
        }
      : null,
    nextRequirement: cadence.next
      ? { label: cadence.next.label, date: cadence.next.date ?? null, status: cadence.next.status }
      : null,
    trajectory,
    attention: {
      openCount: workspace.working.openCount,
      needsAttentionCount: workspace.attention.needsAttention,
      matter,
      formalLeakage: response.leakage,
      openLeakageCount: response.openLeakageCount,
      working: { total: workspace.working.total },
      evidenceOutstanding: workspace.evidenceOutstanding,
      remediation: workspace.remediation,
      operational: state.operational,
    },
    governance,
    decision,
    valueCase,
  };
}
