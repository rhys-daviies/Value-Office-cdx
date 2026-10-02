import type {
  ReportAlternatives,
  ReportAlternativesNote,
  ReportPlan,
  ReportTrajectory,
  ReportTrajectoryNote,
} from "@/domain/reports";
import { formatDate, formatPeriod } from "@/ui/format";
import { VALUE_BASIS_LABELS } from "@/ui/labels";

import {
  alternativesSeries,
  datedLegend,
  primaryTrajectorySeries,
  renderAlternativesSvg,
  renderPlansSvg,
  renderPrimaryTrajectorySvg,
  type SvgSeries,
} from "./charts/trajectory-svg";
import type { Money } from "./common";
import { html, trusted, type SafeHtml } from "./html";

// Value Trajectory report sections (Phase 4D.9J, model v3), rendered from the snapshot only. A chart is drawn only
// when the snapshot holds explicit observations; otherwise a concise statement says what was unavailable at the
// report's date. Every plotted value is also in an exact values table.

type Sec = (title: string) => SafeHtml;

/** v3-only styles, emitted inside v3 reports so v1/v2 snapshots render byte-for-byte as issued. */
export const TRAJECTORY_CSS = trusted(`<style>
.vo-report .rpt-keep { break-inside: avoid; page-break-inside: avoid; }
.vo-report .rpt-svg { display: block; width: 100%; height: auto; margin: 4px 0 6px; }
.vo-report .rpt-legend { display: flex; flex-wrap: wrap; gap: 3px 14px; font-size: 8pt; color: var(--muted); margin: 2px 0; }
.vo-report .rpt-legend .lg { display: inline-flex; align-items: center; gap: 4px; }
.vo-report .rpt-legend b { color: var(--ink); font-weight: 600; }
.vo-report .rpt-compact td, .vo-report .rpt-compact th { padding: 3px 5px; }
.vo-report .rpt-compact { font-size: 8.5pt; }
.vo-report .rpt-exec { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0 14px; margin: 4px 0 6px;
  padding: 10px 0 8px; border-top: 2px solid var(--ink); border-bottom: 1px solid var(--rule); break-inside: avoid; }
.vo-report .rpt-exec .k { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); }
.vo-report .rpt-exec .v { font-size: 20pt; font-weight: 700; line-height: 1.15; font-variant-numeric: tabular-nums; }
.vo-report .rpt-exec .n { font-size: 8pt; color: var(--muted); }
.vo-report .rpt-asat { font-size: 10pt; margin: 0 0 10px; }
.vo-report .rpt-story { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 14px; break-inside: avoid; }
.vo-report .rpt-story > div { border-top: 1px solid var(--rule); padding-top: 5px; }
.vo-report .rpt-story h3 { margin: 0 0 3px; font-size: 8pt; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); }
.vo-report .rpt-story p { margin: 0 0 3px; font-size: 9pt; }
.vo-report .rpt-cmp { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0 14px; margin: 6px 0 8px; break-inside: avoid; }
.vo-report .rpt-cmp .k { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); }
.vo-report .rpt-cmp .v { font-size: 14pt; font-weight: 700; }
.vo-report .rpt-cmp .n { font-size: 8pt; color: var(--muted); }
.vo-report .rpt-break { break-before: page; page-break-before: always; }
</style>`);

const TRAJECTORY_NOTES: Record<ReportTrajectoryNote, string> = {
  plan_phasing_not_entered: "Authorised plan phasing was not entered.",
  forecast_phasing_not_entered: "Formal forecast phasing was not entered for this review.",
  realised_run_rate_not_recorded: "Realised run-rate is not currently recorded.",
  realised_partial_excluded:
    "Realised positions recorded for only some financial drivers are not plotted (no partial totals).",
};

const ALTERNATIVE_NOTES: Record<ReportAlternativesNote, string> = {
  no_valid_anchor:
    "This review does not establish a complete realised position, so each path begins at its first milestone.",
  realised_run_rate_not_recorded:
    "Realised run-rate is not currently recorded, so each path begins at its first milestone.",
  realised_partial_excluded: "Earlier realised positions recorded for only some financial drivers are not plotted.",
  options_without_phasing:
    "Options without entered phasing are shown only as their stored total at the Value Period end, with no path.",
  path_not_reconciled:
    "An option's entered milestones do not end at its stored total; its label shows the last milestone.",
};

