import { SERIES } from "./series";

// Value Case Evolution chart (Phase 4D.5; E1 redesign 4D.9N.1A). Server-rendered SVG on GOVERNANCE-EVENT spacing (not
// elapsed time): a strong stepped Authorised Commitment line that starts from the Original Business Case, explicit
// steps where a version is authorised (with its Value Change), and at each formal review a checkpoint — realised
// column, formal forecast marker and a Value Gap bracket up to the commitment measured against. Every value a person
// reads is a server-formatted string; decimal strings become numbers only to place marks. Nothing is interpolated.

export type EvolutionStep =
  | { kind: "original"; key: string; axis: string; sub: string; value: number; text: string }
  | {
      kind: "authorisation";
      key: string;
      axis: string;
      sub: string;
      /** e.g. "V2". */
      version: string;
      value: number;
      text: string;
      /** Movement from the commitment before it (formatted), when there was one. */
      delta: string | null;
    }
  | {
      kind: "review";
      key: string;
      axis: string;
      sub: string;
      against: number | null;
      forecast: number | null;
      realised: number | null;
      text: { against: string | null; forecast: string | null; realised: string | null; gap: string | null };
    };

const W = 960;
const H = 360;
const M = { top: 34, right: 24, bottom: 52, left: 64 };
export const EVOLUTION_MARGIN_FRACTIONS = { left: M.left / W, right: M.right / W };

