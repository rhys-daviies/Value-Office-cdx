import type { AlternativeTrajectoryNote, AlternativeValueTrajectories as Data } from "@/server/queries/trajectory";
import { GovernedTag, WorkingTag } from "@/ui/components/badges";
import { Expander } from "@/ui/components/expander";
import { formatDate, formatMoneyChange, formatMoneyShort, formatPeriod } from "@/ui/format";
import { scenarioKindLabel } from "@/ui/labels";
import { AlternativeValueOutcomes, RECOMMENDATION_LABEL, SELECTED_LABEL } from "@/ui/outcomes/outcomes";

import { AlternativeTrajectoriesChart, OptionMark } from "./alternatives-chart";
import {
  buildAlternativePresentation,
  DRAFT_FORECAST_STYLE,
  optionRoles,
  PENDING_RECOMMENDATION_LABEL,
  type AlternativeSeries,
} from "./alternatives-model";

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
    case "draft_forecast_phasing_not_entered":
      return "Draft Formal Forecast phasing not entered, so no forecast baseline is shown.";
    case "draft_no_anchor":
      return `Draft: Review #${seq}'s realised position is not formal until finalisation, so each path begins at its first entered milestone.`;
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

/**
 * The key decision comparison (4D.9F decision): Client Selected vs Cardaxia Recommendation, only once a client decision
 * exists. Before that, Cardaxia's issued recommendation alone; each option's stored total stays in the table.
 */
function DecisionComparison({ a, currency }: { a: Data; currency: string }) {
  const m = (v: string) => formatMoneyShort(v, currency);
  const rec = a.options.find((o) => o.recommended);
  const card = (label: string, value: string, note: string, testId: string) => (
    <div className="rounded border border-slate-200 bg-white px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold text-slate-900" data-testid={testId}>
        {value}
      </dd>
      <dd className="truncate text-xs text-slate-500">{note}</dd>
    </div>
  );
  const c = a.decisionComparison;
  return (
    <dl className="mb-3 grid gap-2 sm:grid-cols-3" data-testid="decision-comparison">
      {rec
        ? card(RECOMMENDATION_LABEL, m(rec.totalValue), rec.label, "comparison-recommended")
        : card(RECOMMENDATION_LABEL, "Not issued", "No recommendation issued", "comparison-recommended")}
      {c ? (
        <>
          {card(SELECTED_LABEL, m(c.selected.totalValue), c.selected.label, "comparison-selected")}
          {card(
            "Difference",
            formatMoneyChange(c.difference, currency),
            c.recommended.label === c.selected.label && c.difference === "0.00"
              ? "Client selected Cardaxia's recommendation"
              : `${SELECTED_LABEL} − ${RECOMMENDATION_LABEL}`,
            "comparison-difference",
          )}
        </>
      ) : (
        <div className="flex items-center px-1 text-sm text-slate-600 sm:col-span-2" data-testid="comparison-pending">
          No client decision recorded yet.
        </div>
      )}
    </dl>
  );
}

/** The review's Formal Forecast meaning (PMO, 4D.9N.1B): the formal position the options are assessed from — not an option. */
export const FORMAL_FORECAST_MEANING = "Current expected outcome before the assessed management interventions.";

/**
 * Formal Forecast context (4D.9N.1B): one line distinguishing the review's formal expectation from the assessed options.
 * Finalised reviews only (a draft has no formal forecast); omitted when the forecast is incomplete.
 */
function FormalForecastContext({ a, currency }: { a: Data; currency: string }) {
  const f = a.outcomes.currentFormalForecast;
  if (f === null) return null;
  return (
    <p className="mb-3 text-xs text-slate-600" data-testid="alternatives-formal-forecast">
      <span className="font-semibold text-slate-900" data-testid="alternatives-formal-forecast-value">
        Formal Forecast · {formatMoneyShort(f, currency)}
      </span>
      <span className="ml-2" data-testid="alternatives-formal-forecast-meaning">
        {FORMAL_FORECAST_MEANING}
      </span>
    </p>
  );
}

/** Draft preview header line: the recommendation state as it stands, never presented as issued unless it is. */
function DraftRecommendationState({ a }: { a: Data }) {
  const issued = a.options.find((o) => o.recommended);
  const pending = a.options.find((o) => o.pendingRecommendation);
  return (
    <p className="mb-2 text-sm text-slate-700" data-testid="preview-recommendation">
      {issued
        ? `${RECOMMENDATION_LABEL} (issued): ${issued.label}.`
        : pending
          ? `${PENDING_RECOMMENDATION_LABEL}: ${pending.label}.`
          : "No recommendation saved yet."}
    </p>
  );
}

