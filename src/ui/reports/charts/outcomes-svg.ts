import type { AssuranceOutcomes } from "@/domain/reports";
import { OUTCOME_COLOR, REFERENCE_COLORS } from "@/ui/outcomes/marks";

import { html, type SafeHtml } from "../html";

import { clip, linear, off, zeroBasedTicks } from "./scale";

// Alternative Value Outcomes — report SVG (Phase 4D.7). Static, deterministic rendering of the
// snapshotted decision economics of one review, equivalent to the application's dot plot: one row per
// reference or stored option, a zero-inclusive value scale, no time axis and no path between rows.
// References are hollow (Authorised Value diamond, Formal Forecast circle) with dashed vertical lines;
// options share one neutral colour — ringed for Cardaxia's recommendation, square for the client choice.

const W = 680;
const ROW = 26;
const M = { top: 10, right: 70, bottom: 26, left: 222 };
const INK = "#0f172a";
const MUTED = "#475569";
const RULE = "#e2e8f0";

export const RECOMMENDATION_LABEL = "Cardaxia recommendation";
export const SELECTED_LABEL = "Client selected";

type Money = (v: string | null) => string;

export type OutcomeRow = {
  role: "authorised" | "forecast" | "outcome";
  label: string;
  sub: string;
  value: string;
  recommended: boolean;
  selected: boolean;
};

export const outcomeRoles = (o: { recommended: boolean; selected: boolean }) =>
  [o.recommended && RECOMMENDATION_LABEL, o.selected && SELECTED_LABEL].filter(Boolean).join(" · ");

/** The rows in presentation order: the two references, then options in their snapshotted order. */
export function outcomeRows(o: AssuranceOutcomes, reviewSequence: number): OutcomeRow[] {
  return [
    {
      role: "authorised",
      label: `Authorised Value (V${o.againstVersionNumber})`,
      sub: "Reference",
      value: o.authorisedValue,
      recommended: false,
      selected: false,
    },
    ...(o.currentFormalForecast === null
      ? []
      : [
          {
            role: "forecast" as const,
            label: "Formal Forecast",
            sub: `Reference · Review #${reviewSequence}`,
            value: o.currentFormalForecast,
            recommended: false,
            selected: false,
          },
        ]),
    ...o.outcomes.map((x) => ({
      role: "outcome" as const,
      label: x.label,
      sub: outcomeRoles(x),
      value: x.totalValue,
      recommended: x.recommended,
      selected: x.selected,
    })),
  ];
}