/** Why no trajectory can be drawn for a plan, as at the report's date; null when one can. */
export function planUnavailable(p: ReportPlan): string | null {
  switch (p.availability) {
    case "basis_not_classified":
      return "Value Basis not classified — no Value Trajectory is shown.";
    case "basis_not_supported":
      return p.valueBasisKind === "net_present_value"
        ? "Value trajectory is not available for NPV."
        : "Value trajectory is not available for this Value Basis.";
    case "period_not_set":
      return "Value Period not set — no Value Trajectory is shown.";
    default:
      return null;
  }
}

export function basisLine(p: ReportPlan): string {
  return [
    p.valueBasisKind ? `Value Basis ${VALUE_BASIS_LABELS[p.valueBasisKind]}` : "Value Basis not classified",
    p.period ? `Value Period ${formatPeriod(p.period.start, p.period.end)}` : "Value Period not set",
  ].join(" · ");
}

function valuesTable(series: SvgSeries[], money: Money, testId: string): SafeHtml {
  const rows = series
    .flatMap((s) => s.points.filter((p) => p.mark !== false).map((p) => ({ ...p, label: s.label })))
    .sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0));
  return html`<table class="rpt-compact" data-testid="${testId}">
    <thead>
      <tr>
        <th>Date</th>
        <th>Series</th>
        <th class="num">Value</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(
        (r) =>
          html`<tr>
            <td>${formatDate(r.asOf)}</td>
            <td>${r.label}</td>
            <td class="num">${money(r.value)}</td>
          </tr>`,
      )}
    </tbody>
  </table>`;
}

/** Primary Value Trajectory as at the review (Assurance). */
export function trajectorySection(t: ReportTrajectory, sec: Sec, $: { short: Money; plain: Money }): SafeHtml {
  const unavailable = planUnavailable(t.plan);
  if (unavailable) {
    return html`<section>
      ${sec("Value Trajectory")}
      <p class="rpt-muted" data-testid="rpt-trajectory-unavailable">${unavailable}</p>
    </section>`;
  }
  const { series, markers } = primaryTrajectorySeries(t, $.short);
  const notes = t.notes.map((n) => TRAJECTORY_NOTES[n]);
  return html`<section>
    <div class="rpt-keep">
      ${sec("Value Trajectory")}
      <p class="rpt-small rpt-muted">
        Progress against the authorised plan (V${t.plan.versionNumber}) as at Review ${t.formal.sequence}
        (${formatDate(t.formal.reviewDate)}) ·
        ${basisLine(t.plan)}${t.measure === "run_rate" ? " · Annual Run Rate" : " · Cumulative Value"}
      </p>
      ${series.length ? html`${datedLegend(series, markers)} ${renderPrimaryTrajectorySvg(t, $.short)}` : null}
    </div>
    ${
      notes.length
        ? html`<ul class="rpt-list rpt-small" data-testid="rpt-trajectory-notes">
            ${notes.map((n) => html`<li>${n}</li>`)}
          </ul>`
        : null
    }
    <p class="rpt-small rpt-muted">
      Only entered milestones and formally recorded values are plotted; lines between points are visual joins, not
      values. There is no "today" in this report: it records the position as at the review. Exact values are listed in
      the appendix.
    </p>
  </section>`;
}

/** Appendix: every plotted value of the report's trajectory charts, exactly (Assurance). */
export function trajectoryAppendix(
  t: ReportTrajectory | undefined,
  a: ReportAlternatives | null | undefined,
  review: { sequence: number; reviewDate: string },
  sec: Sec,
  $: { short: Money; plain: Money },
): SafeHtml {
  const primary = t && !planUnavailable(t.plan) ? primaryTrajectorySeries(t, $.short).series : [];
  const alternatives = a ? alternativesSeries(a, review.reviewDate, review.sequence, $.short).series : [];
  if (!primary.length && !alternatives.length) return html``;
  return html`<section>
    ${sec("Appendix — trajectory values")}
    <p class="rpt-small rpt-muted">Every value plotted above, exactly as recorded. Nothing here is interpolated.</p>
    ${
      primary.length
        ? html`<h3>Value Trajectory</h3>
            ${valuesTable(primary, $.plain, "rpt-trajectory-values")}`
        : null
    }
    ${
      alternatives.length
        ? html`<h3>Alternative Value Trajectories</h3>
            ${valuesTable(alternatives, $.plain, "rpt-alternatives-values")}`
        : null
    }
  </section>`;
}

