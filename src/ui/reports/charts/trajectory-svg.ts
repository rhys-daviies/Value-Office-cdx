import Decimal from "decimal.js";

import type { ReportAlternatives, ReportMilestone, ReportPlan, ReportTrajectory } from "@/domain/reports";
import { formatDate } from "@/ui/format";
import { epoch, placeMarkerLabels, timeTicks } from "@/ui/trajectory/model";
import { OPTION_STYLES, TRAJECTORY_SERIES, type OptionMarker } from "@/ui/trajectory/series";

import { html, type SafeHtml } from "../html";

import { clip, linear, off, zeroBasedTicks } from "./scale";

// Value Trajectory report charts (Phase 4D.9J, model v3). Static, deterministic server-side SVG drawn ONLY from the
// issued snapshot, with the same semantics as the application's charts: real dates on the x-axis, explicit governed
// observations only, straight joins as presentation. Coordinates are Decimal-derived fixed-precision strings, so the
// same snapshot always yields the same SVG. Every series has its own dash and marker as well as colour (greyscale-safe).
// No "Today": a report describes the position at its subject date.

const W = 680;
const H = 270;
const M = { top: 34, right: 118, bottom: 30, left: 58 };
const INK = "#0f172a";
const MUTED = "#475569";
const RULE = "#e2e8f0";
const LABEL_GAP = 11;

type Money = (v: string | null) => string;

export type SvgSeries = {
  key: string;
  label: string;
  color: string;
  dash?: string;
  width: number;
  marker: OptionMarker | "hollow" | "none";
  /** Explicit observations, in date order. `mark: false` = a join point that is not this series' own observation. */
  points: (ReportMilestone & { mark?: boolean })[];
  /** Terminal label lines (right gutter); first line bold. */
  end?: string[];
  /** Draw no line (an endpoint-only option). */
  noLine?: boolean;
  opacity?: number;
};

type SvgMarker = { asOf: string; label: string; legend: string; color: string; dash: string };

function mark(kind: SvgSeries["marker"], cx: string, cy: string, color: string, key: string, t: string): SafeHtml {
  const c = { cx: new Decimal(cx), cy: new Decimal(cy) };
  const at = (dx: number, dy: number) => `${c.cx.plus(dx).toFixed(1)},${c.cy.plus(dy).toFixed(1)}`;
  const common = html`fill="${kind === "hollow" ? "#fff" : color}" stroke="${kind === "hollow" ? color : "#fff"}"
  stroke-width="${kind === "hollow" ? "1.8" : "1.2"}" data-series="${key}" data-as-of="${t}"`;
  switch (kind) {
    case "none":
      return html``;
    case "square":
      return html`<rect x="${off(cx, -4)}" y="${off(cy, -4)}" width="8" height="8" ${common} />`;
    case "diamond":
      return html`<path d="M${at(0, -5)} L${at(5, 0)} L${at(0, 5)} L${at(-5, 0)} Z" ${common} />`;
    case "triangle":
      return html`<path d="M${at(0, -5)} L${at(5, 4)} L${at(-5, 4)} Z" ${common} />`;
    default:
      return html`<circle cx="${cx}" cy="${cy}" r="3.8" ${common} />`;
  }
}

/** Terminal labels at their value's height in the right gutter, pushed apart so none overlap. */
function stack(labels: { y: string; lines: string[]; color: string }[]) {
  const sorted = labels.map((l) => ({ ...l, top: new Decimal(l.y).minus(4) })).sort((a, b) => a.top.cmp(b.top));
  for (let i = 1; i < sorted.length; i++) {
    const min = sorted[i - 1]!.top.plus(sorted[i - 1]!.lines.length * LABEL_GAP + 2);
    if (sorted[i]!.top.lt(min)) sorted[i]!.top = min;
  }
  return sorted;
}

