import type { TrajectoryChartNote, ValueTrajectoryChart } from "@/server/queries/trajectory";
import { GovernedTag } from "@/ui/components/badges";
import { Expander } from "@/ui/components/expander";
import { formatDate, formatMoneyShort, formatPeriod } from "@/ui/format";

import { ValueTrajectoryChart as Chart } from "./chart";
import { buildTrajectoryPresentation } from "./model";
import { TRAJECTORY_SERIES } from "./series";

// Primary Value Trajectory (Phase 4D.9E): against the current Authorised Value Case plan, how value has progressed
// (realised at formal checkpoints), where the latest formal position was, and where it is formally forecast to
// finish — across the real Value Period. Governed records only; joins between points are presentation only.

const UNAVAILABLE: Record<string, string> = {
  basis_not_classified: "Value Basis not classified.",
  net_present_value: "Value trajectory is not available for NPV.",
  other: "Value trajectory is not available for this Value Basis.",
  period_not_set: "Value Period not set.",
};

function noteText(n: TrajectoryChartNote, c: ValueTrajectoryChart): string {
  switch (n) {
    case "plan_phasing_not_entered":
      return "Authorised plan phasing not entered.";
    case "no_formal_position":
      return "No formal Assurance position yet.";
    case "forecast_phasing_not_entered":
      return "Formal forecast phasing not entered.";
    case "forecast_not_comparable":
      return "The latest formal review was measured against a version on a different or unclassified Value Basis, so its forecast is not plotted.";
    case "formal_measured_against_earlier_version":
      return `The latest formal position was measured against V${c.latestFormal!.againstVersionNumber}.`;
    case "realised_run_rate_not_recorded":
      return "Realised run-rate is not currently recorded.";
    case "realised_partial_excluded":
      return `Realised not plotted where incomplete (${c
        .realised!.excluded.filter((e) => e.reason === "incomplete")
        .map((e) => `Review #${e.sequence}`)
        .join(", ")}: realised assessed for only some financial drivers).`;
  }
}

function Legend({ c }: { c: ValueTrajectoryChart }) {
  const item = (swatch: React.ReactNode, label: string) => (
    <li className="flex items-center gap-1.5">
      <svg width="28" height="12" aria-hidden="true">
        {swatch}
      </svg>
      {label}
    </li>
  );
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-700" data-testid="trajectory-legend">
      {item(
        <>
          <line
            x1="0"
            y1="6"
            x2="28"
            y2="6"
            stroke={TRAJECTORY_SERIES.plan.color}
            strokeWidth="2"
            strokeDasharray="7 4"
          />
          <circle cx="14" cy="6" r="3.5" fill="#fff" stroke={TRAJECTORY_SERIES.plan.color} strokeWidth="2" />
        </>,
        `${TRAJECTORY_SERIES.plan.label} (V${c.version?.versionNumber})`,
      )}
      {c.measure === "cumulative" &&
        item(
          <>
            <line x1="0" y1="6" x2="28" y2="6" stroke={TRAJECTORY_SERIES.realised.color} strokeWidth="3" />
            <rect x="10" y="2" width="8" height="8" fill={TRAJECTORY_SERIES.realised.color} />
          </>,
          `${TRAJECTORY_SERIES.realised.label} (formal checkpoints)`,
        )}
      {item(
        <>
          <line
            x1="0"
            y1="6"
            x2="28"
            y2="6"
            stroke={TRAJECTORY_SERIES.forecast.color}
            strokeWidth="2.5"
            strokeDasharray="2 4"
            strokeLinecap="round"
          />
          <circle cx="14" cy="6" r="3.5" fill={TRAJECTORY_SERIES.forecast.color} />
        </>,
        `${TRAJECTORY_SERIES.forecast.label} (latest review)`,
      )}
      {item(<line x1="14" y1="0" x2="14" y2="12" stroke="#334155" strokeDasharray="3 2" />, "Formal position")}
      {item(<line x1="14" y1="0" x2="14" y2="12" stroke="#b45309" strokeWidth="1.5" />, "Today")}
    </ul>
  );
}

export function ValueTrajectory({
  chart: c,
  currency,
  id,
}: {
  chart: ValueTrajectoryChart;
  currency: string;
  id?: string;
}) {
  const m = (v: string | null) => formatMoneyShort(v, currency);
  if (!c.version) return null; // no Authorised Value Case yet: nothing governed to plot
  const header = (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900">
        Value Trajectory <GovernedTag>Governed</GovernedTag>
      </h2>
      {c.period && (
        <p className="text-xs text-slate-500">
          Value Period {formatPeriod(c.period.start, c.period.end)}
          {c.measure ? ` · ${c.measure === "cumulative" ? "Cumulative Value" : "Annual Run Rate"}` : ""}
        </p>
      )}
    </div>
  );
  const shell = (children: React.ReactNode) => (
    <section
      id={id}
      className="mb-4 rounded-lg border border-slate-300 bg-white p-4 shadow-sm"
      data-testid="value-trajectory"
      data-status={c.status}
    >
      {header}
      {children}
    </section>
  );

  if (!c.available) {
    const key = c.status === "basis_not_supported" ? c.valueBasisKind! : c.status;
    return shell(
      <p className="text-sm text-slate-600" data-testid="trajectory-unavailable">
        {UNAVAILABLE[key] ?? "Value trajectory is not available."}
      </p>,
    );
  }

  const p = buildTrajectoryPresentation(c, currency)!;
  const lastRealised = c.realised?.checkpoints.at(-1) ?? null;
  const facts: [string, string, string][] = [
    [`Authorised V${c.version.versionNumber}`, m(c.version.total), `by ${formatDate(c.period!.end)}`],
    ...(lastRealised
      ? ([["Realised", m(lastRealised.value), `at ${formatDate(lastRealised.asOf)}`]] as [string, string, string][])
      : []),
    ...(c.latestFormal
      ? ([
          [
            "Formal forecast",
            c.latestFormal.forecastTotal === null ? "Incomplete" : m(c.latestFormal.forecastTotal),
            `as at ${formatDate(c.latestFormal.reviewDate)} (Review #${c.latestFormal.sequence})`,
          ],
        ] as [string, string, string][])
      : []),
  ];
  const summary = `Value Trajectory, ${formatPeriod(c.period!.start, c.period!.end)}. ${facts
    .map(([k, v, n]) => `${k} ${v} ${n}`)
    .join(". ")}.`;
  const allNotes = c.notes.map((n) => noteText(n, c));
  if (c.latestFormal && c.today.asOf !== c.latestFormal.reviewDate) {
    allNotes.unshift(
      `Formal position as at ${formatDate(c.latestFormal.reviewDate)} (Review #${c.latestFormal.sequence}); today is ${formatDate(c.today.asOf)}.`,
    );
  }
  if (!c.today.inPeriod) allNotes.push(`Today (${formatDate(c.today.asOf)}) is outside the Value Period.`);

  return shell(
    <>
      <dl className="mb-3 flex flex-wrap gap-x-8 gap-y-2" data-testid="trajectory-facts">
        {facts.map(([k, v, n]) => (
          <div key={k}>
            <dt className="text-xs text-slate-500">{k}</dt>
            <dd className="text-lg font-semibold text-slate-900">
              {v} <span className="text-xs font-normal text-slate-500">{n}</span>
            </dd>
          </div>
        ))}
      </dl>
      <Legend c={c} />
      <Chart
        rows={p.rows}
        domain={p.domain}
        xTicks={p.xTicks}
        yTicks={p.yTicks}
        today={p.today}
        checkpoint={p.checkpoint}
        ariaLabel={summary}
      />
      {allNotes.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-slate-600" data-testid="trajectory-notes">
          {allNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs text-slate-500">
        Only entered and formally recorded values are plotted; lines between points are visual joins, not values.
      </p>
      <div className="mt-2">
        <Expander summary="Trajectory values" testId="trajectory-table">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-1 font-medium">Date</th>
                <th className="py-1 font-medium">Series</th>
                <th className="py-1 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.flatMap((r) =>
                r.tip.slice(1).map((line) => {
                  const [series, value] = line.split(/: (?=[^:]+$)/);
                  return (
                    <tr key={`${r.t}-${line}`} className="border-t border-slate-100" data-testid="trajectory-table-row">
                      <td className="py-1 text-slate-600">{r.tip[0]}</td>
                      <td className="py-1">{series}</td>
                      <td className="py-1 text-right tabular-nums">{value}</td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </Expander>
      </div>
    </>,
  );
}
