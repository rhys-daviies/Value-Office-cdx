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

import { forecastConnectorRuns } from "./segments";
import { SERIES } from "./series";

// Value Case Evolution chart (Phase 4D.5). Client-only presentation of a governed history that the
// server has already derived and formatted. Amounts arrive as decimal strings; they are converted to
// numbers here only to place marks, and every value a person reads is the server-formatted string.
// Nothing is recalculated, interpolated or predicted.

export type ChartPoint = {
  key: string;
  kind: "original" | "authorisation" | "review";
  /** Axis label, e.g. "V1", "Review #2", "Business Case". */
  label: string;
  /** Axis sub-label: the governed date, or a statement that none exists. */
  sub: string;
  original: string | null;
  /** Authorised Value in force at this point (the step line). */
  authorised: string | null;
  forecast: string | null;
  /** Review events: the version the forecast was measured against (breaks the forecast connector). */
  againstVersionNumber: number | null;
  realised: string | null;
  /** Pre-formatted tooltip lines; first is the heading. */
  tooltip: string[];
  /** Pre-formatted values for mark labels. */
  display: { original?: string; authorised?: string; forecast?: string; realised?: string };
};

type Row = Omit<ChartPoint, "original" | "authorised" | "forecast" | "realised"> & {
  original: number | null;
  authorised: number | null;
  forecast: number | null;
  realised: number | null;
  /** Connector values, one key per run of same-version forecasts (fc0, fc1, …). */
  [connector: `fc${number}`]: number | null;
};

// Presentation boundary: the only place a decimal string becomes a number, for mark position only.
const y = (v: string | null) => (v === null ? null : Number(v));

type DotProps = { cx?: number; cy?: number; payload?: Row; value?: number | null };

function marker(series: keyof typeof SERIES, shape: "diamond" | "bar" | "circle" | "square") {
  function Marker({ cx, cy, payload, value }: DotProps) {
    if (cx === undefined || cy === undefined || !payload || value === null || value === undefined) return <g />;
    if (series === "authorised" && payload.kind !== "authorisation") return <g />;
    const color = SERIES[series].color;
    const name = `${SERIES[series].label}, ${payload.label}: ${payload.display[series] ?? ""}`;
    const ring = { stroke: "#ffffff", strokeWidth: 2 };
    return (
      <g role="img" aria-label={name} data-series={series} data-event={payload.key}>
        {shape === "diamond" && (
          <path d={`M${cx},${cy - 7} L${cx + 7},${cy} L${cx},${cy + 7} L${cx - 7},${cy} Z`} fill={color} {...ring} />
        )}
        {shape === "bar" && <rect x={cx - 7} y={cy - 2.5} width={14} height={5} rx={1} fill={color} {...ring} />}
        {shape === "circle" && <circle cx={cx} cy={cy} r={5.5} fill={color} {...ring} />}
        {shape === "square" && <rect x={cx - 5} y={cy - 5} width={10} height={10} rx={1} fill={color} {...ring} />}
      </g>
    );
  }
  return Marker;
}

const OriginalDot = marker("original", "diamond");
const AuthorisedDot = marker("authorised", "bar");
const ForecastDot = marker("forecast", "circle");
const RealisedDot = marker("realised", "square");

function Tick({ x, y: ty, payload, rows }: { x?: number; y?: number; payload?: { value: string }; rows: Row[] }) {
  const row = rows.find((r) => r.key === payload?.value);
  if (!row || x === undefined || ty === undefined) return null;
  return (
    <g transform={`translate(${x},${ty})`}>
      <text dy={14} textAnchor="middle" className="fill-slate-700 text-[11px] font-medium">
        {row.label}
      </text>
      <text dy={28} textAnchor="middle" className="fill-slate-500 text-[10px]">
        {row.sub}
      </text>
    </g>
  );
}

function EventTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  const row = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
  if (!row) return null;
  const [heading, ...lines] = row.tooltip;
  return (
    <div className="max-w-64 rounded border border-slate-300 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold text-slate-900">{heading}</div>
      {lines.map((l) => (
        <div key={l} className="text-slate-700">
          {l}
        </div>
      ))}
    </div>
  );
}

export function EvolutionChart({
  points,
  currencyTicks,
  ariaLabel,
}: {
  points: ChartPoint[];
  /** Server-formatted y-axis ticks: [value, label]. */
  currencyTicks: [string, string][];
  ariaLabel: string;
}) {
  const runs = forecastConnectorRuns(points);
  const rows: Row[] = points.map((p) => {
    const row: Row = {
      ...p,
      original: y(p.original),
      authorised: y(p.authorised),
      forecast: y(p.forecast),
      realised: y(p.realised),
    };
    runs.forEach((keys, i) => (row[`fc${i}`] = keys.includes(p.key) ? y(p.forecast) : null));
    return row;
  });
  const ticks = currencyTicks.map(([v]) => Number(v));
  const tickLabel = new Map(currencyTicks.map(([v, l]) => [Number(v), l]));
  const top = ticks.at(-1) ?? 0;

  return (
    <div
      className="h-72 w-full"
      role="figure"
      aria-label={ariaLabel}
      data-testid="evolution-chart"
      data-forecast-connectors={runs.map((keys) => keys.join(">")).join("|")}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 12, right: 24, bottom: 20, left: 8 }}>
          <CartesianGrid vertical={false} stroke="#e2e8f0" />
          <XAxis
            dataKey="key"
            interval={0}
            tickLine={false}
            axisLine={{ stroke: "#cbd5e1" }}
            tick={<Tick rows={rows} />}
            height={36}
            padding={{ left: 24, right: 24 }}
          />
          <YAxis
            domain={[0, top]}
            ticks={ticks}
            tickFormatter={(v: number) => tickLabel.get(v) ?? ""}
            tickLine={false}
            axisLine={false}
            width={64}
            tick={{ fontSize: 11, fill: "#64748b" }}
          />
          {rows
            .filter((r) => r.kind === "authorisation")
            .map((r) => (
              <ReferenceLine key={r.key} x={r.key} stroke="#cbd5e1" strokeDasharray="3 3" />
            ))}
          <Tooltip content={EventTooltip} cursor={{ stroke: "#94a3b8", strokeDasharray: "2 2" }} />
          <Line
            dataKey="authorised"
            name={SERIES.authorised.label}
            type="stepAfter"
            stroke={SERIES.authorised.color}
            strokeWidth={2}
            dot={AuthorisedDot}
            activeDot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          {runs.map((keys, i) => (
            <Line
              key={keys.join(">")}
              dataKey={`fc${i}`}
              legendType="none"
              tooltipType="none"
              type="linear"
              stroke={SERIES.forecast.color}
              strokeWidth={1.5}
              strokeDasharray="2 4"
              dot={false}
              activeDot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
          <Line
            dataKey="forecast"
            name={SERIES.forecast.label}
            stroke="none"
            dot={ForecastDot}
            activeDot={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="realised"
            name={SERIES.realised.label}
            type="linear"
            stroke={SERIES.realised.color}
            strokeWidth={1.5}
            strokeDasharray="2 4"
            dot={RealisedDot}
            activeDot={false}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            dataKey="original"
            name={SERIES.original.label}
            stroke="none"
            dot={OriginalDot}
            activeDot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