/** Generic dated series chart: zero-based value axis, calendar ticks, vertical event markers, right-gutter labels. */
export function renderDatedSvg(opts: {
  start: string;
  end: string;
  series: SvgSeries[];
  markers: SvgMarker[];
  money: Money;
  title: string;
  desc: string;
  testId: string;
}): SafeHtml {
  const { start, end, series, money } = opts;
  const ticks = zeroBasedTicks(series.flatMap((s) => s.points.map((p) => p.value)));
  const y = linear(ticks[0]!, ticks.at(-1)!, H - M.bottom, M.top);
  const x = linear(new Decimal(epoch(start)), new Decimal(epoch(end)), M.left, W - M.right);
  const xAt = (iso: string) => x(new Decimal(epoch(iso)));
  const xTicks = timeTicks(start, end);
  const placed = placeMarkerLabels(
    [epoch(start), epoch(end)],
    opts.markers.map((m) => ({ t: epoch(m.asOf), label: m.label })),
  );
  const labels = stack(
    series
      .filter((s) => s.end && s.points.length)
      .map((s) => ({ y: y(s.points.at(-1)!.value), lines: s.end!, color: s.color })),
  );
  return html`<svg
    class="rpt-svg"
    viewBox="0 0 ${W} ${H}"
    width="100%"
    role="img"
    aria-labelledby="${opts.testId}-title ${opts.testId}-desc"
    data-testid="${opts.testId}"
    xmlns="http://www.w3.org/2000/svg"
  >
    <title id="${opts.testId}-title">${opts.title}</title>
    <desc id="${opts.testId}-desc">${opts.desc}</desc>
    <style>
      .v {
        font:
          600 8px Helvetica,
          Arial,
          sans-serif;
        fill: ${INK};
      }
      .s {
        font:
          7.5px Helvetica,
          Arial,
          sans-serif;
        fill: ${MUTED};
      }
      .m {
        font:
          600 7.5px Helvetica,
          Arial,
          sans-serif;
      }
    </style>
    ${ticks.map(
      (t) =>
        html`<line x1="${M.left}" x2="${W - M.right}" y1="${y(t)}" y2="${y(t)}" stroke="${RULE}" />
          <text x="${M.left - 6}" y="${off(y(t), 3)}" text-anchor="end" class="s">${money(t.toFixed(2))}</text>`,
    )}
    <line x1="${M.left}" x2="${W - M.right}" y1="${H - M.bottom}" y2="${H - M.bottom}" stroke="#cbd5e1" />
    ${xTicks.map(
      ([t, label]) =>
        html`<text x="${x(new Decimal(t))}" y="${H - M.bottom + 13}" text-anchor="middle" class="s">${label}</text>`,
    )}
    ${opts.markers.map((m, i) => {
      const p = placed[i]!;
      const mx = xAt(m.asOf);
      return html`<line
          x1="${mx}"
          x2="${mx}"
          y1="${M.top - 2}"
          y2="${H - M.bottom}"
          stroke="${m.color}"
          stroke-dasharray="${m.dash}"
          data-marker="${m.label}"
        />
        <text
          x="${off(mx, p.align === "start" ? 4 : -4)}"
          y="${M.top - (p.row === 0 ? 20 : 8)}"
          text-anchor="${p.align}"
          class="m"
          fill="${m.color}"
          >${m.label}</text
        >`;
    })}
    ${series.map((s) =>
      s.noLine || s.points.length < 2
        ? null
        : html`<polyline
            points="${s.points.map((p) => `${xAt(p.asOf)},${y(p.value)}`).join(" ")}"
            fill="none"
            stroke="${s.color}"
            stroke-width="${s.width}"
            ${s.dash ? html`stroke-dasharray="${s.dash}"` : null}
            ${s.opacity ? html`stroke-opacity="${s.opacity}"` : null}
            stroke-linecap="round"
          />`,
    )}
    ${series.map((s) =>
      s.points.map((p) => (p.mark === false ? null : mark(s.marker, xAt(p.asOf), y(p.value), s.color, s.key, p.asOf))),
    )}
    ${labels.map(
      (l) =>
        html`<text x="${W - M.right + 6}" y="${off(l.top.toFixed(1), 7)}" class="v" fill="${l.color}"
          >${l.lines.map(
            (line, i) =>
              html`<tspan x="${W - M.right + 6}" dy="${i ? LABEL_GAP : 0}" class="${i ? "s" : "v"}"
                >${clip(line, 26)}</tspan
              >`,
          )}</text
        >`,
    )}
  </svg>`;
}

