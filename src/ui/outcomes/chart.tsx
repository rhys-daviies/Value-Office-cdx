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

import { OUTCOME_COLOR, REFERENCE_COLORS } from "./marks";

// Alternative Value Outcomes chart (Phase 4D.6). Client-only presentation of one review's decision
// economics, already derived and formatted on the server. A horizontal dot plot of discrete totals:
// rows are references or stored scenarios — there is no time axis and no path between them. Decimal
// strings become numbers here only to place marks; every value read is server-formatted.

export type OutcomePoint = {
  key: string;
  role: "authorised" | "forecast" | "outcome";
  /** Row label, e.g. "Authorised Value (V1)" or the stored scenario label. */
  label: string;
  /** Row sub-label: reference note or role badges ("Cardaxia recommendation · Client selected"). */
  sub: string;
  recommended: boolean;
  selected: boolean;
  value: string;
  display: string;
  tooltip: string[];
};

type Row = Omit<OutcomePoint, "value"> & { value: number };

type DotProps = { cx?: number; cy?: number; payload?: Row };

function Mark({ cx, cy, payload }: DotProps) {
  if (cx === undefined || cy === undefined || !payload) return <g />;
  const name = `${payload.label}${payload.sub ? ` (${payload.sub})` : ""}: ${payload.display}`;
  const label = (
    <text x={cx + 12} y={cy + 4} className="fill-slate-800 text-[11px] font-semibold">
      {payload.display}
    </text>
  );
  if (payload.role !== "outcome") {
    const color = REFERENCE_COLORS[payload.role];
    return (
      <g role="img" aria-label={name} data-role={payload.role}>
        {payload.role === "authorised" ? (
          <path
            d={`M${cx},${cy - 7} L${cx + 7},${cy} L${cx},${cy + 7} L${cx - 7},${cy} Z`}
            fill="#ffffff"
            stroke={color}
            strokeWidth={2}
          />
        ) : (
          <circle cx={cx} cy={cy} r={6} fill="#ffffff" stroke={color} strokeWidth={2} />
        )}
        {label}
      </g>
    );
  }
  return (
    <g
      role="img"
      aria-label={name}
      data-role="outcome"
      data-recommended={payload.recommended || undefined}
      data-selected={payload.selected || undefined}
    >
      {payload.recommended && <circle cx={cx} cy={cy} r={10} fill="none" stroke={OUTCOME_COLOR} strokeWidth={1.5} />}
      {payload.selected ? (
        <rect x={cx - 6} y={cy - 6} width={12} height={12} rx={1} fill={OUTCOME_COLOR} stroke="#fff" strokeWidth={2} />
      ) : (
        <circle cx={cx} cy={cy} r={6} fill={OUTCOME_COLOR} stroke="#fff" strokeWidth={2} />
      )}
      {label}
    </g>
  );
}

function RowTick({ x, y, payload, rows }: { x?: number; y?: number; payload?: { value: string }; rows: Row[] }) {
  const row = rows.find((r) => r.key === payload?.value);
  if (!row || x === undefined || y === undefined) return null;
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  return (
    <g transform={`translate(${x},${y})`}>
      <text dx={-8} dy={row.sub ? -2 : 4} textAnchor="end" className="fill-slate-800 text-[11px] font-medium">
        {clip(row.label, 30)}
      </text>
      {row.sub && (
        <text dx={-8} dy={11} textAnchor="end" className="fill-slate-500 text-[10px]">
          {clip(row.sub, 36)}
        </text>
      )}
    </g>
  );
}

function OutcomeTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  const row = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
  if (!row) return null;
  const [heading, ...lines] = row.tooltip;
  return (
    <div className="max-w-72 rounded border border-slate-300 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold text-slate-900">{heading}</div>
      {lines.map((l) => (
        <div key={l} className="text-slate-700">
          {l}
        </div>
      ))}
    </div>
  );
}

export function OutcomesChart({
  points,
  ticks,
  ariaLabel,
  testId,
}: {
  points: OutcomePoint[];
  /** Server-formatted x-axis ticks: [value, label]. First and last bound the axis. */
  ticks: [string, string][];
  ariaLabel: string;
  testId: string;
}) {
  const rows: Row[] = points.map((p) => ({ ...p, value: Number(p.value) })); // presentation boundary
  const values = ticks.map(([v]) => Number(v));
  const tickLabel = new Map(ticks.map(([v, l]) => [Number(v), l]));
  const ref = (role: "authorised" | "forecast") => rows.find((r) => r.role === role);
  const authorised = ref("authorised");
  const forecast = ref("forecast");
  const height = 80 + rows.length * 40;

  return (
    <div className="w-full" style={{ height }} role="figure" aria-label={ariaLabel} data-testid={testId}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} layout="vertical" margin={{ top: 8, right: 56, bottom: 4, left: 8 }}>
          <CartesianGrid horizontal={false} stroke="#eef2f7" />
          <XAxis
            type="number"
            domain={[values[0] ?? 0, values.at(-1) ?? 0]}
            ticks={values}
            tickFormatter={(v: number) => tickLabel.get(v) ?? ""}
            tickLine={false}
            axisLine={{ stroke: "#cbd5e1" }}
            tick={{ fontSize: 11, fill: "#64748b" }}
          />
          <YAxis
            type="category"
            dataKey="key"
            width={220}
            padding={{ top: 20, bottom: 20 }}
            interval={0}
            tickLine={false}
            axisLine={false}
            tick={<RowTick rows={rows} />}
          />
          {authorised && (
            <ReferenceLine x={authorised.value} stroke={REFERENCE_COLORS.authorised} strokeDasharray="4 3" />
          )}
          {forecast && <ReferenceLine x={forecast.value} stroke={REFERENCE_COLORS.forecast} strokeDasharray="2 3" />}
          <Tooltip content={OutcomeTooltip} cursor={{ fill: "#f8fafc" }} />
          <Line dataKey="value" stroke="none" dot={Mark} activeDot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
