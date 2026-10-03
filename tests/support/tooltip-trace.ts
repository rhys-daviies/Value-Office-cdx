import type { CursorTip, TipTag } from "@/ui/trajectory/cursor";
import { tipMoney } from "@/ui/trajectory/cursor";

// 4D.9N.1A: every money string a trajectory tooltip shows must be a governed value (a stored point, a formal recorded
// position, an authorised value, a stored scenario value or total, or the period-end Value Gap) — never a value read
// off a visual join. Values AT the cursor date carry an at-date tag only on rows that hold that observation.

export const AT_DATE: TipTag[] = ["Entered", "Formal", "Scenario"];

/** Money strings in the tooltips that are NOT in the governed set (must be empty). */
export function untraced(tips: CursorTip[], governed: Set<string>): string[] {
  return tips.flatMap((t) =>
    tipMoney(t)
      .filter((x) => !governed.has(x.value))
      .map((x) => `${t.heading}: ${x.value}`),
  );
}

/** At-date money on rows where nothing was stored (must be empty). */
export function atDateWithoutObservation(rows: { month: boolean; cursor: CursorTip }[]): string[] {
  return rows
    .filter((r) => r.month)
    .flatMap((r) =>
      r.cursor.blocks.flatMap((b) =>
        b.entries.filter((e) => AT_DATE.includes(e.tag)).map((e) => `${r.cursor.heading} ${b.series}: ${e.value}`),
      ),
    );
}
