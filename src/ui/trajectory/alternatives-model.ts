import type { AlternativeValueTrajectories } from "@/server/queries/trajectory";
import { formatDate, formatMoneyChange, formatMoneyShort } from "@/ui/format";
import { RECOMMENDATION_LABEL, SELECTED_LABEL } from "@/ui/outcomes/outcomes";

import { type CursorTip, type TipBlock, type TipEntry, monthEnds, monthHeading, monthKey, prevNext } from "./cursor";
import { epoch, timeTicks, valueTicks } from "./model";
import { TRAJECTORY_SERIES } from "./series";

// Presentation model for Alternative Value Trajectories (Phase 4D.9F), built on the server from the governed read
// model. One row per explicit date; a row carries only the observations stored for that date (plus the branch anchor,
// which is the review's own realised position). Amounts become numbers only for placement; every value a person reads
// is a server-formatted string. Nothing is interpolated and terminal values are the stored option totals.
// 4D.9N.1A: value-free month rows give the crosshair monthly resolution (tooltips state stored values or Previous /
// Next only). When an option's first explicit milestones are identical to an earlier option's, the shared stretch is
// drawn once and the option's own line starts at the last shared milestone (its divergence). Pivot / action markers
// come only from notes the consultant stored on a milestone — never from an option's name.

export { OPTION_STYLES, type OptionMarker } from "./series";
import { OPTION_STYLES, type OptionMarker } from "./series";
export const HISTORY_STYLE = { color: TRAJECTORY_SERIES.realised.color, label: "Realised (shared history)" };
/** Draft preview baseline: the forecast colour, but a working dash and hollow marks — never the governed forecast look. */
export const DRAFT_FORECAST_STYLE = {
  color: TRAJECTORY_SERIES.forecast.color,
  dash: "4 3",
  label: "Draft Formal Forecast (not governed)",
};

export type AlternativeSeries = {
  key: string;
  label: string;
  color: string;
  dash: string | undefined;
  marker: OptionMarker;
  emphasis: boolean;
  /** No explicit milestones: a single end marker at the stored total, no line. */
  endpointOnly: boolean;
  roles: string;
  /** The earlier option this one shares its first milestones with, and the last shared date (its divergence). */
  shared: { with: string; until: string } | null;
};

/** A stored milestone note on an option path, shown as an event marker at its date. */
export type PivotMarker = { t: number; label: string; option: string; color: string };

export type AlternativeRow = {
  t: number;
  history: number | null;
  /** Draft preview only: the draft review's entered forecast milestone on this date. */
  draftForecast: number | null;
  /** Option values keyed by series key; null where the option has no explicit observation on this date. */
  values: Record<string, number | null>;
  /** The option values on this row are the branch anchor (the review's realised position), not option points. */
  anchor: boolean;
  /** A value-free cursor position for a month with no explicit date of its own (4D.9N.1A). */
  month: boolean;
  /** Pre-formatted tooltip lines: heading first, then one line per explicit observation on this date. */
  tip: string[];
  /** The same observations as [series, value] for the accessible values table. */
  cells: [string, string][];
  /** The crosshair tooltip at this row: stored values on the date, or Previous / Next. */
  cursor: CursorTip;
};

export type TerminalLabel = { key: string; value: number; lines: string[]; color: string };

export type AlternativePresentation = {
  series: AlternativeSeries[];
  rows: AlternativeRow[];
  domain: [number, number];
  xTicks: [number, string][];
  yTicks: [number, string][];
  review: { t: number; label: string };
  labels: TerminalLabel[];
  pivots: PivotMarker[];
};

/** Saved as Cardaxia's recommendation but not issued: shown only on a draft preview, never as a governed role. */
export const PENDING_RECOMMENDATION_LABEL = "Draft recommendation (not issued)";

export const optionRoles = (o: { recommended: boolean; selected: boolean; pendingRecommendation?: boolean }) =>
  [
    o.recommended && RECOMMENDATION_LABEL,
    o.pendingRecommendation && PENDING_RECOMMENDATION_LABEL,
    o.selected && SELECTED_LABEL,
  ]
    .filter(Boolean)
    .join(" · ");

