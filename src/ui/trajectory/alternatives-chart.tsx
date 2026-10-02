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

import {
  DRAFT_FORECAST_STYLE,
  type AlternativeRow,
  type AlternativeSeries,
  type OptionMarker,
  type TerminalLabel,
} from "./alternatives-model";

// Alternative Value Trajectories chart (Phase 4D.9F). Client-only drawing of a model the server has composed and
// formatted. Rows exist ONLY at explicit governed dates, so a tooltip can only appear at a stored observation. Option
// lines join explicit milestones (presentation only); endpoint-only options are a single mark with no line.

const HEIGHT = 360;
const MARGIN = { top: 34, right: 184, bottom: 4, left: 8 };
const X_AXIS_HEIGHT = 30;
const LINE_HEIGHT = 13;

function TipContent({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  const row = payload?.[0]?.payload as AlternativeRow | undefined;
  if (!active || !row || row.tip.length < 2) return null;
  return (
    <div
      className="rounded border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm"
      data-testid="alternatives-tooltip"
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

export function OptionMark({
  marker,
  cx,
  cy,
  color,
  hollow,
}: {
  marker: OptionMarker;
  cx: number;
  cy: number;
  color: string;
  hollow?: boolean;
}) {
  const fill = hollow ? "#fff" : color;
  const common = { fill, stroke: hollow ? color : "#fff", strokeWidth: hollow ? 2 : 1 };
  if (marker === "diamond")
    return <path d={`M${cx},${cy - 5} L${cx + 5},${cy} L${cx},${cy + 5} L${cx - 5},${cy} Z`} {...common} />;
  if (marker === "triangle")
    return <path d={`M${cx},${cy - 5} L${cx + 5},${cy + 4} L${cx - 5},${cy + 4} Z`} {...common} />;
  if (marker === "square") return <rect x={cx - 4} y={cy - 4} width={8} height={8} {...common} />;
  return <circle cx={cx} cy={cy} r={4} {...common} />;
}

type DotProps = { cx?: number; cy?: number; payload?: AlternativeRow; value?: number | null };

function optionDot(s: AlternativeSeries) {
  function Dot({ cx, cy, payload, value }: DotProps) {
    if (cx === undefined || cy === undefined || !payload || value === null || value === undefined) return <g />;
    if (payload.anchor) return <g />; // the branch anchor is the realised mark, not an option point
    return (
      <g data-series={s.key} data-option={s.label} data-t={payload.t}>
        <OptionMark marker={s.marker} cx={cx} cy={cy} color={s.color} hollow={s.endpointOnly} />
      </g>
    );
  }
  return Dot;
}

function DraftForecastDot({ cx, cy, payload, value }: DotProps) {
  if (cx === undefined || cy === undefined || !payload || value === null || value === undefined) return <g />;
  return (
    <g data-series="draftForecast" data-t={payload.t}>
      <circle cx={cx} cy={cy} r={4} fill="#fff" stroke={DRAFT_FORECAST_STYLE.color} strokeWidth={2} />
    </g>
  );
}

function HistoryDot({ cx, cy, payload, value }: DotProps) {
  if (cx === undefined || cy === undefined || !payload || value === null || value === undefined) return <g />;
  return (
    <g data-series="history" data-t={payload.t}>
      <rect x={cx - 4} y={cy - 4} width={8} height={8} fill={payload.anchor ? "#334155" : "#65a30d"} stroke="#fff" />
    </g>
  );
}

/** Terminal labels in the right gutter at their value's height, pushed apart so they never overlap. */
function stackLabels(labels: TerminalLabel[], yMax: number): (TerminalLabel & { top: number })[] {
  const plotTop = MARGIN.top;
  const plotBottom = HEIGHT - MARGIN.bottom - X_AXIS_HEIGHT;
  const y = (v: number) => plotBottom - (yMax === 0 ? 0 : (v / yMax) * (plotBottom - plotTop));
  const sorted = labels
    .map((l) => ({ ...l, top: y(l.value) - LINE_HEIGHT / 2 }))
    .sort((a, b) => a.top - b.top || a.key.localeCompare(b.key));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const minTop = prev.top + prev.lines.length * LINE_HEIGHT + 3;
    if (sorted[i]!.top < minTop) sorted[i]!.top = minTop;
  }
  // Keep the stack inside the chart box (shift up from the bottom if needed).
  const last = sorted.at(-1);
  const overflow = last ? last.top + last.lines.length * LINE_HEIGHT - HEIGHT : 0;
  if (overflow > 0) for (const l of sorted) l.top -= overflow;
  return sorted;
}

export function AlternativeTrajectoriesChart({
  series,
  rows,
  domain,
  xTicks,
  yTicks,
  review,
  labels,
  ariaLabel,
}: {
  series: AlternativeSeries[];
  rows: AlternativeRow[];
  domain: [number, number];
  xTicks: [number, string][];
  yTicks: [number, string][];
  review: { t: number; label: string };
  labels: TerminalLabel[];
  ariaLabel: string;
}) {
  const xLabel = new Map(xTicks);
  const yLabel = new Map(yTicks);
  const yMax = yTicks.at(-1)?.[0] ?? 1;
  const hasHistory = rows.some((r) => r.history !== null);
  const reviewFraction = (review.t - domain[0]) / (domain[1] - domain[0] || 1);
  return (
    <div
      className="relative w-full"
      style={{ height: HEIGHT }}
      role="img"
      aria-label={ariaLabel}
      data-testid="alternatives-chart"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={MARGIN}>
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
            height={X_AXIS_HEIGHT}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            type="number"
            domain={[yTicks[0]?.[0] ?? 0, yMax]}
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
          <ReferenceLine
            x={review.t}
            stroke="#334155"
            strokeDasharray="4 3"
            label={({ viewBox }: { viewBox?: { x?: number; y?: number } }) => (
              <text
                x={(viewBox?.x ?? 0) + (reviewFraction > 0.6 ? -5 : 5)}
                y={(viewBox?.y ?? 0) - 10}
                textAnchor={reviewFraction > 0.6 ? "end" : "start"}
                fontSize={11}
                fill="#334155"
                fontWeight={600}
                data-testid="alternatives-review-marker"
              >
                {review.label}
              </text>
            )}
          />
          {hasHistory && (
            <Line
              dataKey="history"
              name="Realised"
              stroke="#65a30d"
              strokeOpacity={0.55}
              strokeWidth={2}
              connectNulls
              dot={HistoryDot}
              activeDot={false}
              isAnimationActive={false}
            />
          )}
          {rows.some((r) => r.draftForecast !== null) && (
            <Line
              dataKey="draftForecast"
              name={DRAFT_FORECAST_STYLE.label}
              stroke={DRAFT_FORECAST_STYLE.color}
              strokeWidth={2}
              strokeDasharray={DRAFT_FORECAST_STYLE.dash}
              connectNulls
              dot={DraftForecastDot}
              activeDot={false}
              isAnimationActive={false}
            />
          )}
          {series.map((s) => (
            <Line
              key={s.key}
              dataKey={(r: AlternativeRow) => r.values[s.key] ?? null}
              name={s.label}
              stroke={s.endpointOnly ? "none" : s.color}
              strokeWidth={s.emphasis ? 3 : 2}
              strokeDasharray={s.dash}
              strokeLinecap="round"
              connectNulls
              dot={optionDot(s)}
              activeDot={false}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
      <ul className="absolute top-0 right-0 text-[11px] leading-[13px]" style={{ width: MARGIN.right - 12 }}>
        {stackLabels(labels, yMax).map((l) => (
          <li
            key={l.key}
            className="absolute left-0 w-full truncate"
            style={{ top: l.top }}
            data-testid="alternatives-end-label"
            data-series={l.key}
          >
            {l.lines.map((line, i) => (
              <span
                key={line}
                className={`block truncate ${i === 0 ? "font-semibold" : "text-slate-500"}`}
                title={line}
                style={i === 0 ? { color: l.color } : undefined}
              >
                {line}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
