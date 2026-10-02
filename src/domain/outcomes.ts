import { clientElectedDifference } from "./response";
import type { ScenarioKind } from "./statuses";

// Alternative Value Outcomes (Phase 4D.6): a point-in-time comparison of the stored management-response
// scenarios of one Assurance Review. Each scenario has one consultant-entered total; nothing here is
// time-phased, interpolated or derived beyond the existing recommendation-vs-decision difference.

export type OutcomeScenario = {
  id: string;
  label: string;
  kind: ScenarioKind;
  totalValue: string;
  narrative: string | null;
};

export type Outcome = OutcomeScenario & {
  /** This scenario is Cardaxia's issued recommendation for the review. */
  recommended: boolean;
  /** This scenario is the client-selected outcome. */
  selected: boolean;
};

/**
 * Semantic order (never ranked by value): Cardaxia's recommendation, then the other stored scenarios in
 * their stored order, then the client-selected outcome. A scenario holding both roles appears once.
 * `scenarios` must already be in stored order (sortOrder, then creation).
 */
export function arrangeOutcomes(
  scenarios: readonly OutcomeScenario[],
  recommendedId: string | null,
  selectedId: string | null,
): Outcome[] {
  const tag = (s: OutcomeScenario): Outcome => ({
    ...s,
    recommended: s.id === recommendedId,
    selected: s.id === selectedId,
  });
  const recommended = scenarios.filter((s) => s.id === recommendedId);
  const selected = scenarios.filter((s) => s.id === selectedId && s.id !== recommendedId);
  const others = scenarios.filter((s) => s.id !== recommendedId && s.id !== selectedId);
  return [...recommended, ...others, ...selected].map(tag);
}

/** Selected − recommended, decimal-safe; null unless both exist. Sign preserved (zero stays "0.00"). */
export function differenceFromRecommendation(outcomes: readonly Outcome[]): string | null {
  const rec = outcomes.find((o) => o.recommended);
  const sel = outcomes.find((o) => o.selected);
  return rec && sel ? clientElectedDifference(sel.totalValue, rec.totalValue) : null;
}

/** One stored option total − the recommended option's stored total (Phase 4D.9F), decimal-safe and signed. */
export function optionDifference(optionTotal: string, recommendedTotal: string): string {
  return clientElectedDifference(optionTotal, recommendedTotal);
}