export function buildAlternativePresentation(
  a: AlternativeValueTrajectories,
  currency: string,
): AlternativePresentation | null {
  if (!a.available || !a.period) return null;
  const m = (v: string) => formatMoneyShort(v, currency);
  const pos = (v: string) => Number(v); // presentation boundary: placement only
  const same = (x: { asOf: string; value: string }, y: { asOf: string; value: string }) =>
    x.asOf === y.asOf && x.value === y.value;
  const series: AlternativeSeries[] = a.options.map((o, i) => {
    const style = OPTION_STYLES[i % OPTION_STYLES.length]!;
    // Shared opening: the longest run of identical explicit milestones with an EARLIER option (stored data only).
    let shared: AlternativeSeries["shared"] = null;
    for (const e of a.options.slice(0, i)) {
      let k = 0;
      while (k < o.points.length - 1 && k < e.points.length && same(o.points[k]!, e.points[k]!)) k++;
      if (k > 0 && (!shared || k > o.points.findIndex((p) => p.asOf === shared!.until) + 1))
        shared = { with: e.label, until: o.points[k - 1]!.asOf };
    }
    return {
      key: `o${i}`,
      label: o.label,
      color: style.color,
      dash: style.dash,
      marker: style.marker,
      emphasis: o.recommended,
      endpointOnly: o.points.length === 0,
      roles: optionRoles(o),
      shared,
    };
  });
  const rows = new Map<string, AlternativeRow>();
  const row = (asOf: string, month = false) => {
    let r = rows.get(asOf);
    if (!r) {
      r = {
        t: epoch(asOf),
        history: null,
        draftForecast: null,
        values: {},
        anchor: false,
        month,
        tip: [month ? monthHeading(asOf) : formatDate(asOf)],
        cells: [],
        cursor: { heading: "", events: [], blocks: [], footer: [] },
      };
      rows.set(asOf, r);
    }
    return r;
  };
  const plotted: string[] = [];
  const observe = (r: AlternativeRow, series: string, value: string, suffix = "") => {
    r.tip.push(`${series}: ${value}${suffix}`);
    r.cells.push([suffix ? `${series}${suffix}` : series, value]);
  };

  if (a.history) {
    const r = row(a.history.origin.asOf);
    r.history = 0;
    observe(r, "Realised", `${m("0")} at Value Period start (cumulative basis)`);
    for (const k of a.history.checkpoints) {
      const h = row(k.asOf);
      h.history = pos(k.value);
      observe(h, `Realised · Review #${k.sequence}`, m(k.value));
      plotted.push(k.value);
    }
  }
  if (a.anchor) {
    const r = row(a.anchor.asOf);
    r.history = a.history ? pos(a.anchor.value) : null;
    r.anchor = true;
    observe(r, `Formal realised position · Review #${a.anchor.sequence}`, m(a.anchor.value));
    plotted.push(a.anchor.value);
  }

  const labels: TerminalLabel[] = [];
  if (a.draftForecast) {
    for (const p of a.draftForecast.points) {
      const r = row(p.asOf);
      r.draftForecast = pos(p.value);
      observe(r, DRAFT_FORECAST_STYLE.label, m(p.value));
      plotted.push(p.value);
    }
    const last = a.draftForecast.points.at(-1)!;
    labels.push({
      key: "draftForecast",
      value: pos(last.value),
      lines: [`${m(last.value)} Draft Formal Forecast`, "Not governed"],
      color: DRAFT_FORECAST_STYLE.color,
    });
  }
  a.options.forEach((o, i) => {
    const s = series[i]!;
    const roleSuffix = s.roles ? ` · ${s.roles}` : "";
    if (o.points.length === 0) {
      // Endpoint only: the stored total is the option's value at the Value Period end. No path is drawn.
      const r = row(a.period!.end);
      r.values[s.key] = pos(o.totalValue);
      observe(r, o.label, `${m(o.totalValue)} (stored total; phasing not entered)`, roleSuffix);
      plotted.push(o.totalValue);
      labels.push({
        key: s.key,
        value: pos(o.totalValue),
        lines: [`${m(o.totalValue)} ${o.label}`, ["Phasing not entered", s.roles].filter(Boolean).join(" · ")],
        color: s.color,
      });
      return;
    }
    // A shared opening is drawn once (by the earlier option); this option's own line starts at its divergence.
    if (a.anchor && !s.shared) row(a.anchor.asOf).values[s.key] = pos(a.anchor.value);
    for (const p of o.points) {
      const r = row(p.asOf);
      if (!s.shared || p.asOf >= s.shared.until) r.values[s.key] = pos(p.value);
      observe(r, o.label, m(p.value), roleSuffix);
      plotted.push(p.value);
    }
    // Terminal label: the stored option total when the path reconciles to it, otherwise the last entered milestone.
    const last = o.points.at(-1)!;
    const terminal = o.reconciliation.state === "reconciled" ? o.totalValue : last.value;
    labels.push({
      key: s.key,
      value: pos(terminal),
      lines: [`${m(terminal)} ${o.label}`, ...(s.roles ? [s.roles] : [])],
      color: s.color,
    });
  });

  const reviewDate = a.outcomes.review.date;
  const firstPoint = [...a.options.flatMap((o) => o.points), ...(a.draftForecast?.points ?? [])]
    .map((p) => p.asOf)
    .sort()
    .at(0);
  // With shared history the axis spans the Value Period; otherwise it starts at the review (or first milestone).
  const earliest = [reviewDate, firstPoint ?? a.period.end].sort()[0]!;
  const start = a.history || earliest < a.period.start ? a.period.start : earliest;

  // Events: the branch point and every stored milestone note (pivot / action markers).
  const events = new Map<string, string[]>();
  const event = (asOf: string, text: string) => {
    row(asOf);
    events.set(asOf, [...(events.get(asOf) ?? []), text]);
  };
  event(reviewDate, `Review #${a.outcomes.review.sequence} · options assessed (branch point)`);
  const pivots: PivotMarker[] = [];
  a.options.forEach((o, i) => {
    for (const p of o.points) {
      if (!p.note?.trim()) continue;
      event(p.asOf, `${o.label}: ${p.note.trim()}`);
      pivots.push({ t: epoch(p.asOf), label: p.note.trim(), option: o.label, color: series[i]!.color });
    }
  });

  // Month rows: one value-free cursor position per month that has no explicit date of its own.
  const explicitMonths = new Set([...rows.keys()].map(monthKey));
  for (const iso of monthEnds(start, a.period.end)) if (!explicitMonths.has(monthKey(iso))) row(iso, true);

  const realised = [
    ...(a.history
      ? [{ asOf: a.history.origin.asOf, value: "0.00", detail: "Value Period start (cumulative basis)" }]
      : []),
    ...(a.history?.checkpoints ?? []).map((k) => ({ asOf: k.asOf, value: k.value, detail: `Review #${k.sequence}` })),
    ...(a.anchor
      ? [{ asOf: a.anchor.asOf, value: a.anchor.value, detail: `Review #${a.anchor.sequence} · branch point` }]
      : []),
  ];
  const footer = [
    `Option totals at Value Period end: ${a.options.map((o) => `${o.label} ${m(o.totalValue)}`).join(" · ")}`,
    ...(a.decisionComparison
      ? [
          `${SELECTED_LABEL} − ${RECOMMENDATION_LABEL} = ${formatMoneyChange(a.decisionComparison.difference, currency)}`,
        ]
      : []),
  ];
  const tipAt = (asOf: string, month: boolean): CursorTip => {
    const blocks: TipBlock[] = [];
    if (realised.length) {
      const on = realised.find((p) => p.asOf === asOf);
      const latest = realised.filter((p) => p.asOf <= asOf).at(-1);
      const next = realised.find((p) => p.asOf > asOf && p.detail.startsWith("Review"));
      // Before the first formal checkpoint only the definitional zero origin exists: say so, and name the next one.
      const beforeFirst = !on && (!latest || !latest.detail.startsWith("Review"));
      blocks.push({
        series: "Realised (formal)",
        color: HISTORY_STYLE.color,
        entries: on
          ? [{ tag: "Formal", value: m(on.value), detail: on.detail }]
          : [
              ...(latest
                ? [
                    {
                      tag: "Latest formal" as const,
                      date: formatDate(latest.asOf),
                      value: m(latest.value),
                      detail: latest.detail,
                    },
                  ]
                : []),
              ...(beforeFirst && next
                ? [{ tag: "Next" as const, date: formatDate(next.asOf), value: m(next.value), detail: next.detail }]
                : []),
            ],
        note: beforeFirst ? "No formal realised checkpoint yet at this date" : undefined,
      });
    }
    if (a.draftForecast)
      blocks.push({
        series: DRAFT_FORECAST_STYLE.label,
        color: DRAFT_FORECAST_STYLE.color,
        entries: prevNext(a.draftForecast.points, asOf, "Entered", m),
      });
    a.options.forEach((o, i) => {
      const s = series[i]!;
      const notes = (p: { note: string | null }) => p.note?.trim() || undefined;
      let entries: TipEntry[];
      let note: string | undefined;
      if (s.endpointOnly) {
        entries = [
          {
            tag: asOf === a.period!.end ? "Scenario" : "Next",
            date: asOf === a.period!.end ? undefined : formatDate(a.period!.end),
            value: m(o.totalValue),
            detail: "stored total; phasing not entered",
          },
        ];
      } else {
        entries = prevNext(o.points, asOf, "Scenario", m, notes);
        if (asOf <= reviewDate) note = `Option paths begin after the review (${formatDate(reviewDate)})`;
      }
      if (s.shared && asOf < s.shared.until && asOf > reviewDate)
        note = `Same path as ${s.shared.with} until ${formatDate(s.shared.until)}`;
      blocks.push({
        series: o.label,
        color: s.color,
        badges: s.roles ? s.roles.split(" · ") : undefined,
        entries,
        note,
      });
    });
    return {
      heading: month ? monthHeading(asOf) : formatDate(asOf),
      events: month ? [] : (events.get(asOf) ?? []),
      blocks,
      footer,
    };
  };
  for (const [asOf, r] of rows) r.cursor = tipAt(asOf, r.month);

  return {
    series,
    rows: [...rows.values()].sort((x, y) => x.t - y.t),
    domain: [epoch(start), epoch(a.period.end)],
    xTicks: timeTicks(start, a.period.end),
    yTicks: valueTicks(plotted, currency),
    review: {
      t: epoch(reviewDate),
      label: a.governed
        ? `Review #${a.outcomes.review.sequence} · ${formatDate(reviewDate)} · options assessed`
        : `Draft Review #${a.outcomes.review.sequence} · ${formatDate(reviewDate)} · not finalised`,
    },
    labels,
    pivots,
  };
}
