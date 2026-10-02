import Decimal from "decimal.js";

import type { AssuranceReport } from "@/domain/reports";
import { formatDate, formatMoneyAdaptive, formatMoneyAdaptiveChange } from "@/ui/format";
import { TRIGGER_LABELS } from "@/ui/labels";

import {
  renderEvolutionSection,
  renderOptionsOnlySection,
  renderOutcomesSection,
  VISUAL_CSS,
} from "./assurance-visuals";
import {
  evidenceTag,
  moneyFormatters,
  qualificationTag,
  reportEnd,
  reportHeader,
  text,
  type ReportIssueMeta,
} from "./common";
import { html, type SafeHtml } from "./html";
import { alternativesSection, TRAJECTORY_CSS, trajectoryAppendix, trajectorySection } from "./trajectory-sections";

// Value Assurance Report, model v3 (Phase 4D.9J). The approved Value Office narrative, as a deliberate client
// document rendered only from the issued snapshot: committed value → formal position → progression through time →
// value requiring attention → Cardaxia response → management decision → governance. v1/v2 snapshots never come here;
// they render through `renderAssurance`, byte-for-byte as issued.

const CHANGE_STATUS = {
  draft: "Draft — not in force",
  proposed: "Proposed — not in force",
  authorised: "Authorised",
  rejected: "Rejected by the VCO",
  withdrawn: "Withdrawn",
} as const;

