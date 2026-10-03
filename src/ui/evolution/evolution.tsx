import Decimal from "decimal.js";

import type { EvolutionEvent, ValueCaseEvolution } from "@/server/queries/evolution";
import { GovernedTag } from "@/ui/components/badges";
import { formatDate, formatMoneyChange, formatMoneyShort } from "@/ui/format";
import { TRIGGER_LABELS } from "@/ui/labels";

import { EVOLUTION_MARGIN_FRACTIONS, EvolutionChart, type EvolutionStep } from "./chart";
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

/** Event chart steps (4D.9N.1A E1): commitment values, review checkpoints and movement between commitments. */
function toSteps(evolution: ValueCaseEvolution): EvolutionStep[] {
  const m = (v: string | null) => formatMoneyShort(v, evolution.currency);
  const n = (v: string | null) => (v === null ? null : Number(v)); // placement only
  let previous: string | null = null;
  return evolution.events.map((e): EvolutionStep => {
    if (e.kind === "original") {
      previous = e.original.value;
      return {
        kind: "original",
        key: e.key,
        axis: "Original BC",
        sub: "Not dated",
        value: Number(e.original.value),
        text: m(e.original.value),
      };
    }
    if (e.kind === "authorisation") {
      const a = e.authorisation;
      const delta =
        previous === null
          ? null
          : formatMoneyChange(new Decimal(a.authorisedValue).minus(previous).toFixed(2), evolution.currency);
      previous = a.authorisedValue;
      return {
        kind: "authorisation",
        key: e.key,
        axis: a.valueChangeCode ? `${a.valueChangeCode} · V${a.versionNumber}` : `V${a.versionNumber}`,
        sub: a.date ? formatDate(a.date) : "Date not recorded",
        version: `V${a.versionNumber}`,
        value: Number(a.authorisedValue),
        text: m(a.authorisedValue),
        delta,
      };
    }
    const p = e.position;
    return {
      kind: "review",
      key: e.key,
      axis: `Review #${p.sequence}`,
      sub: formatDate(p.date),
      against: n(p.againstAuthorisedValue),
      forecast: n(p.currentForecast),
      realised: n(p.realisedValue),
      text: {
        against: m(p.againstAuthorisedValue),
        forecast: p.currentForecast === null ? null : m(p.currentForecast),
        realised: p.realisedValue === null ? null : m(p.realisedValue),
        gap: p.valueGap === null ? null : m(p.valueGap),
      },
    };
  });
}

/** Y-axis ticks from zero to a round ceiling above the largest plotted value (decimal-safe). */
function axisTicks(evolution: ValueCaseEvolution): [number, string][] {
  const values = evolution.events
    .flatMap((e) =>
      e.kind === "original"
        ? [e.original.value]
        : e.kind === "authorisation"
          ? [e.authorisation.authorisedValue]
          : [e.position.againstAuthorisedValue, e.position.currentForecast, e.position.realisedValue],
    )
    .filter((v): v is string => v !== null);
  const max = values.reduce((acc, v) => Decimal.max(acc, new Decimal(v)), new Decimal(0));
  if (max.isZero()) return [[0, formatMoneyShort("0", evolution.currency)]];
  const rough = max.dividedBy(4);
  const magnitude = new Decimal(10).pow(rough.log(10).floor());
  const step = [1, 2, 2.5, 5, 10].map((f) => magnitude.times(f)).find((s) => s.gte(rough)) ?? magnitude.times(10);
  const ticks: [number, string][] = [];
  for (let t = new Decimal(0); ; t = t.plus(step)) {
    ticks.push([t.toNumber(), formatMoneyShort(t.toFixed(2), evolution.currency)]);
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
        <path d="M0,4 H11 V9 H22" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4 3" fill="none" />,
        SERIES.original.label,
        "the original promise",
      )}
      {item(
        <path d="M0,9 H8 V3 H22" stroke={SERIES.authorised.color} strokeWidth="3" fill="none" />,
        "Authorised Commitment",
        "in force until a Value Change is authorised",
      )}
      {item(
        <circle cx="11" cy="6" r="4.5" fill={SERIES.forecast.color} />,
        SERIES.forecast.label,
        "at each formal review",
      )}
      {item(
        <rect x="7" y="1" width="8" height="10" rx="1" fill={SERIES.realised.color} />,
        SERIES.realised.label,
        "recorded at each formal review",
      )}
      {item(
        <path d="M7,1 H11 V11 H7" stroke="#b91c1c" strokeWidth="1.5" fill="none" />,
        "Value Gap",
        "commitment measured against − forecast",
      )}
    </ul>
  );
}

