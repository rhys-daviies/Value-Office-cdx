import Decimal from "decimal.js";

import type { AlternativeValueOutcomes as Data } from "@/server/queries/outcomes";
import { GovernedTag } from "@/ui/components/badges";
import { TextLink } from "@/ui/components/layout";
import { formatDate, formatMoneyChange, formatMoneyShort } from "@/ui/format";
import { SCENARIO_KIND_LABELS } from "@/ui/labels";

import { type OutcomePoint, OutcomesChart } from "./chart";
import { OUTCOME_COLOR, REFERENCE_COLORS } from "./marks";

// Alternative Value Outcomes (Phase 4D.6): a point-in-time comparison of one review's stored
// management-response scenarios and decision economics. Not a time-phased trajectory: each scenario is
// one consultant-entered total. One component, full on the review page and compact on Overview.

export const RECOMMENDATION_LABEL = "Cardaxia recommendation";
export const SELECTED_LABEL = "Client selected";

const roles = (o: { recommended: boolean; selected: boolean }) =>
  [o.recommended && RECOMMENDATION_LABEL, o.selected && SELECTED_LABEL].filter(Boolean).join(" · ");

function toPoints(d: Data): OutcomePoint[] {
  const m = (v: string | null) => formatMoneyShort(v, d.currency);
  const at = `Review #${d.review.sequence} · ${formatDate(d.review.date)}`;
  const points: OutcomePoint[] = [
    {
      key: "authorised",
      role: "authorised",
      label: `Authorised Value (V${d.review.againstVersionNumber})`,
      sub: "Reference",
      recommended: false,
      selected: false,
      value: d.authorisedValue,
      display: m(d.authorisedValue),
      tooltip: [
        `Authorised Value · V${d.review.againstVersionNumber}`,
        m(d.authorisedValue),
        "Reference: the version this review was measured against",
      ],
    },
  ];
  if (d.currentFormalForecast !== null) {
    points.push({
      key: "forecast",
      role: "forecast",
      label: "Formal Forecast",
      sub: `Reference · Review #${d.review.sequence}`,
      recommended: false,
      selected: false,
      value: d.currentFormalForecast,
      display: m(d.currentFormalForecast),
      tooltip: ["Formal Forecast", m(d.currentFormalForecast), `Reference: ${at}`],
    });
  }
  for (const o of d.outcomes) {
    points.push({
      key: o.id,
      role: "outcome",
      label: o.label,
      sub: roles(o),
      recommended: o.recommended,
      selected: o.selected,
      value: o.totalValue,
      display: m(o.totalValue),
      tooltip: [
        o.label,
        m(o.totalValue),
        ...(roles(o) ? [roles(o)] : []),
        `Option kind: ${SCENARIO_KIND_LABELS[o.kind]}`,
        at,
        `Measured against V${d.review.againstVersionNumber}`,
      ],
    });
  }
  return points;
}

/**
 * X-axis ticks (decimal-safe). Zero-inclusive (PMO decision): a narrow domain would exaggerate small
 * differences between discrete outcomes. Positions are proportional to value; each row carries its own
 * direct value label, so close outcomes stay readable without truncating the scale.
 */
function axisTicks(points: OutcomePoint[], currency: string): [string, string][] {
  const values = points.map((p) => new Decimal(p.value));
  const max = Decimal.max(0, ...values);
  const min = Decimal.min(0, ...values);
  const span = max.minus(min);
  if (span.isZero()) return [["0.00", formatMoneyShort("0", currency)]];
  const rough = span.dividedBy(5);
  const magnitude = new Decimal(10).pow(rough.log(10).floor());
  const step = [1, 2, 2.5, 5, 10].map((f) => magnitude.times(f)).find((s) => s.gte(rough)) ?? magnitude.times(10);
  const start = min.dividedBy(step).floor().times(step);
  const end = max.dividedBy(step).ceil().times(step);
  const ticks: [string, string][] = [];
  for (let t = start; t.lte(end); t = t.plus(step))
    ticks.push([t.toFixed(2), formatMoneyShort(t.toFixed(2), currency)]);
  return ticks;
}

