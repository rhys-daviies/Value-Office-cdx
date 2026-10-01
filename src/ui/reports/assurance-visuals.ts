import type { AssuranceEvolutionEvent, AssuranceOutcomes, AssuranceReport } from "@/domain/reports";
import { formatDate } from "@/ui/format";

import { evolutionLegend, renderValueCaseEvolutionSvg } from "./charts/evolution-svg";
import {
  outcomeRoles,
  outcomesLegend,
  RECOMMENDATION_LABEL,
  renderAlternativeValueOutcomesSvg,
  SELECTED_LABEL,
} from "./charts/outcomes-svg";
import { figure, moneyFormatters } from "./common";
import { html, trusted, type SafeHtml } from "./html";

// Value Assurance Report visuals (Phase 4D.7, model v2). Rendered only from the issued snapshot
// (`evolution`, `outcomes`) — never from live queries — as deterministic server-side SVG plus compact
// tables carrying every exact value. Governed figures only; no working values, no Value Changes as options.

type Sec = (title: string) => SafeHtml;

/** v2-only styles, emitted inside the v2 report so v1 snapshots render byte-for-byte as issued. */
export const VISUAL_CSS = trusted(`<style>
.vo-report .rpt-keep { break-inside: avoid; page-break-inside: avoid; }
.vo-report .rpt-svg { display: block; width: 100%; height: auto; margin: 4px 0 6px; }
.vo-report .rpt-legend { display: flex; flex-wrap: wrap; gap: 3px 14px; font-size: 8pt; color: var(--muted); margin: 2px 0; }
.vo-report .rpt-legend .lg { display: inline-flex; align-items: center; gap: 4px; }
.vo-report .rpt-legend b { color: var(--ink); font-weight: 600; }
.vo-report .rpt-compact td, .vo-report .rpt-compact th { padding: 3px 5px; }
.vo-report .rpt-compact { font-size: 8.5pt; }
.vo-report .rpt-compact td:nth-child(2) { white-space: nowrap; }
.vo-report .rpt-compact td:first-child { min-width: 34mm; }
.vo-report .rpt-compact th.num { white-space: normal; }
</style>`);

/** Option kind shown beside the role, unless the role already says it (no redundant "recommended"). */
const KIND_NOTE = {
  current: "Current trajectory",
  alternative: "Alternative",
  no_action: "No action",
  recommended: null,
};

function eventCells(e: AssuranceEvolutionEvent, $: ReturnType<typeof moneyFormatters>) {
  const none = html`<span class="rpt-muted">—</span>`;
  if (e.kind === "original")
    return {
      event: "Original Business Case",
      date: "Not dated",
      original: $.short(e.value),
      authorised: none,
      forecast: none,
      realised: none,
      gap: none,
      basis: "Inherited starting point",
    };
  if (e.kind === "authorisation")
    return {
      event: `Authorised V${e.versionNumber}`,
      date: e.authorisedOn ? formatDate(e.authorisedOn) : "Date not recorded",
      original: none,
      authorised: $.short(e.authorisedValue),
      forecast: none,
      realised: none,
      gap: none,
      basis:
        [e.vcoName && `VCO: ${e.vcoName}`, e.valueChangeCode && `via ${e.valueChangeCode}`]
          .filter(Boolean)
          .join(" · ") || "—",
    };
  return {
    event: `Assurance Review ${e.sequence}${e.isThisReview ? " (this review)" : ""}`,
    date: formatDate(e.reviewDate),
    original: none,
    authorised: none,
    forecast: e.currentForecast === null ? "Not complete" : $.short(e.currentForecast),
    realised: e.realisedValue === null ? "Not recorded" : $.short(e.realisedValue),
    gap: e.valueGap === null ? none : $.short(e.valueGap),
    basis: `Measured against V${e.againstVersionNumber}`,
  };
}

export function renderEvolutionSection(m: AssuranceReport, sec: Sec): SafeHtml {
  const $ = moneyFormatters(m.header.currency);
  const ev = m.evolution!;
  return html`<section data-testid="as-evolution">
    <div class="rpt-keep">
      ${sec("Value Case Evolution")}
      <p class="rpt-small rpt-muted">
        How the authorised commitment, formal forecast and realised value have moved, as at this review. Governed
        history only; events are shown in order, not to a time scale. The forecast connector breaks where the Value Case
        version measured against changes.
      </p>
      ${evolutionLegend()} ${renderValueCaseEvolutionSvg(ev, $.short)}
    </div>
    <table class="rpt-compact" data-testid="as-evolution-table">
      <thead>
        <tr>
          <th>Event</th>
          <th>Date</th>
          <th class="num">Business Case</th>
          <th class="num">Authorised Value</th>
          <th class="num">Formal Forecast</th>
          <th class="num">Realised Value</th>
          <th class="num">Value Gap</th>
        </tr>
      </thead>
      <tbody>
        ${ev.events.map((e) => {
          const c = eventCells(e, $);
          return html`<tr data-testid="as-evolution-row-${e.key}">
            <td>
              ${c.event}
              <div class="rpt-small rpt-muted" data-testid="as-evolution-${e.key}-basis">${c.basis}</div>
            </td>
            <td>${c.date}</td>
            <td class="num" data-testid="as-evolution-${e.key}-original">${c.original}</td>
            <td class="num" data-testid="as-evolution-${e.key}-authorised">${c.authorised}</td>
            <td class="num" data-testid="as-evolution-${e.key}-forecast">${c.forecast}</td>
            <td class="num" data-testid="as-evolution-${e.key}-realised">${c.realised}</td>
            <td class="num" data-testid="as-evolution-${e.key}-gap">${c.gap}</td>
          </tr>`;
        })}
      </tbody>
    </table>
  </section>`;
}

