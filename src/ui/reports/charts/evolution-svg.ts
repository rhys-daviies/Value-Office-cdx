import type { AssuranceEvolution, AssuranceEvolutionEvent } from "@/domain/reports";
import { forecastConnectorRuns } from "@/ui/evolution/segments";
import { SERIES } from "@/ui/evolution/series";
import { formatDate } from "@/ui/format";

import { html, type SafeHtml } from "../html";

import { linear, off, slots, zeroBasedTicks } from "./scale";

// Value Case Evolution — report SVG (Phase 4D.7). Static, deterministic rendering of the snapshotted
// governed history, semantically equivalent to the application's Recharts chart: event order (not
// elapsed time), Authorised Value as a step, Formal Forecast and Realised Value as checkpoint marks,
// the forecast connector broken where the measured-against version changes, the Original Business
// Case as the undated starting point. Missing values have no mark; nothing is interpolated.
// Distinguishable in greyscale: solid step, dotted forecast, dashed realised; diamond/bar/circle/square.

const W = 680;
const H = 250;
const M = { top: 26, right: 34, bottom: 40, left: 58 };
const INK = "#0f172a";
const MUTED = "#475569";
const RULE = "#e2e8f0";

type Money = (v: string | null) => string;

function eventAxisLabel(e: AssuranceEvolutionEvent): [string, string] {
  if (e.kind === "original") return ["Business Case", "Not dated"];
  if (e.kind === "authorisation")
    return [`V${e.versionNumber}`, e.authorisedOn ? formatDate(e.authorisedOn) : "Date not recorded"];
  return [`Review #${e.sequence}`, formatDate(e.reviewDate)];
}

/** Value of each series at each event (null where the series has no observation). */
export function evolutionSeries(e: AssuranceEvolutionEvent) {
  return {
    original: e.kind === "original" ? e.value : null,
    authorised: e.kind === "authorisation" ? e.authorisedValue : e.kind === "review" ? e.inForceValue : null,
    forecast: e.kind === "review" ? e.currentForecast : null,
    realised: e.kind === "review" ? e.realisedValue : null,
  };
}