export function renderAssuranceV3(m: AssuranceReport, meta: ReportIssueMeta): SafeHtml {
  const $ = moneyFormatters(m.header.currency);
  const adaptive = (v: string | null) => formatMoneyAdaptive(v, m.header.currency);
  const adaptiveChange = (v: string | null) => formatMoneyAdaptiveChange(v, m.header.currency);
  const p = m.position;
  const r = m.review;
  const incomplete = p.forecastTotal === null;
  const leak = m.leakage;
  let n = 0;
  const sec = (title: string) => html`<h2>${++n}. ${title}</h2>`;
  const drivers = new Map(m.drivers.map((d) => [d.code, d]));
  const realisedNote =
    p.unattributedRealised !== null
      ? p.realisedAttributedTotal === null
        ? "All recorded as unattributed (project level)"
        : "Attributed + unattributed"
      : p.realisedAssessed === p.financialDriverCount
        ? null
        : `${p.realisedAssessed} of ${p.financialDriverCount} drivers assessed`;
  const exec = (k: string, v: string, note: string | null, testId: string) =>
    html`<div data-testid="${testId}">
      <div class="k">${k}</div>
      <div class="v">${v}</div>
      ${note ? html`<div class="n">${note}</div>` : null}
    </div>`;

  return html`
    ${reportHeader(m.header, meta, { asAtLabel: "Review date", status: "Finalised Assurance Review" })}${VISUAL_CSS}${TRAJECTORY_CSS}

    <section>
      ${sec("Executive value position")}
      <p class="rpt-asat" data-testid="rpt-formal-position">
        Formal position as at <strong>${formatDate(r.reviewDate)}</strong> · Assurance Review ${r.sequence} · measured
        against Authorised Value Case V${r.againstVersion.number}
      </p>
      <div class="rpt-exec" data-testid="rpt-exec">
        ${exec("Authorised Value", $.short(p.authorisedTotal), `V${r.againstVersion.number}`, "rpt-exec-authorised")}
        ${exec("Realised", $.short(p.realisedTotal), realisedNote, "rpt-exec-realised")}
        ${exec(
          "Formal Forecast",
          incomplete ? "Incomplete" : $.short(p.forecastTotal),
          incomplete
            ? `${p.forecastAssessed} of ${p.financialDriverCount} drivers forecast`
            : "At the Value Period end",
          "rpt-exec-forecast",
        )}
        ${exec("Value Gap", incomplete ? "Incomplete" : $.short(p.valueGap), "Authorised − Formal Forecast", "rpt-exec-gap")}
      </div>
      ${
        incomplete
          ? html`<div class="callout warn" data-testid="as-forecast-blockers">
              <strong>Formal Forecast incomplete</strong>
              The forecast and Value Gap are not totalled because these financial drivers have no forecast:
              ${p.forecastBlockers.map((b, i) => html`${i ? "; " : ""}${b.code} ${b.name}${b.notAssessed ? " (not assessed)" : ""}`)}.
            </div>`
          : null
      }
      ${
        p.unattributedRealised !== null
          ? html`<p class="rpt-small" data-testid="as-unattributed-note">
              Realised includes ${$.plain(p.unattributedRealised)} recorded at project level and not attributed to any
              Value Driver.${p.unattributedRationale ? ` ${p.unattributedRationale}` : ""}
            </p>`
          : null
      }
      <p class="rpt-small rpt-muted">
        This report records the formal position as at the review; it does not describe the project today. Value Gap and
        Value Leakage are separate measures and are not added together.
      </p>
    </section>

    ${m.trajectory ? trajectorySection(m.trajectory, sec, $) : null}

    <section>
      ${sec("Why the value position moved")}
      <div class="rpt-story" data-testid="rpt-story">
        <div>
          <h3>What changed</h3>
          <p>
            Trigger:
            ${TRIGGER_LABELS[r.trigger as keyof typeof TRIGGER_LABELS] ?? r.trigger}${r.triggerEvidence ? ` — ${r.triggerEvidence.code} ${r.triggerEvidence.title}` : ""}
          </p>
          ${r.whatChanged ? html`<p>${r.whatChanged}</p>` : null}
          ${
            leak.items.length
              ? leak.items.map(
                  (i) =>
                    html`<p>
                      <strong>${i.code} ${i.title}</strong>${i.responseOwner ? ` · Owner ${i.responseOwner}` : ""}
                    </p>`,
                )
              : html`<p class="rpt-muted">No Assurance matter recorded in this review.</p>`
          }
        </div>
        <div>
          <h3>Value affected</h3>
          ${leak.items.map(
            (i) =>
              html`${i.drivers.map((d) => {
                  const row = drivers.get(d.code);
                  return html`<p>
                    ${d.code}
                    ${d.name}${
                      row && row.currentForecast !== null
                        ? `: forecast ${$.short(row.previousForecast)} → ${$.short(row.currentForecast)}${row.movement !== null ? ` (${$.shortChange(row.movement)})` : ""}`
                        : ""
                    }
                  </p>`;
                })}
                <p data-testid="rpt-story-leakage">
                  ${
                    i.assessment
                      ? `${i.code}: Total Value Leakage ${$.plain(i.assessment.total)} = Recoverable ${$.plain(i.assessment.recoverable)} + Unrecoverable ${$.plain(i.assessment.unrecoverable)}`
                      : `${i.code}: Value Leakage not yet quantified in this review`
                  }
                </p>`,
          )}
          <p class="rpt-small rpt-muted">Value Leakage is assessed per matter; it is not the Value Gap.</p>
        </div>
        <div>
          <h3>Cardaxia response</h3>
          ${
            m.recommendation
              ? html`<p>
                  Recommendation: <strong>${m.recommendation.label}</strong> · stored option total
                  ${$.short(m.recommendation.totalValue)}
                </p>`
              : html`<p class="rpt-muted">No Cardaxia recommendation issued.</p>`
          }
        </div>
        <div>
          <h3>Management decision</h3>
          ${
            m.decision
              ? html`<p>Selected: <strong>${m.decision.label}</strong> · ${$.short(m.decision.totalValue)}</p>
                  ${
                    m.decision.clientElectedDifference !== null
                      ? html`<p>
                          Difference from Cardaxia recommendation: ${$.shortChange(m.decision.clientElectedDifference)}
                        </p>`
                      : null
                  }
                  <p class="rpt-small">${m.decision.decidedBy}, ${formatDate(m.decision.decidedOn)}</p>`
              : html`<p class="rpt-muted">No management decision recorded.</p>`
          }
        </div>
        <div style="grid-column: 1 / -1">
          <h3>Governance</h3>
          <p>
            Value Gap ${incomplete ? "incomplete" : $.short(p.valueGap)} against Authorised V${r.againstVersion.number}.
            ${
              m.valueChanges.length
                ? m.valueChanges.map(
                    (c) => `${c.code} · V${c.fromVersion} → V${c.toVersion} · ${CHANGE_STATUS[c.status]}. `,
                  )
                : "No Value Change linked to this review. Forecast movement does not change the Authorised Value Case."
            }
          </p>
        </div>
      </div>
      <p class="rpt-small rpt-muted">
        Evidence shown is the review's own formal evidence; evidence attached to individual matters is not part of the
        formal record.
      </p>
    </section>

    <section>
      ${sec("Value Leakage")}
      <p class="rpt-small rpt-muted">
        Per matter, as assessed in this review: Total = Recoverable + Unrecoverable. Reported separately from Value Gap
        and not reconciled to it.
      </p>
      ${
        leak.items.length === 0
          ? html`<p class="rpt-muted"><em>No Value Leakage is recorded.</em></p>`
          : html`<table data-testid="as-leakage">
                <thead>
                  <tr>
                    <th>Matter</th>
                    <th>Affected drivers</th>
                    <th>Risk / Leakage Owner</th>
                    <th class="num">Total VL</th>
                    <th class="num">Recoverable</th>
                    <th class="num">Unrecoverable</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${leak.items.map(
                    (i) =>
                      html`<tr data-testid="as-leakage-row">
                        <td><strong>${i.code}</strong> ${i.title}</td>
                        <td>
                          ${i.drivers.length ? i.drivers.map((d) => d.code).join(", ") : html`<span class="rpt-muted">Not specified</span>`}
                        </td>
                        <td>${i.responseOwner ?? html`<span class="unq">Not assigned</span>`}</td>
                        ${
                          i.assessment
                            ? html`<td class="num">${$.plain(i.assessment.total)}</td>
                                <td class="num">${$.plain(i.assessment.recoverable)}</td>
                                <td class="num">${$.plain(i.assessment.unrecoverable)}</td>`
                            : html`<td colspan="3" style="text-align:center">
                                <span class="unq" data-testid="as-leakage-unquantified">Not yet quantified</span>
                              </td>`
                        }
                        <td>${i.status === "open" ? "Open" : "Closed"}</td>
                      </tr>`,
                  )}
                </tbody>
              </table>
              ${leak.items
                .filter((i) => i.assessment?.unrecoverableRationale || i.consultantAssessment)
                .map(
                  (i) =>
                    html`<p class="rpt-small">
                      <strong>${i.code}</strong
                      >${i.consultantAssessment ? ` ${i.consultantAssessment}` : ""}${i.assessment?.unrecoverableRationale ? ` Why unrecoverable: ${i.assessment.unrecoverableRationale}` : ""}
                    </p>`,
                )}`
      }
    </section>

    ${
      m.alternatives
        ? alternativesSection(m.alternatives, { sequence: r.sequence, reviewDate: r.reviewDate }, sec, $)
        : m.outcomes
          ? renderOutcomesSection(m, m.outcomes, sec)
          : m.scenarios.length
            ? renderOptionsOnlySection(m, sec)
            : null
    }

    <section>
      ${sec("Cardaxia recommendation")}
      ${
        m.recommendation
          ? html`<div class="rpt-panel" data-testid="as-recommendation">
              <p>
                <strong>${m.recommendation.label}</strong> · ${$.short(m.recommendation.totalValue)}
                <span class="rpt-muted rpt-small">(issued ${formatDate(m.recommendation.issuedOn)})</span>
              </p>
              ${text(m.recommendation.narrative)}
            </div>`
          : html`<p class="rpt-muted"><em>No Cardaxia recommendation has been issued for this review.</em></p>`
      }
    </section>

    <section>
      ${sec("Management decision")}
      ${
        m.decision
          ? html`<dl class="rpt-kv" data-testid="as-decision">
                <dt>Selected option</dt>
                <dd><strong>${m.decision.label}</strong> · ${$.short(m.decision.totalValue)}</dd>
                <dt>Difference from Cardaxia recommendation</dt>
                <dd data-testid="as-client-difference">
                  <strong>${$.shortChange(m.decision.clientElectedDifference)}</strong>
                </dd>
                <dt>Decision maker</dt>
                <dd>${m.decision.decidedBy}</dd>
                <dt>Decision date</dt>
                <dd>${formatDate(m.decision.decidedOn)}</dd>
                <dt>Rationale</dt>
                <dd class="rpt-text">${m.decision.rationale ?? "Not recorded."}</dd>
                <dt>Economic consequence</dt>
                <dd class="rpt-text">${m.decision.economicConsequence ?? "Not recorded."}</dd>
              </dl>
              <p class="rpt-small rpt-muted">
                The Cardaxia recommendation is preserved as issued; the decision does not alter it.
              </p>`
          : html`<p class="rpt-muted"><em>No management decision is recorded for this review.</em></p>`
      }
    </section>

    <section>
      ${sec("Governance and Value Change")}
      ${
        m.valueChanges.length === 0
          ? html`<p class="rpt-muted">
              <em
                >No Value Change has been linked to this review. The Authorised Value Case is unchanged by forecast
                movement.</em
              >
            </p>`
          : m.valueChanges.map(
              (c) =>
                html`<div class="rpt-panel" data-testid="as-value-change">
                  <p>
                    <strong>${c.code}</strong> · V${c.fromVersion} → V${c.toVersion} ·
                    <span class="stamp ${c.status === "authorised" ? "good" : "neutral"}"
                      >${CHANGE_STATUS[c.status]}</span
                    >
                  </p>
                  ${
                    c.status === "authorised"
                      ? html`<p>
                          Authorised value ${adaptive(c.fromTotal)} → ${adaptive(c.toTotal)} (V${c.toVersion}).
                        </p>`
                      : c.reconciled === false
                        ? html`<p data-testid="as-value-change-unreconciled">
                            Stated change ${adaptiveChange(c.statedChange)} · current draft movement
                            ${adaptiveChange(diff(c.toTotal, c.fromTotal))} · does not reconcile. The Authorised Value
                            is unchanged until the VCO authorises a reconciled change.
                          </p>`
                        : html`<p>
                            Proposed change ${adaptiveChange(c.statedChange ?? diff(c.toTotal, c.fromTotal))} · not in
                            force. The Authorised Value is unchanged until the VCO authorises it.
                          </p>`
                  }
                  ${c.reason ? html`<p class="rpt-small rpt-text">${c.reason}</p>` : null}
                </div>`,
            )
      }
    </section>

    <section>
      ${sec("Value Driver position")}
      <table data-testid="as-drivers" class="rpt-compact">
        <thead>
          <tr>
            <th>Value Driver</th>
            <th class="num">Authorised</th>
            <th class="num">Previous</th>
            <th class="num">Formal Forecast</th>
            <th class="num">Movement</th>
            <th class="num">Realised</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${m.drivers.map((d) =>
            d.financial
              ? html`<tr>
                  <td><strong>${d.code}</strong> ${d.name}</td>
                  <td class="num">${$.plain(d.authorisedValue)}</td>
                  <td class="num">${$.plain(d.previousForecast)}</td>
                  <td class="num">
                    ${d.forecastNotAssessed ? html`<span class="unq">Not assessed</span>` : d.currentForecast === null ? html`<span class="unq">Not recorded</span>` : $.plain(d.currentForecast)}
                  </td>
                  <td class="num">${$.change(d.movement)}</td>
                  <td class="num">
                    ${d.realisedValue === null ? html`<span class="rpt-muted">—</span>` : $.plain(d.realisedValue)}
                  </td>
                  <td>${qualificationTag(d.qualificationStatus)} ${evidenceTag(d.evidenceStatus)}</td>
                </tr>`
              : html`<tr>
                  <td><strong>${d.code}</strong> ${d.name}</td>
                  <td colspan="5">
                    <span class="tag">Non-financial</span> <span class="rpt-muted rpt-small">Excluded from totals</span>
                  </td>
                  <td>${qualificationTag(d.qualificationStatus)} ${evidenceTag(d.evidenceStatus)}</td>
                </tr>`,
          )}
          ${
            p.unattributedRealised !== null
              ? html`<tr data-testid="as-unattributed-row">
                  <td colspan="5"><em>Unattributed realised value (not allocated to any Value Driver)</em></td>
                  <td class="num">${$.plain(p.unattributedRealised)}</td>
                  <td></td>
                </tr>`
              : null
          }
        </tbody>
        <tfoot>
          <tr>
            <td>Total (financial drivers)</td>
            <td class="num">${$.plain(p.authorisedTotal)}</td>
            <td class="num">${p.previousTotal === null ? "Incomplete" : $.plain(p.previousTotal)}</td>
            <td class="num">${incomplete ? "Incomplete" : $.plain(p.forecastTotal)}</td>
            <td class="num">${incomplete ? "Incomplete" : $.change(p.movement)}</td>
            <td class="num">${$.plain(p.realisedTotal)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </section>

    ${m.evolution ? renderEvolutionSection(m, sec) : null}

    <section>
      ${sec("Review record")}
      <dl class="rpt-kv" data-testid="as-context">
        <dt>Review</dt>
        <dd>Assurance Review ${r.sequence} · ${formatDate(r.reviewDate)}</dd>
        <dt>Previous position</dt>
        <dd>
          ${r.previous ? `Assurance Review ${r.previous.sequence} (${formatDate(r.previous.reviewDate)})` : "None — first review; movement is measured against the Authorised Value"}
        </dd>
        <dt>Finalised</dt>
        <dd>${formatDate(r.finalisedOn)}${r.finalisedBy ? ` by ${r.finalisedBy}` : ""}</dd>
        <dt>Why it matters</dt>
        <dd class="rpt-text">${r.whyItMatters ?? "Not recorded."}</dd>
        <dt>Formal evidence</dt>
        <dd>
          ${r.evidence.length ? r.evidence.map((e) => `${e.code} ${e.title}`).join("; ") : "None linked to this review"}
        </dd>
      </dl>
    </section>
    ${trajectoryAppendix(m.trajectory, m.alternatives, { sequence: r.sequence, reviewDate: r.reviewDate }, sec, $)}
    ${reportEnd(meta)}
  `;
}

/** a − b for snapshot decimal strings (exact; Decimal) — the draft version's movement, as recorded. */
function diff(a: string, b: string): string {
  return new Decimal(a).minus(b).toFixed(2);
}