export function renderAlternativeValueOutcomesSvg(
  o: AssuranceOutcomes,
  reviewSequence: number,
  money: Money,
): SafeHtml {
  const rows = outcomeRows(o, reviewSequence);
  const H = M.top + rows.length * ROW + M.bottom;
  const ticks = zeroBasedTicks(
    rows.map((r) => r.value),
    5,
  );
  const x = linear(ticks[0]!, ticks.at(-1)!, M.left, W - M.right);
  const rowY = (i: number) => String(M.top + i * ROW + ROW / 2);
  const plotBottom = M.top + rows.length * ROW;
  const ref = (role: "authorised" | "forecast") => rows.find((r) => r.role === role);

  const marks = rows.map((r, i) => {
    const cx = x(r.value);
    const cy = rowY(i);
    // Exact value in a fixed right-hand column, so close outcomes never overprint each other.
    const value = html`<text x="${W - 4}" y="${off(cy, 3)}" text-anchor="end" class="v">${money(r.value)}</text>`;
    let mark: SafeHtml;
    if (r.role === "authorised") {
      mark = html`<path
        d="M${cx},${off(cy, -6.5)} l6.5,6.5 l-6.5,6.5 l-6.5,-6.5 Z"
        fill="#fff"
        stroke="${REFERENCE_COLORS.authorised}"
        stroke-width="2"
      />`;
    } else if (r.role === "forecast") {
      mark = html`<circle
        cx="${cx}"
        cy="${cy}"
        r="5.5"
        fill="#fff"
        stroke="${REFERENCE_COLORS.forecast}"
        stroke-width="2"
      />`;
    } else {
      mark = html`${
        r.recommended
          ? html`<circle cx="${cx}" cy="${cy}" r="9" fill="none" stroke="${OUTCOME_COLOR}" stroke-width="1.4" />`
          : null
      }${
        r.selected
          ? html`<rect
              x="${off(cx, -5.5)}"
              y="${off(cy, -5.5)}"
              width="11"
              height="11"
              rx="1"
              fill="${OUTCOME_COLOR}"
            />`
          : html`<circle cx="${cx}" cy="${cy}" r="5" fill="${OUTCOME_COLOR}" />`
      }`;
    }
    return html`<g
      data-role="${r.role}"
      data-recommended="${String(r.recommended)}"
      data-selected="${String(r.selected)}"
    >
      <line x1="${M.left}" x2="${W - M.right}" y1="${cy}" y2="${cy}" stroke="#f1f5f9" />
      <text x="${M.left - 10}" y="${r.sub ? off(cy, -2) : off(cy, 3)}" text-anchor="end" class="l"
        >${clip(r.label, 38)}</text
      >
      ${r.sub ? html`<text x="${M.left - 10}" y="${off(cy, 9)}" text-anchor="end" class="s">${clip(r.sub, 48)}</text>` : null}
      ${mark} ${value}
    </g>`;
  });

  const authorised = ref("authorised");
  const forecast = ref("forecast");
  const summary = rows.map((r) => `${r.label}${r.sub ? ` (${r.sub})` : ""} ${money(r.value)}`).join("; ");

  return html`<svg
    class="rpt-svg"
    viewBox="0 0 ${W} ${H}"
    width="100%"
    role="img"
    aria-labelledby="avo-title avo-desc"
    data-testid="as-outcomes-svg"
    xmlns="http://www.w3.org/2000/svg"
  >
    <title id="avo-title">Alternative Value Outcomes</title>
    <desc id="avo-desc">${summary}. Each option is one assessed total, not a path over time.</desc>
    <style>
      .l {
        font:
          600 8.5px Helvetica,
          Arial,
          sans-serif;
        fill: ${INK};
      }
      .s,
      .t {
        font:
          7.5px Helvetica,
          Arial,
          sans-serif;
        fill: ${MUTED};
      }
      .v {
        font:
          600 8.5px Helvetica,
          Arial,
          sans-serif;
        fill: ${INK};
      }
    </style>
    ${ticks.map(
      (t) =>
        html`<line x1="${x(t)}" x2="${x(t)}" y1="${M.top}" y2="${plotBottom}" stroke="${RULE}" />
          <text x="${x(t)}" y="${plotBottom + 14}" text-anchor="middle" class="t">${money(t.toFixed(2))}</text>`,
    )}
    <line x1="${M.left}" x2="${W - M.right}" y1="${plotBottom}" y2="${plotBottom}" stroke="#cbd5e1" />
    ${
      authorised
        ? html`<line
            x1="${x(authorised.value)}"
            x2="${x(authorised.value)}"
            y1="${M.top}"
            y2="${plotBottom}"
            stroke="${REFERENCE_COLORS.authorised}"
            stroke-dasharray="4 3"
          />`
        : null
    }
    ${
      forecast
        ? html`<line
            x1="${x(forecast.value)}"
            x2="${x(forecast.value)}"
            y1="${M.top}"
            y2="${plotBottom}"
            stroke="${REFERENCE_COLORS.forecast}"
            stroke-dasharray="1.5 3"
          />`
        : null
    }
    ${marks}
  </svg>`;
}

export function outcomesLegend(): SafeHtml {
  return html`<div class="rpt-legend" data-testid="as-outcomes-legend">
    <span class="lg"
      ><svg width="20" height="14" viewBox="0 0 20 14" aria-hidden="true">
        <path d="M10,1 l6,6 l-6,6 l-6,-6 Z" fill="#fff" stroke="${REFERENCE_COLORS.authorised}" stroke-width="2" /></svg
      ><b>Authorised Value</b> reference</span
    >
    <span class="lg"
      ><svg width="20" height="14" viewBox="0 0 20 14" aria-hidden="true">
        <circle cx="10" cy="7" r="5" fill="#fff" stroke="${REFERENCE_COLORS.forecast}" stroke-width="2" /></svg
      ><b>Formal Forecast</b> reference</span
    >
    <span class="lg"
      ><svg width="20" height="14" viewBox="0 0 20 14" aria-hidden="true">
        <circle cx="10" cy="7" r="4.5" fill="${OUTCOME_COLOR}" /></svg
      ><b>Option</b> stored assessed total</span
    >
    <span class="lg"
      ><svg width="20" height="14" viewBox="0 0 20 14" aria-hidden="true">
        <circle cx="10" cy="7" r="6.5" fill="none" stroke="${OUTCOME_COLOR}" stroke-width="1.4" />
        <circle cx="10" cy="7" r="3.5" fill="${OUTCOME_COLOR}" /></svg
      ><b>${RECOMMENDATION_LABEL}</b></span
    >
    <span class="lg"
      ><svg width="20" height="14" viewBox="0 0 20 14" aria-hidden="true">
        <rect x="5" y="2" width="10" height="10" rx="1" fill="${OUTCOME_COLOR}" /></svg
      ><b>${SELECTED_LABEL}</b></span
    >
  </div>`;
}