/** Legend of what is drawn: line style and mark as well as colour. */
export function datedLegend(series: SvgSeries[], markers: SvgMarker[]): SafeHtml {
  return html`<div class="rpt-legend" data-testid="rpt-trajectory-legend">
    ${series.map(
      (s) =>
        html`<span class="lg"
          ><svg width="26" height="12" viewBox="0 0 26 12" aria-hidden="true">
            ${
              s.noLine
                ? null
                : html`<line
                    x1="0"
                    y1="6"
                    x2="26"
                    y2="6"
                    stroke="${s.color}"
                    stroke-width="${s.width > 2.4 ? 2.4 : s.width}"
                    ${s.dash ? html`stroke-dasharray="${s.dash}"` : null}
                  />`
            }
            ${mark(s.marker, "13.0", "6.0", s.color, `legend-${s.key}`, "")}</svg
          ><b>${s.label}</b></span
        >`,
    )}
    ${markers.map(
      (m) =>
        html`<span class="lg"
          ><svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true">
            <line x1="5" y1="0" x2="5" y2="12" stroke="${m.color}" stroke-dasharray="${m.dash}" /></svg
          >${m.legend}</span
        >`,
    )}
  </div>`;
}

// ---------------------------------------------------------------------------
// Primary Value Trajectory, as at the report's review.

export function primaryTrajectorySeries(t: ReportTrajectory, money: Money) {
  const series: SvgSeries[] = [];
  const v = t.plan.versionNumber;
  if (t.plan.milestones.length) {
    series.push({
      key: "plan",
      label: `${TRAJECTORY_SERIES.plan.label} (V${v})`,
      color: TRAJECTORY_SERIES.plan.color,
      dash: "7 4",
      width: 2,
      marker: "hollow",
      points: t.plan.milestones,
      end: [`${money(t.plan.milestones.at(-1)!.value)} Plan`],
    });
  }
  if (t.realised && t.realised.checkpoints.length) {
    series.push({
      key: "realised",
      label: `${TRAJECTORY_SERIES.realised.label} (formal checkpoints)`,
      color: TRAJECTORY_SERIES.realised.color,
      width: 2.6,
      marker: "square",
      points: [{ ...t.realised.origin, mark: true }, ...t.realised.checkpoints],
    });
  }
  if (t.forecast) {
    series.push({
      key: "forecast",
      label: `${TRAJECTORY_SERIES.forecast.label} (Review #${t.formal.sequence})`,
      color: TRAJECTORY_SERIES.forecast.color,
      dash: "2 3.5",
      width: 2.2,
      marker: "circle",
      points: [...(t.forecast.anchor ? [{ ...t.forecast.anchor, mark: false }] : []), ...t.forecast.points],
      end: [`${money(t.forecast.points.at(-1)!.value)} Forecast`],
    });
  }
  const markers: SvgMarker[] = [];
  const period = t.plan.period!;
  const inPeriod = (d: string) => d >= period.start && d <= period.end;
  if (inPeriod(t.formal.reviewDate)) {
    markers.push({
      asOf: t.formal.reviewDate,
      label: `Formal position ${formatDate(t.formal.reviewDate)}`,
      legend: "Formal position",
      color: "#334155",
      dash: "4 3",
    });
  }
  if (t.versionChange && inPeriod(t.versionChange.authorisedOn)) {
    markers.push({
      asOf: t.versionChange.authorisedOn,
      label: `V${t.versionChange.versionNumber} authorised (${t.versionChange.code})`,
      legend: "Authorised Value Change",
      color: "#1d4ed8",
      dash: "1.5 3",
    });
  }
  return { series, markers };
}

export function renderPrimaryTrajectorySvg(t: ReportTrajectory, money: Money): SafeHtml {
  const { series, markers } = primaryTrajectorySeries(t, money);
  const p = t.plan.period!;
  return renderDatedSvg({
    start: p.start,
    end: p.end,
    series,
    markers,
    money,
    title: "Value Trajectory",
    desc: `Value Period ${formatDate(p.start)} to ${formatDate(p.end)}. ${series
      .map(
        (s) =>
          `${s.label}: ${s.points
            .filter((x) => x.mark !== false)
            .map((x) => `${formatDate(x.asOf)} ${money(x.value)}`)
            .join(", ")}`,
      )
      .join(". ")}. Exact values are in the table below.`,
    testId: "rpt-trajectory-svg",
  });
}

// ---------------------------------------------------------------------------
// Alternative Value Trajectories at the report's review.

const roleText = (o: { recommended: boolean; selected: boolean }) =>
  [o.recommended && "Cardaxia recommendation", o.selected && "Client selected"].filter(Boolean).join(" · ");