export function renderValueCaseEvolutionSvg(evolution: AssuranceEvolution, money: Money): SafeHtml {
  const events = evolution.events;
  const series = events.map(evolutionSeries);
  const ticks = zeroBasedTicks(series.flatMap((s) => [s.original, s.authorised, s.forecast, s.realised]));
  const y = linear(ticks[0]!, ticks.at(-1)!, H - M.bottom, M.top);
  const xs = slots(events.length, M.left + 26, W - M.right - 26);
  const x = (i: number) => xs[i]!;

  // Authorised Value: step line through the value in force (stepAfter), from the first authorisation.
  const step: string[] = [];
  series.forEach((s, i) => {
    if (s.authorised === null) return;
    const py = y(s.authorised);
    step.push(step.length === 0 ? `M${x(i)},${py}` : `V${py}`);
    if (i < events.length - 1) step.push(`H${x(i + 1)}`);
  });

  // Formal Forecast connectors: one run per measured-against version (shared with the application).
  const runs = forecastConnectorRuns(
    events.map((e) => ({
      key: e.key,
      forecast: e.kind === "review" ? e.currentForecast : null,
      againstVersionNumber: e.kind === "review" ? e.againstVersionNumber : null,
    })),
  );
  const index = new Map(events.map((e, i) => [e.key, i]));
  const forecastPaths = runs
    .filter((keys) => keys.length > 1)
    .map((keys) =>
      keys.map((k, j) => `${j ? "L" : "M"}${x(index.get(k)!)},${y(series[index.get(k)!]!.forecast!)}`).join(" "),
    );
  const realisedPoints = series.flatMap((s, i) => (s.realised === null ? [] : [`${x(i)},${y(s.realised)}`]));

  const marks = events.map((e, i) => {
    const s = series[i]!;
    const cx = x(i);
    const out: SafeHtml[] = [];
    if (s.original !== null) {
      const cy = y(s.original);
      out.push(
        html`<path
            d="M${cx},${off(cy, -7)} l7,7 l-7,7 l-7,-7 Z"
            fill="${SERIES.original.color}"
            stroke="#fff"
            stroke-width="1.5"
            data-series="original"
          />
          <text x="${cx}" y="${off(cy, -11)}" text-anchor="middle" class="v">${money(s.original)}</text>`,
      );
    }
    if (e.kind === "authorisation") {
      const cy = y(e.authorisedValue);
      out.push(
        html`<rect
            x="${off(cx, -8)}"
            y="${off(cy, -3)}"
            width="16"
            height="6"
            rx="1"
            fill="${SERIES.authorised.color}"
            stroke="#fff"
            stroke-width="1.5"
            data-series="authorised"
          />
          <text x="${off(cx, 11)}" y="${off(cy, -6)}" class="v">${money(e.authorisedValue)}</text>`,
      );
    }
    if (s.forecast !== null) {
      const cy = y(s.forecast);
      out.push(
        html`<circle
            cx="${cx}"
            cy="${cy}"
            r="5"
            fill="${SERIES.forecast.color}"
            stroke="#fff"
            stroke-width="1.5"
            data-series="forecast"
          />
          <text x="${off(cx, 8)}" y="${off(cy, -6)}" class="v">${money(s.forecast)}</text>`,
      );
    }
    if (s.realised !== null) {
      const cy = y(s.realised);
      out.push(
        html`<rect
            x="${off(cx, -4.5)}"
            y="${off(cy, -4.5)}"
            width="9"
            height="9"
            fill="${SERIES.realised.color}"
            stroke="#fff"
            stroke-width="1.5"
            data-series="realised"
          />
          <text x="${off(cx, 8)}" y="${off(cy, 3)}" class="v">${money(s.realised)}</text>`,
      );
    }
    const [label, sub] = eventAxisLabel(e);
    out.push(
      html`<text x="${cx}" y="${H - M.bottom + 15}" text-anchor="middle" class="xl">${label}</text>
        <text x="${cx}" y="${H - M.bottom + 27}" text-anchor="middle" class="xs">${sub}</text>`,
    );
    return out;
  });

  const summary = events
    .map((e) => {
      const [label, sub] = eventAxisLabel(e);
      return `${label} (${sub})`;
    })
    .join("; ");

  return html`<svg
    class="rpt-svg"
    viewBox="0 0 ${W} ${H}"
    width="100%"
    role="img"
    aria-labelledby="vce-title vce-desc"
    data-testid="as-evolution-svg"
    data-forecast-connectors="${runs.map((k) => k.join(">")).join("|")}"
    xmlns="http://www.w3.org/2000/svg"
  >
    <title id="vce-title">Value Case Evolution</title>
    <desc id="vce-desc">Governed events in order: ${summary}. Exact values are in the table below.</desc>
    <style>
      .v {
        font:
          600 8px Helvetica,
          Arial,
          sans-serif;
        fill: ${INK};
      }
      .xl {
        font:
          600 8.5px Helvetica,
          Arial,
          sans-serif;
        fill: ${INK};
      }
      .xs,
      .yl {
        font:
          7.5px Helvetica,
          Arial,
          sans-serif;
        fill: ${MUTED};
      }
    </style>
    ${ticks.map(
      (t) =>
        html`<line x1="${M.left}" x2="${W - M.right}" y1="${y(t)}" y2="${y(t)}" stroke="${RULE}" />
          <text x="${M.left - 6}" y="${off(y(t), 3)}" text-anchor="end" class="yl">${money(t.toFixed(2))}</text>`,
    )}
    ${events.map((e, i) =>
      e.kind === "authorisation"
        ? html`<line
            x1="${x(i)}"
            x2="${x(i)}"
            y1="${M.top}"
            y2="${H - M.bottom}"
            stroke="#cbd5e1"
            stroke-dasharray="3 3"
          />`
        : null,
    )}
    ${
      step.length
        ? html`<path d="${step.join(" ")}" fill="none" stroke="${SERIES.authorised.color}" stroke-width="2.2" />`
        : null
    }
    ${forecastPaths.map(
      (d) =>
        html`<path
          d="${d}"
          fill="none"
          stroke="${SERIES.forecast.color}"
          stroke-width="1.4"
          stroke-dasharray="1.5 3"
        />`,
    )}
    ${
      realisedPoints.length > 1
        ? html`<polyline
            points="${realisedPoints.join(" ")}"
            fill="none"
            stroke="${SERIES.realised.color}"
            stroke-width="1.4"
            stroke-dasharray="6 3"
          />`
        : null
    }
    ${marks}
  </svg>`;
}

/** Compact HTML legend; line style and marker shape distinguish each series without colour. */
export function evolutionLegend(): SafeHtml {
  return html`<div class="rpt-legend" data-testid="as-evolution-legend">
    <span class="lg"
      ><svg width="24" height="12" viewBox="0 0 24 12" aria-hidden="true">
        <path d="M12,1 l5,5 l-5,5 l-5,-5 Z" fill="${SERIES.original.color}" /></svg
      ><b>${SERIES.original.label}</b> starting point, not dated</span
    >
    <span class="lg"
      ><svg width="24" height="12" viewBox="0 0 24 12" aria-hidden="true">
        <path d="M0,9 H9 V3 H24" fill="none" stroke="${SERIES.authorised.color}" stroke-width="2" /></svg
      ><b>${SERIES.authorised.label}</b> solid step, in force until superseded</span
    >
    <span class="lg"
      ><svg width="24" height="12" viewBox="0 0 24 12" aria-hidden="true">
        <line
          x1="0"
          y1="6"
          x2="24"
          y2="6"
          stroke="${SERIES.forecast.color}"
          stroke-width="1.4"
          stroke-dasharray="1.5 3"
        />
        <circle cx="12" cy="6" r="4" fill="${SERIES.forecast.color}" /></svg
      ><b>${SERIES.forecast.label}</b> dotted, at each finalised review</span
    >
    <span class="lg"
      ><svg width="24" height="12" viewBox="0 0 24 12" aria-hidden="true">
        <line
          x1="0"
          y1="6"
          x2="24"
          y2="6"
          stroke="${SERIES.realised.color}"
          stroke-width="1.4"
          stroke-dasharray="6 3"
        />
        <rect x="8" y="2" width="8" height="8" fill="${SERIES.realised.color}" /></svg
      ><b>${SERIES.realised.label}</b> dashed, recorded at each review</span
    >
  </div>`;
}
