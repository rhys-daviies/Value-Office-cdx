import Decimal from "decimal.js";

import type { EvolutionEvent, ValueCaseEvolution } from "@/server/queries/evolution";
import { GovernedTag } from "@/ui/components/badges";
import { formatDate, formatMoneyShort } from "@/ui/format";
import { TRIGGER_LABELS } from "@/ui/labels";

import { type ChartPoint, EvolutionChart } from "./chart";
import { SERIES } from "./series";

// Value Case Evolution (Phase 4D.5): one component, used on Overview and the Value Case page.
// Governed history only — the read model excludes every working, draft or proposed value.

const NOT_DATED = "Not dated";

function eventLabel(e: EvolutionEvent): string {
  if (e.kind === "original") return "Original Business Case";
  if (e.kind === "authorisation") return `Authorised V${e.authorisation.versionNumber}`;
  return `Formal Assurance · Review #${e.position.sequence}`;
}

function eventDate(e: EvolutionEvent): string {
  if (e.kind === "original") return NOT_DATED;
  if (e.kind === "authorisation") return e.authorisation.date ? formatDate(e.authorisation.date) : "Date not recorded";
  return formatDate(e.position.date);
}

function toPoint(e: EvolutionEvent, currency: string): ChartPoint {
  const m = (v: string | null) => formatMoneyShort(v, currency);
  const date = eventDate(e);
  if (e.kind === "original") {
    const o = e.original;
    return {
      key: e.key,
      kind: "original",
      label: "Business Case",
      sub: NOT_DATED,
      original: o.value,
      authorised: null,
      forecast: null,
      againstVersionNumber: null,
      realised: null,
      display: { original: m(o.value) },
      tooltip: ["Original Business Case", m(o.value), "Inherited starting position · no governed date"],
    };
  }
  if (e.kind === "authorisation") {
    const a = e.authorisation;
    return {
      key: e.key,
      kind: "authorisation",
      label: `V${a.versionNumber}`,
      sub: date,
      original: null,
      authorised: a.authorisedValue,
      forecast: null,
      againstVersionNumber: null,
      realised: null,
      display: { authorised: m(a.authorisedValue) },
      tooltip: [
        `Authorised V${a.versionNumber}`,
        m(a.authorisedValue),
        a.date ? `Authorised ${formatDate(a.date)}` : "Authorisation date not recorded",
        ...(a.vcoName ? [`VCO: ${a.vcoName}`] : []),
        ...(a.valueChangeCode ? [`Value Change ${a.valueChangeCode}`] : []),
      ],
    };
  }
  const p = e.position;
  return {
    key: e.key,
    kind: "review",
    label: `Review #${p.sequence}`,
    sub: date,
    original: null,
    authorised: e.inForceValue,
    forecast: p.currentForecast,
    againstVersionNumber: p.againstVersionNumber,
    realised: p.realisedValue,
    display: { forecast: m(p.currentForecast), realised: m(p.realisedValue) },
    tooltip: [
      `Formal Assurance · Review #${p.sequence}`,
      `${formatDate(p.date)} · ${TRIGGER_LABELS[p.trigger]}`,
      `Measured against V${p.againstVersionNumber}`,
      `Forecast: ${p.currentForecast === null ? "not complete" : m(p.currentForecast)}`,
      `Realised: ${p.realisedValue === null ? "not recorded" : m(p.realisedValue)}`,
      ...(p.valueGap !== null ? [`Value Gap: ${m(p.valueGap)}`] : []),
    ],
  };
}

