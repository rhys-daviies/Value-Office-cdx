import Decimal from "decimal.js";

import type { ValueTrajectoryChart } from "@/server/queries/trajectory";
import { formatDate, formatMoneyShort } from "@/ui/format";

import type { TrajectoryRow } from "./chart";
import { type CursorTip, type TipBlock, monthEnds, monthHeading, monthKey, prevNext } from "./cursor";
import { TRAJECTORY_SERIES } from "./series";

// Presentation model for the primary Value Trajectory (Phase 4D.9E), built on the server from the governed chart read
// model. One row per explicit date; a row carries only the observations stored for that date. Amounts become numbers
// only for placement; tooltips and labels are server-formatted strings. Nothing is interpolated.
// 4D.9N.1A: value-free month rows give the crosshair monthly resolution; every row's tooltip states only governed
// values (on the date, or Previous / Next with their dates). End labels name the series; a period-end bracket shows the
// Value Gap (Authorised − Formal Forecast at the Value Period end).

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
  /** Authorised Value Change that created the version in force (Phase 4D.9G). */
  versionChange: MarkerLabel | null;
  /** Period-end Value Gap bracket between the Authorised Plan and the Formal Forecast end points (4D.9N.1A). */
  gap: GapBracket | null;
};

/** `roomy`: the bracket is tall enough to hold its label between the two end labels in the right gutter. */
export type GapBracket = { t: number; plan: number; forecast: number; label: string; roomy: boolean };

/** Approximate plot height of the primary chart in pixels (placement decisions only). */
const PLOT_HEIGHT = 272;

/**
 * A vertical marker and where its label sits: `align` end = text to the left of the line, start = to the right;
 * `row` 0 or 1 = label line above the plot. Placement only — Today and the formal checkpoint stay separate markers
 * unless they are literally the same date.
 */
export type MarkerLabel = { t: number; label: string; align: "start" | "end"; row: 0 | 1 };

/**
 * Places marker labels so they never collide (presentation only; markers are never merged). Greedy, in date order:
 * each label tries left of its line, then right, on the top row, then the second row, staying inside the plot.
 * Label width is estimated from its length against a typical plot width.
 */