export function alternativesSeries(a: ReportAlternatives, reviewDate: string, sequence: number, money: Money) {
  const series: SvgSeries[] = [];
  if (a.history) {
    series.push({
      key: "history",
      label: "Realised (shared history)",
      color: TRAJECTORY_SERIES.realised.color,
      width: 2,
      opacity: 0.6,
      marker: "square",
      points: [
        a.history.origin,
        ...a.history.checkpoints,
        ...(a.anchor ? [{ asOf: a.anchor.asOf, value: a.anchor.value }] : []),
      ],
    });
  }
  a.options.forEach((o, i) => {
    const style = OPTION_STYLES[i % OPTION_STYLES.length]!;
    const roles = roleText(o);
    if (o.milestones.length === 0) {
      // Endpoint only: the stored total is the option's value at the Value Period end; no path is drawn.
      series.push({
        key: `o${i}`,
        label: `${o.label}${roles ? ` · ${roles}` : ""} · phasing not entered`,
        color: style.color,
        width: 0,
        marker: "hollow",
        noLine: true,
        points: [{ asOf: a.period.end, value: o.totalValue }],
        end: [`${money(o.totalValue)} ${o.label}`, ["Phasing not entered", roles].filter(Boolean).join(" · ")],
      });
      return;
    }
    const terminal = o.reconciled ? o.totalValue : o.milestones.at(-1)!.value;
    series.push({
      key: `o${i}`,
      label: `${o.label}${roles ? ` · ${roles}` : ""}`,
      color: style.color,
      dash: style.dash,
      width: o.recommended ? 2.8 : 1.8,
      marker: style.marker,
      points: [...(a.anchor ? [{ asOf: a.anchor.asOf, value: a.anchor.value, mark: false }] : []), ...o.milestones],
      end: [`${money(terminal)} ${o.label}`, ...(roles ? [roles] : [])],
    });
  });
  const markers: SvgMarker[] = [
    {
      asOf: reviewDate,
      label: `Review #${sequence} · ${formatDate(reviewDate)} · options assessed`,
      legend: "Review (branch point)",
      color: "#334155",
      dash: "4 3",
    },
  ];
  return { series, markers };
}

export function renderAlternativesSvg(a: ReportAlternatives, reviewDate: string, sequence: number, money: Money) {
  const { series, markers } = alternativesSeries(a, reviewDate, sequence, money);
  const first = [reviewDate, ...a.options.flatMap((o) => o.milestones.map((m) => m.asOf))].sort()[0]!;
  const start = a.history || first < a.period.start ? a.period.start : first;
  return renderDatedSvg({
    start,
    end: a.period.end,
    series,
    markers,
    money,
    title: "Alternative Value Trajectories",
    desc: `Option paths assessed at Review #${sequence} (${formatDate(reviewDate)}). Stored option totals at ${formatDate(
      a.period.end,
    )}: ${a.options.map((o) => `${o.label} ${money(o.totalValue)}`).join("; ")}. Exact values are in the table below.`,
    testId: "rpt-alternatives-svg",
  });
}

// ---------------------------------------------------------------------------
// Plans: one version (Re-Qualification) or before/after a Value Change.

export function planSeries(
  p: ReportPlan,
  opts: { key: string; label: string; color: string; dash?: string },
  money: Money,
): SvgSeries {
  return {
    key: opts.key,
    label: opts.label,
    color: opts.color,
    dash: opts.dash,
    width: 2,
    marker: "hollow",
    points: p.milestones,
    end: [`${money(p.milestones.at(-1)!.value)} V${p.versionNumber}`],
  };
}

export function renderPlansSvg(
  plans: { plan: ReportPlan; label: string; color: string; dash?: string }[],
  money: Money,
) {
  const series = plans.map((x, i) =>
    planSeries(x.plan, { key: `plan${i}`, label: x.label, color: x.color, dash: x.dash }, money),
  );
  const start = plans.map((x) => x.plan.period!.start).sort()[0]!;
  const end = plans
    .map((x) => x.plan.period!.end)
    .sort()
    .at(-1)!;
  return {
    series,
    svg: renderDatedSvg({
      start,
      end,
      series,
      markers: [],
      money,
      title: "Authorised Plan",
      desc: `${series
        .map((s) => `${s.label}: ${s.points.map((x) => `${formatDate(x.asOf)} ${money(x.value)}`).join(", ")}`)
        .join(". ")}. Exact values are in the table below.`,
      testId: "rpt-plan-svg",
    }),
  };
}
