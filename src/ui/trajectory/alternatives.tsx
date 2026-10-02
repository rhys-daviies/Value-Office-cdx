import type { AlternativeTrajectoryNote, AlternativeValueTrajectories as Data } from "@/server/queries/trajectory";
import { GovernedTag } from "@/ui/components/badges";
import { Expander } from "@/ui/components/expander";
import { formatDate, formatMoneyChange, formatMoneyShort, formatPeriod } from "@/ui/format";
import { SCENARIO_KIND_LABELS } from "@/ui/labels";
import { AlternativeValueOutcomes, DecisionSummary, RECOMMENDATION_LABEL } from "@/ui/outcomes/outcomes";

import { AlternativeTrajectoriesChart, OptionMark } from "./alternatives-chart";
import { buildAlternativePresentation, optionRoles, type AlternativeSeries } from "./alternatives-model";

// Alternative Value Trajectories (Phase 4D.9F): the future value paths assessed at one Assurance Review, branching from
// the shared governed history at the review. Consultant-entered option milestones only — not a simulator, prediction
// or ranking. Where no option has explicit phasing, the 4D.6 endpoint-only Alternative Value Outcomes remain the visual.

const UNAVAILABLE: Partial<Record<string, string>> = {
  net_present_value: "Value trajectory is not available for NPV, so each option is shown as its stored total.",
  other: "Value trajectory is not available for this Value Basis, so each option is shown as its stored total.",
  period_not_set: "Value Period not set, so each option is shown as its stored total.",
  no_option_paths: "Option phasing not entered, so each option is shown as its stored total.",
};

function noteText(n: AlternativeTrajectoryNote, a: Data): string {
  const seq = a.outcomes.review.sequence;
  switch (n) {
    case "no_valid_anchor":
      return `Review #${seq} does not establish a complete realised position, so each path begins at its first entered milestone.`;
    case "realised_run_rate_not_recorded":
      return "Realised run-rate is not currently recorded, so each path begins at its first entered milestone.";
    case "realised_partial_excluded":
      return "Earlier realised positions recorded for only some financial drivers are not plotted.";
    case "options_without_phasing":
      return `Phasing not entered for ${a.options
        .filter((o) => o.points.length === 0)
        .map((o) => o.label)
        .join(", ")}: shown as its stored total at the Value Period end, with no path.`;
    case "path_not_reconciled":
      return `Entered milestones do not end at the stored total for ${a.options
        .filter((o) => o.points.length > 0 && o.reconciliation.state !== "reconciled")
        .map((o) => o.label)
        .join(", ")}; its label shows the last entered milestone.`;
  }
}

