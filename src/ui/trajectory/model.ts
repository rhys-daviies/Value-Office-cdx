import Decimal from "decimal.js";

import type { ValueTrajectoryChart } from "@/server/queries/trajectory";
import { formatDate, formatMoneyShort } from "@/ui/format";

import type { TrajectoryRow } from "./chart";
import { TRAJECTORY_SERIES } from "./series";

// Presentation model for the primary Value Trajectory (Phase 4D.9E), built on the server from the governed chart read
// model. One row per explicit date; a row carries only the observations stored for that date. Amounts become numbers
// only for placement; tooltips and labels are server-formatted strings. Nothing is interpolated.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const epoch = (iso: string) =>
  Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
// Presentation boundary: a decimal string becomes a number only to position a mark.
const pos = (v: string) => Number(v);

export type TrajectoryPresentation = {
  rows: TrajectoryRow[];
  domain: [number, number];
  xTicks: [number, string][];
  yTicks: [number, string][];
  today: MarkerLabel | null;
  checkpoint: MarkerLabel | null;
};

/**
 * A vertical marker and where its label sits: `align` end = text to the left of the line, start = to the right;
 * `row` 0 or 1 = label line above the plot. Placement only — Today and the formal checkpoint stay separate markers
 * unless they are literally the same date.
 */
export type MarkerLabel = { t: number; label: string; align: "start" | "end"; row: 0 | 1 };

/** Keeps two marker labels apart: opposite sides of their lines, else staggered rows; and inside the plot edges. */
export function placeMarkerLabels(domain: [number, number], markers: { t: number; label: string }[]): MarkerLabel[] {
  const span = domain[1] - domain[0] || 1;
  const sorted = [...markers].sort((a, b) => a.t - b.t);
  const placed = sorted.map((m, i): MarkerLabel => {
    const f = (m.t - domain[0]) / span;
    let align: "start" | "end" = sorted.length === 1 ? "start" : i === 0 ? "end" : "start";
    if (align === "end" && f < 0.18) align = "start";
    if (align === "start" && f > 0.82) align = "end";
    return { ...m, align, row: 0 };
  });
  if (placed.length === 2 && placed[0]!.align === placed[1]!.align) placed[1]!.row = 1;
  return markers.map((m) => placed.find((p) => p.t === m.t && p.label === m.label)!);
}

/** Month-boundary ticks across the period: monthly ≤ 12 months, quarterly ≤ 24, half-yearly ≤ 60, else yearly. */
export function timeTicks(start: string, end: string): [number, string][] {
  const [sy, sm] = [Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1];
  const [ey, em] = [Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 1];
  const months = (ey - sy) * 12 + (em - sm);
  const step = months <= 12 ? 1 : months <= 24 ? 3 : months <= 60 ? 6 : 12;
  const out: [number, string][] = [];
  // First boundary on the step grid (calendar-aligned) at or after the start.
  let y = sy;
  let m = Math.ceil((sm + (start.slice(8, 10) === "01" ? 0 : 1)) / step) * step;
  while (m >= 12) {
    m -= 12;
    y += 1;
  }
  for (;;) {
    const t = Date.UTC(y, m, 1);
    if (t > epoch(end)) break;
    out.push([t, step === 12 ? String(y) : `${MONTHS[m]} ${String(y).slice(2)}`]);
    m += step;
    while (m >= 12) {
      m -= 12;
      y += 1;
    }
  }
  return out;
}

/** Y ticks from zero to a round ceiling above every plotted value (decimal-safe). */
export function valueTicks(values: string[], currency: string): [number, string][] {
  const max = values.reduce((acc, v) => Decimal.max(acc, new Decimal(v)), new Decimal(0));
  if (max.isZero()) return [[0, formatMoneyShort("0", currency)]];
  const rough = max.dividedBy(4);
  const magnitude = new Decimal(10).pow(rough.log(10).floor());
  const step = [1, 2, 2.5, 5, 10].map((f) => magnitude.times(f)).find((s) => s.gte(rough)) ?? magnitude.times(10);
  const ticks: [number, string][] = [];
  for (let t = new Decimal(0); ; t = t.plus(step)) {
    ticks.push([t.toNumber(), formatMoneyShort(t.toFixed(2), currency)]);
    if (t.gte(max)) break;
  }
  return ticks;
}

