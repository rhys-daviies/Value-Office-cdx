import type { AlternativeValueTrajectories } from "@/server/queries/trajectory";
import { formatDate, formatMoneyShort } from "@/ui/format";
import { RECOMMENDATION_LABEL, SELECTED_LABEL } from "@/ui/outcomes/outcomes";

import { epoch, timeTicks, valueTicks } from "./model";
import { TRAJECTORY_SERIES } from "./series";

// Presentation model for Alternative Value Trajectories (Phase 4D.9F), built on the server from the governed read
// model. One row per explicit date; a row carries only the observations stored for that date (plus the branch anchor,
// which is the review's own realised position). Amounts become numbers only for placement; every value a person reads
// is a server-formatted string. Nothing is interpolated and terminal values are the stored option totals.

/** Option line styles by position in the semantic order. Distinguished by dash and marker as well as colour. */
export const OPTION_STYLES = [
  { color: "#1d4ed8", dash: undefined, marker: "circle" },
  { color: "#0f766e", dash: "8 4", marker: "diamond" },
  { color: "#7c3aed", dash: "2 4", marker: "triangle" },
  { color: "#b45309", dash: "10 3 2 3", marker: "square" },
  { color: "#334155", dash: "5 3", marker: "circle" },
] as const;
export type OptionMarker = (typeof OPTION_STYLES)[number]["marker"];
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
};

export type AlternativeRow = {
  t: number;
  history: number | null;
  /** Draft preview only: the draft review's entered forecast milestone on this date. */
  draftForecast: number | null;
  /** Option values keyed by series key; null where the option has no explicit observation on this date. */
  values: Record<string, number | null>;
  /** The option values on this row are the branch anchor (the review's realised position), not option points. */
  anchor: boolean;
  /** Pre-formatted tooltip lines: heading first, then one line per explicit observation on this date. */
  tip: string[];
  /** The same observations as [series, value] for the accessible values table. */
  cells: [string, string][];
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
  const series: AlternativeSeries[] = a.options.map((o, i) => {
    const style = OPTION_STYLES[i % OPTION_STYLES.length]!;
    return {
      key: `o${i}`,
      label: o.label,
      color: style.color,
      dash: style.dash,
      marker: style.marker,
      emphasis: o.recommended,
      endpointOnly: o.points.length === 0,
      roles: optionRoles(o),
    };
  });
  const rows = new Map<string, AlternativeRow>();
  const row = (asOf: string) => {
    let r = rows.get(asOf);
    if (!r) {
      r = {
        t: epoch(asOf),
        history: null,
        draftForecast: null,
        values: {},
        anchor: false,
        tip: [formatDate(asOf)],
        cells: [],
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
    if (a.anchor) row(a.anchor.asOf).values[s.key] = pos(a.anchor.value);
    for (const p of o.points) {
      const r = row(p.asOf);
      r.values[s.key] = pos(p.value);
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
  };
}