function Legend({ series, history }: { series: AlternativeSeries[]; history: boolean }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-700" data-testid="alternatives-legend">
      {history && (
        <li className="flex items-center gap-1.5">
          <svg width="28" height="12" aria-hidden="true">
            <line x1="0" y1="6" x2="28" y2="6" stroke="#65a30d" strokeOpacity="0.55" strokeWidth="2" />
            <rect x="10" y="2" width="8" height="8" fill="#65a30d" />
          </svg>
          Realised (shared history)
        </li>
      )}
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <svg width="28" height="12" aria-hidden="true">
            {!s.endpointOnly && (
              <line
                x1="0"
                y1="6"
                x2="28"
                y2="6"
                stroke={s.color}
                strokeWidth={s.emphasis ? 3 : 2}
                strokeDasharray={s.dash}
              />
            )}
            <OptionMark marker={s.marker} cx={14} cy={6} color={s.color} hollow={s.endpointOnly} />
          </svg>
          <span>
            {s.label}
            {s.roles && <span className="text-slate-500"> · {s.roles}</span>}
            {s.endpointOnly && <span className="text-slate-500"> · phasing not entered</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function AlternativeTrajectories({ a, currency }: { a: Data; currency: string }) {
  const m = (v: string | null) => formatMoneyShort(v, currency);
  const p = buildAlternativePresentation(a, currency)!;
  const d = a.outcomes;
  const end = formatDate(a.period!.end);
  const measureLabel = a.measure === "cumulative" ? "Cumulative Value" : "Annual Run Rate";
  const summary = `Alternative Value Trajectories assessed at Review #${d.review.sequence}, ${formatDate(d.review.date)}${
    a.anchor ? `, branching from realised ${m(a.anchor.value)}` : ""
  }. Stored option totals at ${end}: ${a.options
    .map((o) => `${o.label}${optionRoles(o) ? ` (${optionRoles(o)})` : ""} ${m(o.totalValue)}`)
    .join("; ")}. The table lists every value.`;
  const notes = a.notes.map((n) => noteText(n, a));
  const recommended = a.options.find((o) => o.recommended);
  return (
    <section
      id="outcomes"
      aria-labelledby="alternatives-title"
      className="mb-6 scroll-mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      data-testid="alternative-value-trajectories"
      data-status={a.status}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="alternatives-title" className="text-base font-semibold text-slate-900">
            Alternative Value Trajectories
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Future value paths assessed at Review #{d.review.sequence} ({formatDate(d.review.date)}), measured against V
            {d.review.againstVersionNumber}. All options share the history to the review and differ only after it.
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Value Period {formatPeriod(a.period!.start, a.period!.end)} · {measureLabel}
          </p>
        </div>
        <GovernedTag>Governed</GovernedTag>
      </div>
      <DecisionSummary d={d} />
      <Legend series={p.series} history={a.history !== null} />
      <AlternativeTrajectoriesChart
        series={p.series}
        rows={p.rows}
        domain={p.domain}
        xTicks={p.xTicks}
        yTicks={p.yTicks}
        review={p.review}
        labels={p.labels}
        ariaLabel={summary}
      />
      {notes.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-slate-600" data-testid="alternatives-notes">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs text-slate-500">
        Only entered milestones and formally recorded values are plotted; lines between points are visual joins, not
        values. Final values are the stored option totals at {end}.
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm" data-testid="alternatives-table">
          <caption className="sr-only">
            Options assessed at Review #{d.review.sequence}, {formatDate(d.review.date)}
          </caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Option
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Role
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                Stored total at {end}
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                Difference from {RECOMMENDATION_LABEL}
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Phasing
              </th>
              <th scope="col" className="py-1.5 font-medium">
                Narrative
              </th>
            </tr>
          </thead>
          <tbody>
            {a.options.map((o) => (
              <tr key={o.scenarioId} className="border-b border-slate-100 align-top" data-testid="alternatives-row">
                <th scope="row" className="py-1.5 pr-3 text-left font-medium">
                  {o.label}
                </th>
                <td className="py-1.5 pr-3 text-slate-600" data-testid="alternatives-role">
                  {optionRoles(o) || "Option"}
                  <span className="block text-xs text-slate-400">{SCENARIO_KIND_LABELS[o.kind]}</span>
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums" data-testid="alternatives-total">
                  {m(o.totalValue)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums" data-testid="alternatives-difference">
                  {o.differenceFromRecommendation === null
                    ? recommended
                      ? "—"
                      : "No recommendation issued"
                    : formatMoneyChange(o.differenceFromRecommendation, currency)}
                </td>
                <td className="py-1.5 pr-3 text-slate-600" data-testid="alternatives-phasing">
                  {o.points.length === 0
                    ? "Phasing not entered"
                    : `${o.points.length} milestone${o.points.length === 1 ? "" : "s"}`}
                </td>
                <td className="max-w-sm py-1.5 text-xs text-slate-600">{o.narrative ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2">
        <Expander summary="Trajectory values" testId="alternatives-values">
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
                r.cells.map(([series, value]) => (
                  <tr
                    key={`${r.t}-${series}`}
                    className="border-t border-slate-100"
                    data-testid="alternatives-value-row"
                  >
                    <td className="py-1 text-slate-600">{r.tip[0]}</td>
                    <td className="py-1">{series}</td>
                    <td className="py-1 text-right tabular-nums">{value}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </Expander>
      </div>
    </section>
  );
}

/**
 * The review's option visual: Alternative Value Trajectories when at least one option has explicit milestones
 * (endpoint-only options shown truthfully alongside); otherwise the 4D.6 endpoint-only Alternative Value Outcomes.
 */
export function ReviewOptionsVisual({ data: a }: { data: Data }) {
  if (a.available) return <AlternativeTrajectories a={a} currency={a.outcomes.currency} />;
  const key = a.status === "basis_not_supported" ? a.valueBasisKind! : a.status;
  return <AlternativeValueOutcomes data={a.outcomes} note={UNAVAILABLE[key]} />;
}