export function DecisionSummary({ d }: { d: Data }) {
  const m = (v: string | null) => formatMoneyShort(v, d.currency);
  const rec = d.outcomes.find((o) => o.recommended);
  const sel = d.outcomes.find((o) => o.selected);
  const item = (label: string, value: string, note: string | null, testId: string) => (
    <div className="rounded border border-slate-200 bg-white px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold text-slate-900" data-testid={testId}>
        {value}
      </dd>
      {note && <dd className="truncate text-xs text-slate-500">{note}</dd>}
    </div>
  );
  return (
    <dl className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="outcomes-summary">
      {item(
        "Formal Forecast",
        d.currentFormalForecast === null ? "Not complete" : m(d.currentFormalForecast),
        `Review #${d.review.sequence} · Authorised V${d.review.againstVersionNumber} ${m(d.authorisedValue)}`,
        "outcomes-forecast",
      )}
      {item(
        RECOMMENDATION_LABEL,
        rec ? m(rec.totalValue) : "Not issued",
        rec?.label ?? null,
        "outcomes-recommendation",
      )}
      {item(SELECTED_LABEL, sel ? m(sel.totalValue) : "No decision recorded", sel?.label ?? null, "outcomes-selected")}
      {item(
        "Difference from Cardaxia recommendation",
        d.differenceFromRecommendation === null ? "—" : formatMoneyChange(d.differenceFromRecommendation, d.currency),
        rec && sel && rec.id === sel.id
          ? "Client selected Cardaxia's recommendation"
          : "Client selected − recommendation",
        "outcomes-difference",
      )}
    </dl>
  );
}

function Legend() {
  const item = (swatch: React.ReactNode, label: string) => (
    <li className="flex items-center gap-1.5">
      <svg width="24" height="20" aria-hidden className="shrink-0">
        {swatch}
      </svg>
      <span className="text-slate-700">{label}</span>
    </li>
  );
  return (
    <ul className="mb-1 flex flex-wrap gap-x-5 gap-y-1 text-xs" aria-label="Chart legend" data-testid="outcomes-legend">
      {item(
        <path d="M12,3 L19,10 L12,17 L5,10 Z" fill="#fff" stroke={REFERENCE_COLORS.authorised} strokeWidth="2" />,
        "Authorised Value (reference)",
      )}
      {item(
        <circle cx="12" cy="10" r="6" fill="#fff" stroke={REFERENCE_COLORS.forecast} strokeWidth="2" />,
        "Formal Forecast (reference)",
      )}
      {item(<circle cx="12" cy="10" r="5.5" fill={OUTCOME_COLOR} />, "Stored option outcome")}
      {item(
        <>
          <circle cx="12" cy="10" r="8.5" fill="none" stroke={OUTCOME_COLOR} strokeWidth="1.5" />
          <circle cx="12" cy="10" r="5" fill={OUTCOME_COLOR} />
        </>,
        RECOMMENDATION_LABEL,
      )}
      {item(<rect x="6" y="4" width="12" height="12" rx="1" fill={OUTCOME_COLOR} />, SELECTED_LABEL)}
    </ul>
  );
}