function Legend({
  series,
  history,
  draftForecast,
}: {
  series: AlternativeSeries[];
  history: boolean;
  draftForecast: boolean;
}) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-700" data-testid="alternatives-legend">
      {draftForecast && (
        <li className="flex items-center gap-1.5">
          <svg width="28" height="12" aria-hidden="true">
            <line
              x1="0"
              y1="6"
              x2="28"
              y2="6"
              stroke={DRAFT_FORECAST_STYLE.color}
              strokeWidth="2"
              strokeDasharray={DRAFT_FORECAST_STYLE.dash}
            />
            <circle cx="14" cy="6" r="3.5" fill="#fff" stroke={DRAFT_FORECAST_STYLE.color} strokeWidth="2" />
          </svg>
          {DRAFT_FORECAST_STYLE.label}
        </li>
      )}
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
            {s.shared && (
              <span className="text-slate-500" data-testid="alternatives-shared-note">
                {" "}
                · same path as {s.shared.with} until {formatDate(s.shared.until)}
              </span>
            )}
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
  const governed = a.governed;
  return (
    <section
      id={governed ? "outcomes" : "alternatives-preview"}
      aria-labelledby="alternatives-title"
      className={`mb-6 scroll-mt-4 rounded-lg p-4 ${
        governed
          ? "border border-slate-200 bg-white shadow-sm"
          : "border-2 border-dashed border-violet-300 bg-violet-50/30"
      }`}
      data-testid={governed ? "alternative-value-trajectories" : "alternative-value-trajectories-preview"}
      data-status={a.status}
      data-governed={governed ? "true" : "false"}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="alternatives-title" className="text-base font-semibold text-slate-900">
            {governed ? "Alternative Value Trajectories" : "Alternative Value Trajectories — preview"}
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {governed
              ? `Future value paths assessed at Review #${d.review.sequence} (${formatDate(d.review.date)}), measured against V${d.review.againstVersionNumber}. All options share the history to the review and differ only after it.`
              : `Option paths entered so far on draft Review #${d.review.sequence} (${formatDate(d.review.date)}). Not a formal value position: options, paths and the recommendation may still change until the review is finalised.`}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Value Period {formatPeriod(a.period!.start, a.period!.end)} · {measureLabel}
          </p>
        </div>
        {governed ? (
          <GovernedTag>Governed</GovernedTag>
        ) : (
          <span data-testid="not-governed-tag">
            <WorkingTag>Draft · Not governed</WorkingTag>
          </span>
        )}
      </div>
      {governed ? <DecisionComparison a={a} currency={currency} /> : <DraftRecommendationState a={a} />}
      {governed && <FormalForecastContext a={a} currency={currency} />}
      <Legend series={p.series} history={a.history !== null} draftForecast={a.draftForecast !== null} />
      <AlternativeTrajectoriesChart
        series={p.series}
        rows={p.rows}
        domain={p.domain}
        xTicks={p.xTicks}
        yTicks={p.yTicks}
        review={p.review}
        labels={p.labels}
        pivots={p.pivots}
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
                  <span className="block text-xs text-slate-400">
                    {scenarioKindLabel(o.kind, d.recommendation !== null)}
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums" data-testid="alternatives-total">
                  {m(o.totalValue)}
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
  if (!a.governed) throw new Error("ReviewOptionsVisual is for finalised reviews; use DraftTrajectoryPreview");
  if (a.available) return <AlternativeTrajectories a={a} currency={a.outcomes.currency} />;
  const key = a.status === "basis_not_supported" ? a.valueBasisKind! : a.status;
  return <AlternativeValueOutcomes data={a.outcomes} note={UNAVAILABLE[key]} />;
}

/**
 * Draft review (Phase 4D.9G): a clearly non-governed preview of the option paths authored so far, or nothing when no
 * option has milestones yet. Never the governed header, styling or roles.
 */
export function DraftTrajectoryPreview({ data: a }: { data: Data }) {
  if (a.governed || !a.available) return null;
  return <AlternativeTrajectories a={a} currency={a.outcomes.currency} />;
}