export function buildTrajectoryPresentation(c: ValueTrajectoryChart, currency: string): TrajectoryPresentation | null {
  if (!c.available || !c.period) return null;
  const m = (v: string) => formatMoneyShort(v, currency);
  const rows = new Map<string, TrajectoryRow>();
  const row = (asOf: string) => {
    let r = rows.get(asOf);
    if (!r) {
      r = {
        t: epoch(asOf),
        plan: null,
        realised: null,
        forecast: null,
        forecastAnchor: false,
        tip: [formatDate(asOf)],
        endLabel: {},
      };
      rows.set(asOf, r);
    }
    return r;
  };
  const plotted: string[] = [];

  for (const p of c.plan) {
    const r = row(p.asOf);
    r.plan = pos(p.value);
    r.tip.push(`${TRAJECTORY_SERIES.plan.label} (V${c.version!.versionNumber}): ${m(p.value)}`);
    plotted.push(p.value);
  }
  if (c.plan.length) row(c.plan.at(-1)!.asOf).endLabel.plan = m(c.plan.at(-1)!.value);

  if (c.realised) {
    const { origin, checkpoints } = c.realised;
    if (origin && checkpoints.length) {
      const r = row(origin.asOf);
      r.realised = 0;
      r.tip.push(`${TRAJECTORY_SERIES.realised.label}: ${m("0")} at Value Period start (cumulative basis)`);
    }
    for (const k of checkpoints) {
      const r = row(k.asOf);
      r.realised = pos(k.value);
      r.tip.push(`${TRAJECTORY_SERIES.realised.label} · Review #${k.sequence}: ${m(k.value)}`);
      plotted.push(k.value);
    }
    if (checkpoints.length) row(checkpoints.at(-1)!.asOf).endLabel.realised = m(checkpoints.at(-1)!.value);
  }

  if (c.forecast) {
    const asAt = `formal position as at ${formatDate(c.forecast.reviewDate)}`;
    if (c.forecast.anchor) {
      const r = row(c.forecast.anchor.asOf);
      r.forecast = pos(c.forecast.anchor.value);
      r.forecastAnchor = true; // joins the line; the tooltip shows only the realised observation
    }
    for (const p of c.forecast.points) {
      const r = row(p.asOf);
      r.forecast = pos(p.value);
      r.tip.push(`${TRAJECTORY_SERIES.forecast.label}: ${m(p.value)} — ${asAt}`);
      plotted.push(p.value);
    }
    row(c.forecast.points.at(-1)!.asOf).endLabel.forecast = m(c.forecast.points.at(-1)!.value);
  }

  // Combined only when literally the same calendar date; otherwise two markers, labels kept apart by placement.
  const sameDay = c.latestFormal && c.today.asOf === c.latestFormal.reviewDate;
  const domain: [number, number] = [epoch(c.period.start), epoch(c.period.end)];
  const today = c.today.inPeriod
    ? { t: epoch(c.today.asOf), label: sameDay ? "Today · formal position" : "Today" }
    : null;
  const checkpoint =
    c.latestFormal &&
    !sameDay &&
    c.latestFormal.reviewDate >= c.period.start &&
    c.latestFormal.reviewDate <= c.period.end
      ? { t: epoch(c.latestFormal.reviewDate), label: `Formal position ${formatDate(c.latestFormal.reviewDate)}` }
      : null;
  const placed = placeMarkerLabels(
    domain,
    [checkpoint, today].filter((m) => m !== null),
  );
  return {
    rows: [...rows.values()].sort((a, b) => a.t - b.t),
    domain,
    xTicks: timeTicks(c.period.start, c.period.end),
    yTicks: valueTicks(plotted, currency),
    today: today ? placed.find((m) => m.label === today.label)! : null,
    checkpoint: checkpoint ? placed.find((m) => m.label === checkpoint.label)! : null,
  };
}