/** Y-axis ticks from zero to a round ceiling above the largest plotted value (decimal-safe). */
function axisTicks(points: ChartPoint[], currency: string): [string, string][] {
  const values = points.flatMap((p) => [p.original, p.authorised, p.forecast, p.realised]).filter((v) => v !== null);
  const max = values.reduce((acc, v) => Decimal.max(acc, new Decimal(v)), new Decimal(0));
  if (max.isZero()) return [["0", formatMoneyShort("0", currency)]];
  const rough = max.dividedBy(4);
  const magnitude = new Decimal(10).pow(rough.log(10).floor());
  const step = [1, 2, 2.5, 5, 10].map((f) => magnitude.times(f)).find((s) => s.gte(rough)) ?? magnitude.times(10);
  const ticks: [string, string][] = [];
  for (let t = new Decimal(0); ; t = t.plus(step)) {
    ticks.push([t.toFixed(2), formatMoneyShort(t.toFixed(2), currency)]);
    if (t.gte(max)) break;
  }
  return ticks;
}

function Legend() {
  const item = (swatch: React.ReactNode, label: string, note: string) => (
    <li className="flex items-center gap-1.5">
      <svg width="22" height="12" aria-hidden className="shrink-0">
        {swatch}
      </svg>
      <span className="font-medium text-slate-800">{label}</span>
      <span className="text-slate-500">{note}</span>
    </li>
  );
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs" aria-label="Chart legend" data-testid="evolution-legend">
      {item(
        <path d="M11,1 L17,6 L11,11 L5,6 Z" fill={SERIES.original.color} />,
        SERIES.original.label,
        "inherited starting point",
      )}
      {item(
        <>
          <path d="M0,9 H8 V3 H22" stroke={SERIES.authorised.color} strokeWidth="2" fill="none" />
        </>,
        SERIES.authorised.label,
        "step: in force until superseded",
      )}
      {item(
        <>
          <line x1="0" y1="6" x2="22" y2="6" stroke={SERIES.forecast.color} strokeWidth="1.5" strokeDasharray="2 3" />
          <circle cx="11" cy="6" r="4" fill={SERIES.forecast.color} />
        </>,
        SERIES.forecast.label,
        "at each finalised review",
      )}
      {item(
        <>
          <line x1="0" y1="6" x2="22" y2="6" stroke={SERIES.realised.color} strokeWidth="1.5" strokeDasharray="2 3" />
          <rect x="7" y="2" width="8" height="8" rx="1" fill={SERIES.realised.color} />
        </>,
        SERIES.realised.label,
        "recorded at each finalised review",
      )}
    </ul>
  );
}