/** Alternative Value Trajectories (Assurance), from the snapshot. */
export function alternativesSection(
  a: ReportAlternatives,
  review: { sequence: number; reviewDate: string },
  sec: Sec,
  $: { short: Money; plain: Money; shortChange: Money },
): SafeHtml {
  const { series, markers } = alternativesSeries(a, review.reviewDate, review.sequence, $.short);
  const c = a.decisionComparison;
  const rec = a.options.find((o) => o.recommended);
  return html`<section>
    <div class="rpt-keep">
      ${sec("Alternative Value Trajectories")}
      <p class="rpt-small rpt-muted">
        Future value paths assessed at Review ${review.sequence} (${formatDate(review.reviewDate)}). All options share
        the history to the review and differ only after it. Options are shown in recorded order, not ranked.
      </p>
      <div class="rpt-cmp" data-testid="rpt-decision-comparison">
        <div>
          <div class="k">Cardaxia recommendation</div>
          <div class="v">${rec ? $.short(rec.totalValue) : "Not issued"}</div>
          <div class="n">${rec?.label ?? "No recommendation issued"}</div>
        </div>
        ${
          c
            ? html`<div>
                  <div class="k">Client selected</div>
                  <div class="v">${$.short(c.selected.totalValue)}</div>
                  <div class="n">${c.selected.label}</div>
                </div>
                <div>
                  <div class="k">Difference from Cardaxia recommendation</div>
                  <div class="v" data-testid="rpt-decision-difference">${$.shortChange(c.difference)}</div>
                  <div class="n">Client selected − Cardaxia recommendation</div>
                </div>`
            : html`<div>
                <div class="k">Client decision</div>
                <div class="n">No client decision recorded.</div>
              </div>`
        }
      </div>
      ${datedLegend(series, markers)} ${renderAlternativesSvg(a, review.reviewDate, review.sequence, $.short)}
    </div>
    ${
      a.notes.length
        ? html`<ul class="rpt-list rpt-small" data-testid="rpt-alternatives-notes">
            ${a.notes.map((n) => html`<li>${ALTERNATIVE_NOTES[n]}</li>`)}
          </ul>`
        : null
    }
    <table class="rpt-compact" data-testid="rpt-alternatives-table">
      <thead>
        <tr>
          <th>Option</th>
          <th>Role</th>
          <th class="num">Stored total at ${formatDate(a.period.end)}</th>
          <th>Phasing</th>
        </tr>
      </thead>
      <tbody>
        ${a.options.map(
          (o) =>
            html`<tr>
              <td>${o.label}</td>
              <td>
                ${[o.recommended && "Cardaxia recommendation", o.selected && "Client selected"].filter(Boolean).join(" · ") || "Option"}
              </td>
              <td class="num">${$.short(o.totalValue)}</td>
              <td>
                ${o.milestones.length ? `${o.milestones.length} milestone${o.milestones.length === 1 ? "" : "s"}` : "Phasing not entered"}
              </td>
            </tr>`,
        )}
      </tbody>
    </table>
  </section>`;
}

/** One or two plans (Re-Qualification: the authorised plan; Value Change Notice: before → after). */
export function plansBlock(
  plans: { plan: ReportPlan; label: string; color: string; dash?: string }[],
  $: { short: Money; plain: Money },
  opts: { testId: string; title: string },
): SafeHtml {
  const phased = plans.filter((p) => !planUnavailable(p.plan) && p.plan.milestones.length > 0);
  const unavailable = plans.map((p) => ({ p, why: planUnavailable(p.plan) }));
  if (phased.length !== plans.length) {
    return html`<div data-testid="${opts.testId}">
      <h3>${opts.title}</h3>
      ${unavailable.map(
        ({ p, why }) =>
          html`<p class="rpt-small">
            <strong>${p.label}:</strong>
            ${
              // The unavailability reason already names the missing basis/period; otherwise state basis and period.
              why ??
              `${p.plan.milestones.length ? "Phasing entered" : "Authorised plan phasing not entered"} · ${basisLine(p.plan)}`
            }
          </p>`,
      )}
      <p class="rpt-small rpt-muted">
        No chart is drawn: a plan curve is shown only where every compared plan has entered phasing.
      </p>
    </div>`;
  }
  const { series, svg } = renderPlansSvg(phased, $.short);
  return html`<div data-testid="${opts.testId}">
    <div class="rpt-keep">
      <h3>${opts.title}</h3>
      <p class="rpt-small rpt-muted">${basisLine(plans[0]!.plan)}</p>
      ${datedLegend(series, [])} ${svg}
    </div>
    ${valuesTable(series, $.plain, `${opts.testId}-values`)}
  </div>`;
}