export function placeMarkerLabels(domain: [number, number], markers: { t: number; label: string }[]): MarkerLabel[] {
  const span = domain[1] - domain[0] || 1;
  const width = (label: string) => (label.length * 6 + 10) / 800;
  const taken: { row: 0 | 1; from: number; to: number }[] = [];
  const placed = new Map<{ t: number; label: string }, MarkerLabel>();
  type Slot = { align: "start" | "end"; row: 0 | 1 };
  const slots: Slot[] = [
    { align: "end", row: 0 },
    { align: "start", row: 0 },
    { align: "end", row: 1 },
    { align: "start", row: 1 },
  ];
  for (const m of [...markers].sort((a, b) => a.t - b.t)) {
    const f = (m.t - domain[0]) / span;
    const w = width(m.label);
    const extent = (o: Slot): [number, number] => (o.align === "end" ? [f - w, f] : [f, f + w]);
    const fits = (o: Slot) => {
      const [from, to] = extent(o);
      return from >= 0 && to <= 1 && !taken.some((x) => x.row === o.row && from < x.to && to > x.from);
    };
    // A lone marker reads naturally to the right of its line.
    const order = markers.length === 1 ? [slots[1]!, slots[0]!, slots[3]!, slots[2]!] : slots;
    const choice: Slot = order.find(fits) ?? { align: f > 0.5 ? "end" : "start", row: 1 };
    const [from, to] = extent(choice);
    taken.push({ row: choice.row, from, to });
    placed.set(m, { ...m, ...choice });
  }
  return markers.map((m) => placed.get(m)!);
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
  const period = c.period;
  const rows = new Map<string, TrajectoryRow>();
  const row = (asOf: string, month = false) => {
    let r = rows.get(asOf);
    if (!r) {
      r = {
        t: epoch(asOf),
        plan: null,
        realised: null,
        forecast: null,
        forecastAnchor: false,
        month,
        tip: [month ? monthHeading(asOf) : formatDate(asOf)],
        cursor: { heading: "", events: [], blocks: [], footer: [] },
        endLabel: {},
        endPlace: {},
      };
      rows.set(asOf, r);
    }
    return r;
  };
  const plotted: string[] = [];
  const version = `V${c.version!.versionNumber}`;

  for (const p of c.plan) {
    const r = row(p.asOf);
    r.plan = pos(p.value);
    r.tip.push(`${TRAJECTORY_SERIES.plan.label} (${version}): ${m(p.value)}`);
    plotted.push(p.value);
  }
  if (c.plan.length) row(c.plan.at(-1)!.asOf).endLabel.plan = `Authorised ${version} · ${m(c.plan.at(-1)!.value)}`;

  // Realised: the zero origin (cumulative basis) and the formal checkpoints — the only realised values that exist.
  const realisedPoints: { asOf: string; value: string; detail: string }[] = [];
  if (c.realised) {
    const { origin, checkpoints } = c.realised;
    if (origin && checkpoints.length) {
      const r = row(origin.asOf);
      r.realised = 0;
      r.tip.push(`${TRAJECTORY_SERIES.realised.label}: ${m("0")} at Value Period start (cumulative basis)`);
      realisedPoints.push({ asOf: origin.asOf, value: "0.00", detail: "Value Period start (cumulative basis)" });
    }
    for (const k of checkpoints) {
      const r = row(k.asOf);
      r.realised = pos(k.value);
      r.tip.push(`${TRAJECTORY_SERIES.realised.label} · Review #${k.sequence}: ${m(k.value)}`);
      realisedPoints.push({ asOf: k.asOf, value: k.value, detail: `Review #${k.sequence}` });
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
    row(c.forecast.points.at(-1)!.asOf).endLabel.forecast = `${TRAJECTORY_SERIES.forecast.label} · ${m(
      c.forecast.points.at(-1)!.value,
    )}`;
  }

  // Combined only when literally the same calendar date; otherwise two markers, labels kept apart by placement.
  const sameDay = c.latestFormal && c.today.asOf === c.latestFormal.reviewDate;
  const domain: [number, number] = [epoch(period.start), epoch(period.end)];
  const today = c.today.inPeriod
    ? { t: epoch(c.today.asOf), label: sameDay ? "Today · formal position" : "Today" }
    : null;
  const checkpoint =
    c.latestFormal && !sameDay && c.latestFormal.reviewDate >= period.start && c.latestFormal.reviewDate <= period.end
      ? { t: epoch(c.latestFormal.reviewDate), label: `Formal position ${formatDate(c.latestFormal.reviewDate)}` }
      : null;
  const change = c.versionChange?.inPeriod
    ? {
        t: epoch(c.versionChange.authorisedOn),
        label: `V${c.versionChange.versionNumber} authorised (${c.versionChange.code})`,
      }
    : null;
  const placed = placeMarkerLabels(
    domain,
    [checkpoint, today, change].filter((x) => x !== null),
  );

  // Events: governed facts dated inside the Value Period. Each gets a row so the crosshair can rest on it.
  const events = new Map<string, string[]>();
  const event = (asOf: string, text: string) => {
    if (asOf < period.start || asOf > period.end) return;
    row(asOf);
    events.set(asOf, [...(events.get(asOf) ?? []), text]);
  };
  for (const k of c.realised?.checkpoints ?? []) event(k.asOf, `Formal review · Review #${k.sequence}`);
  if (c.latestFormal && !(c.realised?.checkpoints ?? []).some((k) => k.sequence === c.latestFormal!.sequence))
    event(c.latestFormal.reviewDate, `Formal review · Review #${c.latestFormal.sequence}`);
  if (c.versionChange)
    event(c.versionChange.authorisedOn, `V${c.versionChange.versionNumber} authorised via ${c.versionChange.code}`);
  if (c.today.inPeriod) event(c.today.asOf, sameDay ? "Today · latest formal position" : "Today");

  // Month rows: one value-free cursor position per month that has no explicit date of its own.
  const explicitMonths = new Set([...rows.keys()].map(monthKey));
  for (const iso of monthEnds(period.start, period.end)) if (!explicitMonths.has(monthKey(iso))) row(iso, true);

  // Value Gap: a period-end measure, comparable only when the latest formal review measured the version in force.
  const comparable =
    c.forecast !== null &&
    c.latestFormal !== null &&
    c.latestFormal.forecastTotal !== null &&
    c.latestFormal.againstVersionNumber === c.version!.versionNumber;
  const gapValue = comparable ? new Decimal(c.version!.total).minus(c.latestFormal!.forecastTotal!).toFixed(2) : null;
  const footer = gapValue
    ? [
        `Value Gap at Value Period end: ${m(gapValue)} (Authorised ${version} ${m(c.version!.total)} − Formal Forecast ${m(
          c.latestFormal!.forecastTotal!,
        )})`,
      ]
    : [];

  const forecastDetail = c.latestFormal
    ? `Review #${c.latestFormal.sequence} · measured against V${c.latestFormal.againstVersionNumber}`
    : undefined;
  const tipAt = (asOf: string, month: boolean): CursorTip => {
    const blocks: TipBlock[] = [
      {
        series: `${TRAJECTORY_SERIES.plan.label} (${version})`,
        color: TRAJECTORY_SERIES.plan.color,
        entries: prevNext(c.plan, asOf, "Entered", m),
        note: c.plan.length ? undefined : "Plan phasing not entered",
      },
    ];
    if (realisedPoints.length) {
      const on = realisedPoints.find((p) => p.asOf === asOf);
      const latest = realisedPoints.filter((p) => p.asOf <= asOf).at(-1);
      const next = realisedPoints.find((p) => p.asOf > asOf && p.detail.startsWith("Review"));
      // Before the first formal checkpoint only the definitional zero origin exists: say so, and name the next one.
      const beforeFirst = !on && (!latest || !latest.detail.startsWith("Review"));
      blocks.push({
        series: TRAJECTORY_SERIES.realised.label,
        color: TRAJECTORY_SERIES.realised.color,
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
    if (c.forecast) {
      const first = c.forecast.points[0]!;
      blocks.push({
        series: TRAJECTORY_SERIES.forecast.label,
        color: TRAJECTORY_SERIES.forecast.color,
        entries: prevNext(c.forecast.points, asOf, "Formal", m, () => forecastDetail),
        note:
          asOf < first.asOf && asOf <= c.forecast.reviewDate
            ? `Formal Forecast milestones begin after the review date (${formatDate(c.forecast.reviewDate)})`
            : undefined,
      });
    }
    return {
      heading: month ? monthHeading(asOf) : formatDate(asOf),
      events: month ? [] : (events.get(asOf) ?? []),
      blocks,
      footer,
    };
  };
  for (const [asOf, r] of rows) r.cursor = tipAt(asOf, r.month);

  const yTicks = valueTicks(plotted, currency);
  const yMax = yTicks.at(-1)?.[0] ?? 1;
  const planEnd = c.plan.at(-1);
  const forecastEnd = c.forecast?.points.at(-1);
  let gap: GapBracket | null = null;
  if (gapValue && planEnd?.asOf === period.end && forecastEnd?.asOf === period.end) {
    const px = (Math.abs(pos(planEnd.value) - pos(forecastEnd.value)) / (yMax || 1)) * PLOT_HEIGHT;
    gap = {
      t: epoch(period.end),
      plan: pos(planEnd.value),
      forecast: pos(forecastEnd.value),
      label: `Value Gap · ${m(gapValue)}`,
      roomy: px >= 40,
    };
    // End labels: centred on their points when the gap label fits between them; otherwise pushed apart.
    const end = row(period.end);
    const planHigher = pos(planEnd.value) >= pos(forecastEnd.value);
    end.endPlace = gap.roomy
      ? { plan: "centre", forecast: "centre" }
      : { plan: planHigher ? "above" : "below", forecast: planHigher ? "below" : "above" };
  }

  return {
    rows: [...rows.values()].sort((a, b) => a.t - b.t),
    domain,
    xTicks: timeTicks(period.start, period.end),
    yTicks,
    today: today ? placed.find((x) => x.label === today.label)! : null,
    checkpoint: checkpoint ? placed.find((x) => x.label === checkpoint.label)! : null,
    versionChange: change ? placed.find((x) => x.label === change.label)! : null,
    gap,
  };
}
