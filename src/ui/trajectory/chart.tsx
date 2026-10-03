"use client";

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";

import type { CursorTip } from "./cursor";
import { CursorTipCard } from "./cursor-tip";
import type { GapBracket } from "./model";
import { TRAJECTORY_SERIES } from "./series";

// Primary Value Trajectory chart (Phase 4D.9E). Client-only drawing of a model the server has composed and formatted.
// Straight segments between points are presentation joins. Values arrive as numbers for placement only; every value a
// person reads is a server-formatted string. 4D.9N.1A: value-free month rows let the crosshair rest on every month; the
// tooltip then states only governed values (on the date, or Previous / Next with dates) — never a value on a join.

export type TrajectoryRow = {
  /** Epoch milliseconds (UTC midnight) of the explicit date. */
  t: number;
  plan: number | null;
  realised: number | null;
  forecast: number | null;
  /** The forecast value on this row is the visual anchor (the review's realised checkpoint), not a forecast point. */
  forecastAnchor: boolean;
  /** A value-free cursor position for a month with no explicit date of its own (4D.9N.1A). */
  month: boolean;
  /** Pre-formatted lines: heading first, then one line per explicit observation on this date (the values table). */
  tip: string[];
  /** The crosshair tooltip at this row: governed values on the date, or Previous / Next. */
  cursor: CursorTip;
  /** Pre-formatted end labels for terminal points. */
  endLabel: { plan?: string; forecast?: string; realised?: string };
  /** Vertical placement of end labels relative to their point (set where the Value Gap bracket sits). */
  endPlace: { plan?: "centre" | "above" | "below"; forecast?: "centre" | "above" | "below" };
};

type Marker = { t: number; label: string; align: "start" | "end"; row: 0 | 1 };

/** Marker label above the plot, beside its line (placement chosen on the server so labels never collide). */
export function markerLabel(m: Marker, fill: string, weight = 400) {
  function MarkerLabel({ viewBox }: { viewBox?: { x?: number; y?: number } }) {
    const x = viewBox?.x ?? 0;
    const y = viewBox?.y ?? 0;
    return (
      <text
        x={m.align === "start" ? x + 5 : x - 5}
        y={y - (m.row === 0 ? 18 : 5)}
        textAnchor={m.align}
        fontSize={11}
        fill={fill}
        fontWeight={weight}
        data-marker={m.label}
      >
        {m.label}
      </text>
    );
  }
  return MarkerLabel;
}

