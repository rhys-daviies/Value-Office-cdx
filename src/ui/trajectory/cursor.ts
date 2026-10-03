import { formatDate } from "@/ui/format";

// Monthly crosshair (Phase 4D.9N.1A). The cursor can rest on every month of the Value Period, but a month carries NO
// plotted money of its own: the tooltip states only governed values that exist — the value entered on that date, or the
// Previous / Next entered value with its date. Nothing is read off a visual join. Pure and server-side.

/** How a value in the tooltip is governed. Only the first four are values AT the cursor date. */
export type TipTag = "Entered" | "Formal" | "Scenario" | "Latest formal" | "Previous" | "Next";

export type TipEntry = {
  tag: TipTag;
  /** Formatted date of the value (Previous / Next / Latest formal always carry one). */
  date?: string;
  /** Server-formatted money string of a stored or formally recorded value. */
  value: string;
  detail?: string;
};

export type TipBlock = {
  series: string;
  color: string;
  /** Semantic roles (Cardaxia recommendation, Client selected) — never a ranking. */
  badges?: string[];
  entries: TipEntry[];
  /** A statement about the series at this date (e.g. "No formal realised checkpoint yet"). */
  note?: string;
};

export type CursorTip = { heading: string; events: string[]; blocks: TipBlock[]; footer: string[] };

/** Month-end ISO dates of every month that overlaps [start, end], clamped to the period. */
export function monthEnds(start: string, end: string): string[] {
  const out: string[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7)) - 1;
  for (;;) {
    const last = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
    const iso = last > end ? end : last;
    if (iso < start) break;
    out.push(iso);
    if (last >= end) break;
    m += 1;
    if (m === 12) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

export const monthKey = (iso: string) => iso.slice(0, 7);
/** "Sept 2026": the app's own date format without the day, so month headings read like every other date. */
export const monthHeading = (iso: string) => formatDate(`${iso.slice(0, 7)}-01`).replace(/^\d+\s+/, "");

export type Dated = { asOf: string; value: string };

/**
 * The governed values of one series relative to a cursor date: the value ON the date (tagged), otherwise the Previous
 * and Next entered values. `money` formats; `onTag` is the tag for a value on the date.
 */
export function prevNext<T extends Dated>(
  points: readonly T[],
  asOf: string,
  onTag: TipTag,
  money: (v: string) => string,
  detail?: (p: T) => string | undefined,
): TipEntry[] {
  const on = points.find((p) => p.asOf === asOf);
  if (on) return [{ tag: onTag, value: money(on.value), detail: detail?.(on) }];
  const before = points.filter((p) => p.asOf < asOf).at(-1);
  const after = points.find((p) => p.asOf > asOf);
  const out: TipEntry[] = [];
  if (before)
    out.push({ tag: "Previous", date: formatDate(before.asOf), value: money(before.value), detail: detail?.(before) });
  if (after)
    out.push({ tag: "Next", date: formatDate(after.asOf), value: money(after.value), detail: detail?.(after) });
  return out;
}

/** Every money string a tooltip shows, for tests and audits (each must trace to a governed value). */
export function tipMoney(tip: CursorTip): { tag: TipTag | "footer"; value: string }[] {
  return [
    ...tip.blocks.flatMap((b) => b.entries.map((e) => ({ tag: e.tag, value: e.value }))),
    ...tip.footer.flatMap((f) =>
      (f.match(/-?\$[\d.,]+[mk]?/g) ?? []).map((value) => ({ tag: "footer" as const, value })),
    ),
  ];
}