function CompanionTable({ d }: { d: Data }) {
  const m = (v: string | null) => formatMoneyShort(v, d.currency);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="outcomes-table">
        <caption className="sr-only">
          Alternative Value Outcomes — Review #{d.review.sequence}, {formatDate(d.review.date)}
        </caption>
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Reference / outcome
            </th>
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Role
            </th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
              Value
            </th>
            <th scope="col" className="py-1.5 font-medium">
              Narrative
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-100" data-testid="outcome-ref-authorised">
            <th scope="row" className="py-1.5 pr-3 text-left font-medium">
              Authorised Value (V{d.review.againstVersionNumber})
            </th>
            <td className="py-1.5 pr-3 text-slate-600">Authorised reference</td>
            <td className="py-1.5 pr-3 text-right tabular-nums" data-testid="outcome-value">
              {m(d.authorisedValue)}
            </td>
            <td className="py-1.5 text-slate-500">Version this review was measured against</td>
          </tr>
          <tr className="border-b border-slate-100" data-testid="outcome-ref-forecast">
            <th scope="row" className="py-1.5 pr-3 text-left font-medium">
              Formal Forecast (Review #{d.review.sequence})
            </th>
            <td className="py-1.5 pr-3 text-slate-600">Current formal forecast</td>
            <td className="py-1.5 pr-3 text-right tabular-nums" data-testid="outcome-value">
              {d.currentFormalForecast === null ? "Not complete" : m(d.currentFormalForecast)}
            </td>
            <td className="py-1.5 text-slate-500">As at {formatDate(d.review.date)}</td>
          </tr>
          {d.outcomes.map((o) => (
            <tr key={o.id} className="border-b border-slate-100 align-top" data-testid="outcome-row">
              <th scope="row" className="py-1.5 pr-3 text-left font-medium">
                {o.label}
              </th>
              <td className="py-1.5 pr-3 text-slate-600" data-testid="outcome-role">
                {["Scenario", o.recommended && RECOMMENDATION_LABEL, o.selected && SELECTED_LABEL]
                  .filter(Boolean)
                  .join(" · ")}
                <span className="block text-xs text-slate-400">{SCENARIO_KIND_LABELS[o.kind]}</span>
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums" data-testid="outcome-value">
                {m(o.totalValue)}
              </td>
              <td className="max-w-sm py-1.5 text-xs text-slate-600">{o.narrative ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AlternativeValueOutcomes({
  data,
  variant = "full",
  reviewHref,
  note,
}: {
  data: Data;
  /** Phase 4D.9F: why no time-based Alternative Value Trajectories are shown for this review (when relevant). */
  note?: string;
  /** full: review page (table open). compact: Overview "Latest Value Decision" (table collapsed). */
  variant?: "full" | "compact";
  reviewHref?: string;
}) {
  const compact = variant === "compact";
  const points = toPoints(data);
  const titleId = compact ? "latest-decision-title" : "outcomes-title";
  const summary = points.map((p) => `${p.label}${p.sub ? ` (${p.sub})` : ""} ${p.display}`).join("; ");
  return (
    <section
      id={compact ? "latest-decision" : "outcomes"}
      aria-labelledby={titleId}
      className="mb-6 scroll-mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      data-testid={compact ? "latest-value-decision" : "alternative-value-outcomes"}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={titleId} className="text-base font-semibold text-slate-900">
            {compact ? "Latest Value Decision" : "Alternative Value Outcomes"}
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {compact ? "Alternative Value Outcomes at " : "Stored management-response options at "}
            Review #{data.review.sequence} ({formatDate(data.review.date)}), measured against V
            {data.review.againstVersionNumber}. Each option is one assessed total — not a path over time.
          </p>
        </div>
        <GovernedTag>Point in time</GovernedTag>
      </div>
      <DecisionSummary d={data} />
      {note && (
        <p className="mb-2 text-xs text-slate-600" data-testid="outcomes-trajectory-note">
          {note}
        </p>
      )}
      {data.outcomes.length === 0 ? (
        <p className="text-sm text-slate-600" data-testid="outcomes-empty">
          No options were recorded for this review.
        </p>
      ) : (
        <>
          <Legend />
          <OutcomesChart
            points={points}
            ticks={axisTicks(points, data.currency)}
            ariaLabel={`Alternative Value Outcomes chart: ${summary}. The table lists every value.`}
            testId={compact ? "latest-decision-chart" : "outcomes-chart"}
          />
          <p className="mb-3 text-xs text-slate-500">
            Each option is one assessed total on a zero-based scale; the dashed lines mark the Authorised Value and
            Formal Forecast references.
          </p>
          <details open={!compact} data-testid="outcomes-table-details">
            <summary className="cursor-pointer text-sm font-medium text-slate-700 hover:text-slate-900">
              Outcomes table
            </summary>
            <div className="mt-2">
              <CompanionTable d={data} />
            </div>
          </details>
        </>
      )}
      {reviewHref && (
        <p className="mt-3 text-sm">
          <TextLink href={reviewHref}>View Assurance Review #{data.review.sequence} →</TextLink>
        </p>
      )}
    </section>
  );
}