/** E2 event strip: compact governed values under each event, aligned with the chart's event columns. */
function EventStrip({ evolution, steps }: { evolution: ValueCaseEvolution; steps: EvolutionStep[] }) {
  const m = (v: string | null) => formatMoneyShort(v, evolution.currency);
  return (
    <ol
      className="grid gap-1.5 text-xs"
      style={{
        gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
        paddingLeft: `${EVOLUTION_MARGIN_FRACTIONS.left * 100}%`,
        paddingRight: `${EVOLUTION_MARGIN_FRACTIONS.right * 100}%`,
      }}
      data-testid="evolution-strip"
    >
      {evolution.events.map((e, i) => {
        const s = steps[i]!;
        const line = (k: string, v: string | null, id: string) => (
          <div className="flex justify-between gap-1">
            <dt className="text-slate-500">{k}</dt>
            <dd className="font-semibold text-slate-900 tabular-nums" data-testid={`evolution-card-${e.key}-${id}`}>
              {v ?? "—"}
            </dd>
          </div>
        );
        return (
          <li
            key={e.key}
            className={`rounded border px-2 py-1.5 ${e.kind === "review" ? "border-slate-200 bg-slate-50" : e.kind === "authorisation" ? "border-blue-200 bg-blue-50/60" : "border-orange-200 bg-orange-50/60"}`}
            data-testid={`evolution-card-${e.key}`}
          >
            <p className="truncate font-semibold text-slate-900" title={eventLabel(e)}>
              {s.axis}
            </p>
            <dl>
              {e.kind === "original" && line("Business Case", m(e.original.value), "value")}
              {e.kind === "authorisation" && (
                <>
                  {line(`Authorised V${e.authorisation.versionNumber}`, m(e.authorisation.authorisedValue), "value")}
                  {s.kind === "authorisation" && s.delta && line("Change", s.delta, "delta")}
                </>
              )}
              {e.kind === "review" && (
                <>
                  {line(`Against V${e.position.againstVersionNumber}`, m(e.position.againstAuthorisedValue), "against")}
                  {line(
                    "Forecast",
                    e.position.currentForecast === null ? "Not complete" : m(e.position.currentForecast),
                    "forecast",
                  )}
                  {line(
                    "Realised",
                    e.position.realisedValue === null ? "Not recorded" : m(e.position.realisedValue),
                    "realised",
                  )}
                  {line("Gap", e.position.valueGap === null ? null : m(e.position.valueGap), "gap")}
                </>
              )}
            </dl>
          </li>
        );
      })}
    </ol>
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
  const steps = toSteps(evolution);
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
          <div className="mt-2 overflow-x-auto">
            <div className="min-w-[720px]">
              <EvolutionChart
                steps={steps}
                ticks={axisTicks(evolution)}
                ariaLabel={`Value Case Evolution chart. Events in order: ${summary}. The table below lists every value.`}
              />
              <EventStrip evolution={evolution} steps={steps} />
            </div>
          </div>
          <p className="mt-2 mb-3 text-xs text-slate-500">
            Events are shown in governed order; spacing is by event, not elapsed time. The commitment changes only when
            the Value Case Owner authorises a version; each formal review shows the Formal Forecast and Realised Value
            against the commitment it was measured against.
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