export function renderOutcomesSection(m: AssuranceReport, o: AssuranceOutcomes, sec: Sec): SafeHtml {
  const $ = moneyFormatters(m.header.currency);
  const rec = o.outcomes.find((x) => x.recommended);
  const sel = o.outcomes.find((x) => x.selected);
  return html`<section data-testid="as-outcomes">
    <div class="rpt-keep">
      ${sec("Alternative Value Outcomes")}
      <p class="rpt-small rpt-muted">
        A point-in-time comparison of the options recorded at this review, measured against Authorised Value Case
        V${o.againstVersionNumber}. Each option is one assessed total entered from Cardaxia's analysis — not a path over
        time. The Value Office records and compares them; it does not calculate them.
      </p>
      <div class="rpt-headline" data-testid="as-outcomes-summary">
        ${figure(
          "Formal Forecast",
          o.currentFormalForecast === null ? "Not complete" : $.short(o.currentFormalForecast),
          {
            testId: "as-outcomes-forecast",
            note: `Review ${m.review.sequence} · Authorised V${o.againstVersionNumber} ${$.short(o.authorisedValue)}`,
          },
        )}
        ${figure(RECOMMENDATION_LABEL, rec ? $.short(rec.totalValue) : "Not issued", {
          testId: "as-outcomes-recommendation",
          note: rec?.label ?? null,
        })}
        ${figure(SELECTED_LABEL, sel ? $.short(sel.totalValue) : "No decision recorded", {
          testId: "as-outcomes-selected",
          note: sel?.label ?? null,
        })}
        ${figure(
          "Difference from Cardaxia recommendation",
          o.differenceFromRecommendation === null ? "—" : $.shortChange(o.differenceFromRecommendation),
          {
            testId: "as-outcomes-difference",
            note:
              rec && sel && rec === sel
                ? "Client selected Cardaxia's recommendation"
                : "Client selected − Cardaxia recommendation",
          },
        )}
      </div>
      ${outcomesLegend()} ${renderAlternativeValueOutcomesSvg(o, m.review.sequence, $.short)}
    </div>
    <table class="rpt-compact" data-testid="as-outcomes-table">
      <thead>
        <tr>
          <th>Reference / option</th>
          <th>Role</th>
          <th class="num">Value</th>
        </tr>
      </thead>
      <tbody>
        <tr data-testid="as-outcome-ref-authorised">
          <td>Authorised Value (V${o.againstVersionNumber})</td>
          <td>Authorised reference</td>
          <td class="num">${$.short(o.authorisedValue)}</td>
        </tr>
        <tr data-testid="as-outcome-ref-forecast">
          <td>Formal Forecast (Review ${m.review.sequence})</td>
          <td>Current formal forecast</td>
          <td class="num">${o.currentFormalForecast === null ? "Not complete" : $.short(o.currentFormalForecast)}</td>
        </tr>
        ${o.outcomes.map((x) => {
          const kind = KIND_NOTE[x.kind];
          const roles = outcomeRoles(x);
          return html`<tr data-testid="as-outcome-row">
            <td>
              ${x.label} ${x.narrative ? html`<div class="rpt-small rpt-muted rpt-text">${x.narrative}</div>` : null}
            </td>
            <td data-testid="as-outcome-role">${[roles || "Option", kind].filter(Boolean).join(" · ")}</td>
            <td class="num" data-testid="as-outcome-value">${$.short(x.totalValue)}</td>
          </tr>`;
        })}
      </tbody>
    </table>
  </section>`;
}

/** v2: options recorded without a recommendation or decision — listed, no decision chart. */
export function renderOptionsOnlySection(m: AssuranceReport, sec: Sec): SafeHtml {
  const $ = moneyFormatters(m.header.currency);
  return html`<section data-testid="as-outcomes">
    ${sec("Alternative Value Outcomes")}
    <p class="rpt-small rpt-muted">
      Options recorded at this review. No Cardaxia recommendation has been issued and no client decision is recorded, so
      no decision comparison is shown. Each option is one assessed total, not a path over time.
    </p>
    <table class="rpt-compact" data-testid="as-options">
      <thead>
        <tr>
          <th>Option</th>
          <th>Type</th>
          <th class="num">Total value</th>
        </tr>
      </thead>
      <tbody>
        ${m.scenarios.map(
          (s) =>
            html`<tr>
              <td>${s.label}</td>
              <td>${KIND_NOTE[s.kind] ?? "Option"}</td>
              <td class="num">${$.short(s.totalValue)}</td>
            </tr>`,
        )}
      </tbody>
    </table>
  </section>`;
}