function TipContent({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  const row = payload?.[0]?.payload as TrajectoryRow | undefined;
  if (!active || !row) return null;
  return <CursorTipCard tip={row.cursor} testId="trajectory-tooltip" />;
}

/** Period-end Value Gap bracket, drawn just right of the end points with its label (4D.9N.1A). */
function gapShape(g: GapBracket) {
  function GapShape({ x1, y1, y2 }: { x1?: number; y1?: number; x2?: number; y2?: number }) {
    if (x1 === undefined || y1 === undefined || y2 === undefined) return <g />;
    const x = x1 + 9;
    const [top, bottom] = y1 < y2 ? [y1, y2] : [y2, y1];
    const mid = (top + bottom) / 2;
    return (
      <g data-testid="trajectory-gap-bracket" data-label={g.label}>
        <path d={`M${x - 4},${top} H${x} V${bottom} H${x - 4}`} fill="none" stroke="#b91c1c" strokeWidth={1.5} />
        {/* Roomy: between the two end labels. Otherwise below the lower end label, in the gutter (never on a line). */}
        <text
          x={g.roomy ? x + 7 : x1 + 20}
          y={g.roomy ? mid + 4 : bottom + 30}
          textAnchor="start"
          fontSize={11}
          fontWeight={600}
          fill="#b91c1c"
        >
          {g.label}
        </text>
      </g>
    );
  }
  return GapShape;
}

type DotProps = { cx?: number; cy?: number; payload?: TrajectoryRow; value?: number | null };

function dot(series: "plan" | "realised" | "forecast") {
  const color = TRAJECTORY_SERIES[series].color;
  function Dot({ cx, cy, payload, value }: DotProps) {
    if (cx === undefined || cy === undefined || !payload || value === null || value === undefined) return <g />;
    if (series === "forecast" && payload.forecastAnchor) return <g />; // anchor is the realised mark, not a forecast
    const label = payload.endLabel[series];
    const place = series === "realised" ? undefined : payload.endPlace[series];
    const dy = place === "above" ? -6 : place === "below" ? 14 : 4;
    const mark =
      series === "plan" ? (
        <circle cx={cx} cy={cy} r={4} fill="#fff" stroke={color} strokeWidth={2} />
      ) : series === "realised" ? (
        <rect x={cx - 4} y={cy - 4} width={8} height={8} fill={color} stroke="#fff" strokeWidth={1} />
      ) : (
        <circle cx={cx} cy={cy} r={4} fill={color} stroke="#fff" strokeWidth={1} />
      );
    return (
      <g data-series={series} data-t={payload.t}>
        {mark}
        {label && (
          // Plan and forecast end on the Value Period end: label to the right of the point (the margin holds it), so
          // it never sits on a line. The realised label ends mid-chart and stays above-left of its point.
          <text
            x={series === "realised" ? cx - 6 : cx + 20}
            y={series === "realised" ? cy - 9 : cy + dy}
            textAnchor={series === "realised" ? "end" : "start"}
            className="fill-slate-800 text-[11px] font-semibold"
            data-testid={`trajectory-end-label-${series}`}
          >
            {label}
          </text>
        )}
      </g>
    );
  }
  return Dot;
}

export function ValueTrajectoryChart({
  rows,
  domain,
  xTicks,
  yTicks,
  today,
  checkpoint,
  versionChange = null,
  gap = null,
  ariaLabel,
}: {
  rows: TrajectoryRow[];
  domain: [number, number];
  xTicks: [number, string][];
  yTicks: [number, string][];
  today: Marker | null;
  checkpoint: Marker | null;
  versionChange?: Marker | null;
  gap?: GapBracket | null;
  ariaLabel: string;
}) {
  const xLabel = new Map(xTicks);
  const yLabel = new Map(yTicks);
  const has = (k: "plan" | "realised" | "forecast") => rows.some((r) => r[k] !== null);
  return (
    <div className="h-[340px] w-full" role="img" aria-label={ariaLabel} data-testid="trajectory-chart">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 34, right: 172, bottom: 4, left: 8 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={domain}
            ticks={xTicks.map(([t]) => t)}
            tickFormatter={(t: number) => xLabel.get(t) ?? ""}
            tick={{ fontSize: 11, fill: "#475569" }}
            tickLine={false}
            axisLine={{ stroke: "#cbd5e1" }}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            type="number"
            domain={[yTicks[0]?.[0] ?? 0, yTicks.at(-1)?.[0] ?? 1]}
            ticks={yTicks.map(([v]) => v)}
            tickFormatter={(v: number) => yLabel.get(v) ?? ""}
            tick={{ fontSize: 11, fill: "#475569" }}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          {/* Month rows carry no plotted values; keep their (null) payload so the card can read the row's governed tooltip
              model. The card never derives a value from the payload. */}
          <Tooltip
            content={TipContent}
            filterNull={false}
            cursor={{ stroke: "#64748b", strokeWidth: 1 }}
            isAnimationActive={false}
          />
          {gap && (
            <ReferenceLine
              segment={[
                { x: gap.t, y: gap.forecast },
                { x: gap.t, y: gap.plan },
              ]}
              shape={gapShape(gap)}
              ifOverflow="visible"
            />
          )}
          {checkpoint && (
            <ReferenceLine
              x={checkpoint.t}
              stroke="#334155"
              strokeDasharray="4 3"
              label={markerLabel(checkpoint, "#334155")}
            />
          )}
          {versionChange && (
            <ReferenceLine
              x={versionChange.t}
              stroke="#2563eb"
              strokeDasharray="1 3"
              label={markerLabel(versionChange, "#1d4ed8")}
            />
          )}
          {today && (
            <ReferenceLine x={today.t} stroke="#b45309" strokeWidth={1.5} label={markerLabel(today, "#b45309", 600)} />
          )}
          {has("plan") && (
            <Line
              dataKey="plan"
              name={TRAJECTORY_SERIES.plan.label}
              stroke={TRAJECTORY_SERIES.plan.color}
              strokeWidth={2}
              strokeDasharray="7 4"
              connectNulls
              dot={dot("plan")}
              activeDot={false}
              isAnimationActive={false}
            />
          )}
          {has("realised") && (
            <Line
              dataKey="realised"
              name={TRAJECTORY_SERIES.realised.label}
              stroke={TRAJECTORY_SERIES.realised.color}
              strokeWidth={3}
              connectNulls
              dot={dot("realised")}
              activeDot={false}
              isAnimationActive={false}
            />
          )}
          {has("forecast") && (
            <Line
              dataKey="forecast"
              name={TRAJECTORY_SERIES.forecast.label}
              stroke={TRAJECTORY_SERIES.forecast.color}
              strokeWidth={2.5}
              strokeDasharray="2 4"
              strokeLinecap="round"
              connectNulls
              dot={dot("forecast")}
              activeDot={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