export function EvolutionChart({
  steps,
  ticks,
  ariaLabel,
}: {
  steps: EvolutionStep[];
  ticks: [number, string][];
  ariaLabel: string;
}) {
  const n = steps.length;
  const band = (W - M.left - M.right) / Math.max(n, 1);
  const cx = (i: number) => M.left + band * (i + 0.5);
  const yMax = ticks.at(-1)?.[0] || 1;
  const y = (v: number) => M.top + (1 - v / yMax) * (H - M.top - M.bottom);
  const auths = steps.map((s, i) => [s, i] as const).filter(([s]) => s.kind === "authorisation");
  const original = steps.findIndex((s) => s.kind === "original");
  const firstAuth = auths[0];

  // Commitment staircase: Original (grey, dashed) → V1 → … (blue, solid), held to the right edge.
  let promise = "";
  if (original >= 0 && firstAuth) {
    const o = steps[original] as Extract<EvolutionStep, { kind: "original" }>;
    promise = `M${cx(original)},${y(o.value)} H${cx(firstAuth[1])} V${y((firstAuth[0] as { value: number }).value)}`;
  }
  let commitment = "";
  if (firstAuth) {
    commitment = `M${cx(firstAuth[1])},${y((firstAuth[0] as { value: number }).value)}`;
    for (const [s, i] of auths.slice(1)) commitment += ` H${cx(i)} V${y((s as { value: number }).value)}`;
    commitment += ` H${W - M.right}`;
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="group"
      aria-label={ariaLabel}
      data-testid="evolution-chart"
    >
      {ticks.map(([v, label]) => (
        <g key={v}>
          <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} stroke="#e2e8f0" />
          <text x={M.left - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#475569">
            {label}
          </text>
        </g>
      ))}
      {steps.map((s, i) => (
        <g key={`axis-${s.key}`}>
          {i > 0 && (
            <line x1={M.left + band * i} x2={M.left + band * i} y1={M.top} y2={H - M.bottom} stroke="#f1f5f9" />
          )}
          <text x={cx(i)} y={H - M.bottom + 18} textAnchor="middle" fontSize={12} fontWeight={600} fill="#0f172a">
            {s.axis}
          </text>
          <text x={cx(i)} y={H - M.bottom + 33} textAnchor="middle" fontSize={11} fill="#64748b">
            {s.sub}
          </text>
        </g>
      ))}
      <line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} stroke="#94a3b8" />

      {promise && (
        <path
          d={promise}
          fill="none"
          stroke="#94a3b8"
          strokeWidth={2}
          strokeDasharray="6 4"
          data-testid="evolution-promise"
        />
      )}
      {commitment && (
        <path
          d={commitment}
          fill="none"
          stroke={SERIES.authorised.color}
          strokeWidth={3}
          data-testid="evolution-commitment"
        />
      )}

      {steps.map((s, i) => {
        const c = cx(i);
        if (s.kind === "original")
          return (
            <g
              key={s.key}
              role="img"
              aria-label={`${SERIES.original.label}: ${s.text}`}
              data-testid="evolution-mark-original"
            >
              <path
                d={`M${c},${y(s.value) - 7} L${c + 7},${y(s.value)} L${c},${y(s.value) + 7} L${c - 7},${y(s.value)} Z`}
                fill="#fff"
                stroke={SERIES.original.color}
                strokeWidth={2}
              />
              <text x={c} y={y(s.value) - 13} textAnchor="middle" fontSize={12} fontWeight={600} fill="#7c2d12">
                Original · {s.text}
              </text>
            </g>
          );
        if (s.kind === "authorisation") {
          const before = steps
            .slice(0, i)
            .reverse()
            .find((x): x is Extract<EvolutionStep, { value: number }> => x.kind !== "review");
          const labelY = Math.min(y(s.value), before ? y(before.value) : y(s.value)) - 12;
          return (
            <g
              key={s.key}
              role="img"
              aria-label={`${SERIES.authorised.label}, ${s.version}: ${s.text}`}
              data-testid={`evolution-mark-${s.key}`}
            >
              <circle cx={c} cy={y(s.value)} r={6} fill={SERIES.authorised.color} stroke="#fff" strokeWidth={2} />
              <text x={c} y={labelY} textAnchor="middle" fontSize={12} fontWeight={700} fill="#1e3a8a">
                {`${s.version} · ${s.text}`}
              </text>
              {s.delta && (
                <text x={c + 10} y={y(s.value) + 17} textAnchor="start" fontSize={11} fontWeight={600} fill="#1d4ed8">
                  {s.delta}
                </text>
              )}
            </g>
          );
        }
        // Review checkpoint: realised column, forecast marker, Value Gap bracket up to the commitment measured against.
        const colX = c - 30;
        const bx = c + 6;
        const yF = s.forecast !== null ? y(s.forecast) : null;
        const yA = s.against !== null ? y(s.against) : null;
        const gapPx = yF !== null && yA !== null ? Math.abs(yF - yA) : 0;
        return (
          <g key={s.key} data-testid={`evolution-checkpoint-${s.key}`}>
            {s.realised !== null && (
              <g role="img" aria-label={`${SERIES.realised.label}, ${s.axis}: ${s.text.realised}`}>
                <rect
                  x={colX}
                  y={y(s.realised)}
                  width={18}
                  height={Math.max(y(0) - y(s.realised), 1)}
                  fill={SERIES.realised.color}
                  rx={2}
                />
                <text
                  x={colX + 9}
                  y={y(s.realised) - 5}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={600}
                  fill="#3f6212"
                >
                  {s.text.realised}
                </text>
              </g>
            )}
            {yF !== null && yA !== null && s.text.gap && (
              <g role="img" aria-label={`Value Gap, ${s.axis}: ${s.text.gap}`}>
                <path d={`M${bx - 4},${yA} H${bx} V${yF} H${bx - 4}`} fill="none" stroke="#b91c1c" strokeWidth={1.5} />
                <text
                  x={bx + 6}
                  y={gapPx >= 14 ? (yA + yF) / 2 + 4 : Math.min(yA, yF) - 5}
                  fontSize={11}
                  fontWeight={600}
                  fill="#b91c1c"
                >
                  Gap {s.text.gap}
                </text>
              </g>
            )}
            {yF !== null && (
              <g role="img" aria-label={`${SERIES.forecast.label}, ${s.axis}: ${s.text.forecast}`}>
                <circle cx={bx} cy={yF} r={5.5} fill={SERIES.forecast.color} stroke="#fff" strokeWidth={1.5} />
                <text x={bx} y={yF + 19} textAnchor="middle" fontSize={11} fontWeight={600} fill="#155e75">
                  {s.text.forecast}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