function CompanionTable({ evolution }: { evolution: ValueCaseEvolution }) {
  const m = (v: string | null) => formatMoneyShort(v, evolution.currency);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="evolution-table">
        <caption className="sr-only">Value Case Evolution — governed history in order</caption>
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Event
            </th>
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Date
            </th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
              Business Case
            </th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
              Authorised Value
            </th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
              Formal Forecast
            </th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
              Realised Value
            </th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">
              Value Gap
            </th>
            <th scope="col" className="py-1.5 font-medium">
              Basis
            </th>
          </tr>
        </thead>
        <tbody>
          {evolution.events.map((e) => {
            const cell = (id: string, v: React.ReactNode) => (
              <td className="py-1.5 pr-3 text-right tabular-nums" data-testid={`evolution-${id}`}>
                {v}
              </td>
            );
            const na = <span className="text-slate-400">—</span>;
            return (
              <tr key={e.key} className="border-b border-slate-100 align-top" data-testid={`evolution-row-${e.key}`}>
                <th scope="row" className="py-1.5 pr-3 text-left font-medium text-slate-900">
                  {eventLabel(e)}
                </th>
                <td className="py-1.5 pr-3 whitespace-nowrap text-slate-700">{eventDate(e)}</td>
                {e.kind === "original" ? (
                  <>
                    {cell("original-value", m(e.original.value))}
                    {cell(`${e.key}-authorised`, na)}
                    {cell(`${e.key}-forecast`, na)}
                    {cell(`${e.key}-realised`, na)}
                    {cell(`${e.key}-gap`, na)}
                    <td className="py-1.5 text-slate-600">Inherited · V{e.original.versionNumber}</td>
                  </>
                ) : e.kind === "authorisation" ? (
                  <>
                    {cell(`${e.key}-original`, na)}
                    {cell(`${e.key}-authorised`, m(e.authorisation.authorisedValue))}
                    {cell(`${e.key}-forecast`, na)}
                    {cell(`${e.key}-realised`, na)}
                    {cell(`${e.key}-gap`, na)}
                    <td className="py-1.5 text-slate-600" data-testid={`evolution-${e.key}-basis`}>
                      {[
                        e.authorisation.vcoName && `VCO: ${e.authorisation.vcoName}`,
                        e.authorisation.valueChangeCode && `via ${e.authorisation.valueChangeCode}`,
                        e.authorisation.status === "superseded" && "since superseded",
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                  </>
                ) : (
                  <>
                    {cell(`${e.key}-original`, na)}
                    {cell(`${e.key}-authorised`, na)}
                    {cell(
                      `${e.key}-forecast`,
                      e.position.currentForecast === null ? (
                        <span className="text-slate-500">Not complete</span>
                      ) : (
                        m(e.position.currentForecast)
                      ),
                    )}
                    {cell(
                      `${e.key}-realised`,
                      e.position.realisedValue === null ? (
                        <span className="text-slate-500">Not recorded</span>
                      ) : (
                        m(e.position.realisedValue)
                      ),
                    )}
                    {cell(`${e.key}-gap`, e.position.valueGap === null ? na : m(e.position.valueGap))}
                    <td className="py-1.5 text-slate-600" data-testid={`evolution-${e.key}-basis`}>
                      Measured against V{e.position.againstVersionNumber} ({m(e.position.againstAuthorisedValue)}) ·{" "}
                      {TRIGGER_LABELS[e.position.trigger]}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ValueCaseEvolution({
  evolution,
  id,
  tableOpen = false,
}: {
  evolution: ValueCaseEvolution;
  id?: string;
  /** The companion table is always present; on Overview it starts collapsed to keep the page scannable. */
  tableOpen?: boolean;
}) {
  const points = evolution.events.map((e) => toPoint(e, evolution.currency));
  const hasAuthorised = evolution.authorisedVersions.length > 0;
  const summary = evolution.events.map((e) => `${eventLabel(e)} (${eventDate(e)})`).join("; ");
  return (
    <section
      id={id}
      aria-labelledby={`${id ?? "evolution"}-title`}
      className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      data-testid="value-case-evolution"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={`${id ?? "evolution"}-title`} className="text-base font-semibold text-slate-900">
            Value Case Evolution
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            History of the governed value commitment — how it got here, not progress against the plan.
          </p>
        </div>
        <GovernedTag>Governed history</GovernedTag>
      </div>

      {!hasAuthorised ? (
        <p
          className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-600"
          data-testid="evolution-empty"
        >
          No Authorised Value Case yet. The evolution begins when the Value Case Owner authorises V1.
          {evolution.originalBusinessCase?.value && (
            <> Original Business Case: {formatMoneyShort(evolution.originalBusinessCase.value, evolution.currency)}.</>
          )}
        </p>
      ) : (
        <>
          <Legend />
          <EvolutionChart
            points={points}
            currencyTicks={axisTicks(points, evolution.currency)}
            ariaLabel={`Value Case Evolution chart. Events in order: ${summary}. The table below lists every value.`}
          />
          <p className="mb-3 text-xs text-slate-500">
            Events are shown in governed order; spacing is by event, not elapsed time. Forecast and realised points are
            formal checkpoint observations — dotted connectors show sequence only; the forecast connector breaks where
            the version measured against changes.
          </p>
          {evolution.formalPositions.length === 0 && (
            <p className="mb-3 text-sm text-slate-600" data-testid="evolution-no-positions">
              No formal Assurance positions recorded yet.
            </p>
          )}
          <details open={tableOpen} className="group" data-testid="evolution-table-details">
            <summary className="cursor-pointer text-sm font-medium text-slate-700 hover:text-slate-900">
              Governed history table
            </summary>
            <div className="mt-2">
              <CompanionTable evolution={evolution} />
            </div>
          </details>
        </>
      )}
    </section>
  );
}
