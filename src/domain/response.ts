import { money, sumMoney, toDbMoney } from "./money";
import type { ScenarioKind } from "./statuses";

// Management-response calculations (Phase 3). Differences only: scenario values
// are consultant-entered and never derived here (no cost-of-delay engine), and
// Value Leakage is never reconciled to Value Gap.

const diff = (a: string, b: string) => toDbMoney(money(a).minus(money(b)));

export type LeakageAmounts = { total: string; unrecoverable: string; recoverable: string };

/** Total VL = Recoverable VL + Unrecoverable VL; recoverable is derived. */
export function leakageAmounts(total: string, unrecoverable: string): LeakageAmounts {
  return {
    total: toDbMoney(money(total)),
    unrecoverable: toDbMoney(money(unrecoverable)),
    recoverable: diff(total, unrecoverable),
  };
}

export type LeakageSummary = {
  itemCount: number;
  assessedCount: number;
  total: string | null;
  recoverable: string | null;
  unrecoverable: string | null;
};

/** Totals across leakage items; unassessed items are counted but contribute nothing. */
export function summariseLeakage(items: readonly { amounts: LeakageAmounts | null }[]): LeakageSummary {
  const assessed = items.flatMap((i) => (i.amounts ? [i.amounts] : []));
  const sum = (pick: (a: LeakageAmounts) => string) =>
    assessed.length ? toDbMoney(sumMoney(assessed.map(pick))) : null;
  return {
    itemCount: items.length,
    assessedCount: assessed.length,
    total: sum((a) => a.total),
    recoverable: sum((a) => a.recoverable),
    unrecoverable: sum((a) => a.unrecoverable),
  };
}

export type ScenarioInput = { id: string; label: string; kind: ScenarioKind; totalValue: string };
export type ScenarioRow<T extends ScenarioInput = ScenarioInput> = T & {
  vsCurrent: string | null;
  vsRecommended: string | null;
};

/** Each scenario's difference to the current trajectory and to the recommended scenario. */
export function compareScenarios<T extends ScenarioInput>(scenarios: readonly T[]): ScenarioRow<T>[] {
  const current = scenarios.find((s) => s.kind === "current");
  const recommended = scenarios.find((s) => s.kind === "recommended");
  return scenarios.map((s) => ({
    ...s,
    vsCurrent: current ? diff(s.totalValue, current.totalValue) : null,
    vsRecommended: recommended ? diff(s.totalValue, recommended.totalValue) : null,
  }));
}

/** Client-elected value difference = selected scenario total − recommended scenario total. */
export function clientElectedDifference(selectedTotal: string, recommendedTotal: string): string {
  return diff(selectedTotal, recommendedTotal);
}

/** Authorised value the change would produce: from-version total + stated change. */
export function projectedAuthorisedValue(fromTotal: string, statedChange: string): string {
  return toDbMoney(money(fromTotal).plus(money(statedChange)));
}
