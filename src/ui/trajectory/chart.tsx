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

import { TRAJECTORY_SERIES } from "./series";

// Primary Value Trajectory chart (Phase 4D.9E). Client-only drawing of a model the server has composed and formatted.
// Rows exist ONLY at explicit governed dates, so the tooltip can only ever appear at a stored observation — never at an
// interpolated position between points. Straight segments between points are presentation joins. Values arrive as
// numbers for placement only; every value a person reads is a server-formatted string.

export type TrajectoryRow = {
  /** Epoch milliseconds (UTC midnight) of the explicit date. */
  t: number;
  plan: number | null;
  realised: number | null;
  forecast: number | null;
  /** The forecast value on this row is the visual anchor (the review's realised checkpoint), not a forecast point. */
  forecastAnchor: boolean;
  /** Pre-formatted tooltip lines: heading first, then one line per explicit observation on this date. */
  tip: string[];
  /** Pre-formatted end labels for terminal points. */
  endLabel: { plan?: string; forecast?: string; realised?: string };
};

type Marker = { t: number; label: string };

function TipContent({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  const row = payload?.[0]?.payload as TrajectoryRow | undefined;
  if (!active || !row) return null;
  return (
    <div
      className="rounded border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm"
      data-testid="trajectory-tooltip"
    >
      <p className="mb-1 font-semibold text-slate-900">{row.tip[0]}</p>
      {row.tip.slice(1).map((line) => (
        <p key={line} className="text-slate-700">
          {line}
        </p>
      ))}
    </div>
  );
}

type DotProps = { cx?: number; cy?: number; payload?: TrajectoryRow; value?: number | null };

function dot(series: "plan" | "realised" | "forecast") {
  const color = TRAJECTORY_SERIES[series].color;
  function Dot({ cx, cy, payload, value }: DotProps) {
    if (cx === undefined || cy === undefined || !payload || value === null || value === undefined) return <g />;
    if (series === "forecast" && payload.forecastAnchor) return <g />; // anchor is the realised mark, not a forecast
    const label = payload.endLabel[series];
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
          <text
            x={cx - 6}
            y={series === "forecast" ? cy + 16 : cy - 9}
            textAnchor="end"
            className="fill-slate-800 text-[11px] font-semibold"
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
  ariaLabel,
}: {
  rows: TrajectoryRow[];
  domain: [number, number];
  xTicks: [number, string][];
  yTicks: [number, string][];
  today: Marker | null;
  checkpoint: Marker | null;
  ariaLabel: string;
}) {
  const xLabel = new Map(xTicks);
  const yLabel = new Map(yTicks);
  const has = (k: "plan" | "realised" | "forecast") => rows.some((r) => r[k] !== null);
  return (
    <div className="h-[340px] w-full" role="img" aria-label={ariaLabel} data-testid="trajectory-chart">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 28, right: 24, bottom: 4, left: 8 }}>
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
          <Tooltip
            content={TipContent}
            cursor={{ stroke: "#94a3b8", strokeDasharray: "2 3" }}
            isAnimationActive={false}
          />
          {checkpoint && (
            <ReferenceLine
              x={checkpoint.t}
              stroke="#334155"
              strokeDasharray="4 3"
              label={{ value: checkpoint.label, position: "insideTopLeft", fontSize: 11, fill: "#334155" }}
            />
          )}
          {today && (
            <ReferenceLine
              x={today.t}
              stroke="#b45309"
              strokeWidth={1.5}
              label={{ value: today.label, position: "top", fontSize: 11, fill: "#b45309", fontWeight: 600 }}
            />
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
