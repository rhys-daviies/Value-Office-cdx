import Decimal from "decimal.js";

import type { AssuranceNextAction, AssuranceReport } from "@/domain/reports";
import { formatDate } from "@/ui/format";
import { TRIGGER_LABELS } from "@/ui/labels";

import {
  evidenceTag,
  figure,
  moneyFormatters,
  qualificationTag,
  reportEnd,
  reportHeader,
  text,
  type ReportIssueMeta,
} from "./common";
import { html, type SafeHtml } from "./html";

const KIND_LABELS = {
  current: "Current trajectory",
  recommended: "Cardaxia recommendation",
  alternative: "Alternative",
  no_action: "No action",
} as const;

const CHANGE_STATUS = {
  draft: "Draft",
  proposed: "Proposed",
  authorised: "Authorised",
  rejected: "Rejected by the VCO",
  withdrawn: "Withdrawn",
} as const;

function nextActionText(a: AssuranceNextAction): string {
  switch (a.kind) {
    case "leakage_response":
      return `${a.code} ${a.title}: response owner ${a.owner ?? "not yet assigned"}${
        a.requiredDecisionDate ? `; decision required by ${formatDate(a.requiredDecisionDate)}` : ""
      }${a.quantified ? "" : "; amount not yet quantified"}.`;
    case "value_change":
      return a.reconciled === false
        ? `${a.code}: proposed, not reconciled at Value Driver level — not ready for VCO authorisation.`
        : `${a.code}: proposed, awaiting VCO authorisation.`;
    case "forecast":
      return `${a.code} ${a.name}: Current Forecast ${a.notAssessed ? "not assessed" : "not recorded"} in this review.`;
  }
}

/** Bar length as a percentage of the largest scenario (presentation only; Decimal, never floats). */
function barWidth(value: string, max: Decimal): string {
  const v = new Decimal(value);
  if (max.lte(0) || v.lte(0)) return "0";
  return v.dividedBy(max).times(100).toFixed(1);
}

export function renderAssurance(m: AssuranceReport, meta: ReportIssueMeta): SafeHtml {
  const $ = moneyFormatters(m.header.currency);
  const p = m.position;
  const r = m.review;
  const incomplete = p.forecastTotal === null;
  const comparedWith = r.previous
    ? `Assurance Review ${r.previous.sequence} (${formatDate(r.previous.reviewDate)})`
    : `the Authorised Value (V${r.againstVersion.number})`;
  const leak = m.leakage;
  const openLeakage = leak.items.filter((i) => i.status === "open");
  const hasUnattributed = p.unattributedRealised !== null;
  const maxScenario = m.scenarios.reduce((acc, s) => Decimal.max(acc, new Decimal(s.totalValue)), new Decimal(0));

  return html`
    ${reportHeader(m.header, meta, { asAtLabel: "Review date", status: "Finalised Assurance Review" })}

    <section>
      <h2>1. Executive value position</h2>
      <div class="rpt-headline" data-testid="as-headline">
        ${figure("Authorised Value", $.short(p.authorisedTotal), {
          testId: "as-authorised",
          note: `Value Case V${r.againstVersion.number}`,
        })}
        ${figure("Current Forecast", incomplete ? "Incomplete" : $.short(p.forecastTotal), {
          testId: "as-forecast",
          tone: incomplete ? "warn" : undefined,
          note: incomplete
            ? `${p.forecastAssessed} of ${p.financialDriverCount} financial drivers forecast`
            : "All financial drivers forecast",
        })}
        ${figure("Value Gap", incomplete ? "Incomplete" : $.short(p.valueGap), {
          testId: "as-gap",
          tone: incomplete ? "warn" : "gap",
          note: "Authorised Value − Current Forecast",
        })}
        ${figure("Movement", incomplete ? "Incomplete" : $.shortChange(p.movement), {
          testId: "as-movement",
          tone: incomplete ? "warn" : undefined,
          note: `Since ${r.previous ? `Review ${r.previous.sequence}` : "Authorised Value"}`,
        })}
        ${figure("Realised Value", $.short(p.realisedTotal), {
          testId: "as-realised",
          note: hasUnattributed
            ? p.realisedAttributedTotal === null
              ? "All unattributed — see below"
              : "Attributed + unattributed"
            : `${p.realisedAssessed} of ${p.financialDriverCount} drivers assessed`,
        })}
      </div>
      ${
        hasUnattributed
          ? html`<div class="rpt-headline" data-testid="as-realised-breakdown">
                ${figure("Attributed Realised", $.short(p.realisedAttributedTotal), {
                  testId: "as-realised-attributed",
                  note:
                    p.realisedAttributedTotal === null
                      ? "No realised value attributed to drivers"
                      : `${p.realisedAssessed} driver(s)`,
                })}
                ${figure("Unattributed Realised", $.short(p.unattributedRealised), {
                  testId: "as-realised-unattributed",
                  tone: "info",
                  note: "Not allocated to any Value Driver",
                })}
                ${figure("Total Realised", $.short(p.realisedTotal), { testId: "as-realised-total" })}
              </div>
              <div class="callout info" data-testid="as-unattributed-note">
                <strong>Unattributed Realised Value</strong>
                ${$.plain(p.unattributedRealised)} of realised value is known at project level but has not been
                responsibly attributed to individual Value Drivers, so it is not included in any driver's figures.
                ${p.unattributedRationale ? html`<div class="rpt-text">${p.unattributedRationale}</div>` : null}
              </div>`
          : null
      }
      ${
        incomplete
          ? html`<div class="callout warn" data-testid="as-forecast-blockers">
              <strong>Current Forecast incomplete</strong>
              The project forecast and Value Gap are not totalled because these financial drivers have no Current
              Forecast:
              ${p.forecastBlockers.map(
                (b, i) => html`${i ? "; " : ""}${b.code} ${b.name}${b.notAssessed ? " (not assessed)" : ""}`,
              )}.
            </div>`
          : null
      }
      <div class="callout" data-testid="as-leakage-headline">
        <strong>Value Leakage — reported separately from Value Gap</strong>
        ${
          openLeakage.length === 0
            ? "No open Value Leakage is recorded."
            : html`${openLeakage.length} open item(s).
              ${
                leak.summary.assessedCount === 0
                  ? html`<span class="unq">Not yet quantified.</span>`
                  : html`Quantified in this review: ${leak.summary.assessedCount} of ${leak.summary.itemCount} — Total
                    ${$.short(leak.summary.total)} (Recoverable ${$.short(leak.summary.recoverable)}, Unrecoverable
                    ${$.short(leak.summary.unrecoverable)}).
                    ${
                      leak.summary.assessedCount < leak.summary.itemCount
                        ? html`<span class="unq">Other items not yet quantified.</span>`
                        : null
                    }`
              }`
        }
        Value Gap and Value Leakage are separate measures and are not added together.
      </div>
    </section>

    <section>
      <h2>2. Review context</h2>
      <dl class="rpt-kv" data-testid="as-context">
        <dt>Review</dt>
        <dd>Assurance Review ${r.sequence}</dd>
        <dt>Review date</dt>
        <dd>${formatDate(r.reviewDate)}</dd>
        <dt>Trigger</dt>
        <dd>
          ${TRIGGER_LABELS[r.trigger as keyof typeof TRIGGER_LABELS] ?? r.trigger}${
            r.triggerEvidence ? ` — ${r.triggerEvidence.code} ${r.triggerEvidence.title}` : ""
          }
        </dd>
        <dt>Measured against</dt>
        <dd>Authorised Value Case V${r.againstVersion.number} · ${r.againstVersion.title}</dd>
        <dt>Previous position</dt>
        <dd>
          ${r.previous ? `Assurance Review ${r.previous.sequence} (${formatDate(r.previous.reviewDate)})` : "None — first review; movement is measured against the Authorised Value"}
        </dd>
        <dt>Finalised</dt>
        <dd>${formatDate(r.finalisedOn)}${r.finalisedBy ? ` by ${r.finalisedBy}` : ""}</dd>
      </dl>
    </section>

    <section>
      <h2>3. What changed</h2>
      <h3>What changed</h3>
      ${text(r.whatChanged)}
      <h3>Why it matters</h3>
      ${text(r.whyItMatters)}
      ${
        r.summary
          ? html`<h3>Summary</h3>
              ${text(r.summary)}`
          : null
      }
      <h3>Evidence considered</h3>
      ${
        r.evidence.length
          ? html`<table>
              <tbody>
                ${r.evidence.map(
                  (e) =>
                    html`<tr>
                      <td style="width:14%">${e.code}</td>
                      <td>
                        ${e.title}${e.materialChange ? html` <span class="tag part">Material change</span>` : null}
                        ${e.note ? html`<div class="rpt-small rpt-muted">${e.note}</div>` : null}
                      </td>
                    </tr>`,
                )}
              </tbody>
            </table>`
          : html`<p class="rpt-muted"><em>No evidence linked to this review.</em></p>`
      }
    </section>

    <section>
      <h2>4. Value Driver position</h2>
      <p class="rpt-small rpt-muted">Movement is measured against ${comparedWith}.</p>
      <table data-testid="as-drivers">
        <thead>
          <tr>
            <th>Value Driver</th>
            <th class="num">Authorised</th>
            <th class="num">Previous</th>
            <th class="num">Current Forecast</th>
            <th class="num">Movement</th>
            <th class="num">Realised</th>
            <th class="num">Value Gap</th>
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
                    ${
                      d.forecastNotAssessed
                        ? html`<span class="unq" data-testid="as-not-assessed">Not assessed</span>`
                        : d.currentForecast === null
                          ? html`<span class="unq">Not recorded</span>`
                          : $.plain(d.currentForecast)
                    }
                  </td>
                  <td class="num">${$.change(d.movement)}</td>
                  <td class="num">
                    ${d.realisedValue === null ? html`<span class="rpt-muted">—</span>` : $.plain(d.realisedValue)}
                  </td>
                  <td class="num">${$.plain(d.valueGap)}</td>
                  <td>${qualificationTag(d.qualificationStatus)} ${evidenceTag(d.evidenceStatus)}</td>
                </tr>`
              : html`<tr>
                  <td><strong>${d.code}</strong> ${d.name}</td>
                  <td colspan="6">
                    <span class="tag">Non-financial</span> <span class="rpt-muted rpt-small">Excluded from totals</span>
                  </td>
                  <td>${qualificationTag(d.qualificationStatus)} ${evidenceTag(d.evidenceStatus)}</td>
                </tr>`,
          )}
          ${
            hasUnattributed
              ? html`<tr data-testid="as-unattributed-row">
                  <td colspan="5"><em>Unattributed realised value (not allocated to any Value Driver)</em></td>
                  <td class="num">${$.plain(p.unattributedRealised)}</td>
                  <td colspan="2"></td>
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
            <td class="num">${incomplete ? "Incomplete" : $.plain(p.valueGap)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
      ${
        m.drivers.some((d) => d.forecastRationale)
          ? html`<h3>Forecast rationale</h3>
              <dl class="rpt-kv">
                ${m.drivers
                  .filter((d) => d.forecastRationale)
                  .map(
                    (d) =>
                      html`<dt>${d.code} ${d.name}${d.forecastNotAssessed ? " (not assessed)" : ""}</dt>
                        <dd class="rpt-text">${d.forecastRationale}</dd>`,
                  )}
              </dl>`
          : null
      }
    </section>

    <section>
      <h2>5. Value Leakage</h2>
      <p class="rpt-small rpt-muted">
        Value Leakage is value that has been, or is at risk of being, lost. Total = Recoverable + Unrecoverable. It is
        reported separately from Value Gap and is not reconciled to it.
      </p>
      ${
        leak.items.length === 0
          ? html`<p class="rpt-muted"><em>No Value Leakage is recorded.</em></p>`
          : html`<table data-testid="as-leakage">
                <thead>
                  <tr>
                    <th>Issue</th>
                    <th>Affected drivers</th>
                    <th>Response owner (AVO)</th>
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
              ${leak.items.map(
                (i) =>
                  html`<h3>${i.code} ${i.title}</h3>
                    ${i.description ? text(i.description) : null}
                    <dl class="rpt-kv">
                      <dt>Identified</dt>
                      <dd>Assurance Review ${i.identifiedInReview}</dd>
                      ${
                        i.requiredDecisionDate
                          ? html`<dt>Decision required by</dt>
                              <dd>${formatDate(i.requiredDecisionDate)}</dd>`
                          : null
                      }
                      <dt>Consultant assessment</dt>
                      <dd class="rpt-text">${i.consultantAssessment ?? "Not recorded."}</dd>
                      ${
                        i.assessment
                          ? html`${
                              i.assessment.unrecoverableRationale
                                ? html`<dt>Why unrecoverable</dt>
                                    <dd class="rpt-text">${i.assessment.unrecoverableRationale}</dd>`
                                : null
                            }
                            ${
                              i.assessment.note
                                ? html`<dt>Assessment note</dt>
                                    <dd class="rpt-text">${i.assessment.note}</dd>`
                                : null
                            }`
                          : html`<dt>Amount</dt>
                              <dd>
                                <span class="unq">Not yet quantified</span> — no amount has been responsibly established
                                in this review.
                              </dd>`
                      }
                    </dl>`,
              )}`
      }
    </section>

    <section>
      <h2>6. Alternative trajectories</h2>
      ${
        m.scenarios.length === 0
          ? html`<p class="rpt-muted"><em>No options are recorded for this review.</em></p>`
          : html`<p class="rpt-small rpt-muted">
                Option values are Cardaxia's assessed totals for each trajectory, entered from the analysis described.
                The Value Office records and compares them; it does not calculate them.
              </p>
              <div class="bars" data-testid="as-chart">
                ${m.scenarios.map(
                  (s) =>
                    html`<div
                      class="bar ${s.kind === "current" ? "current" : ""} ${s.isRecommendation ? "recommended" : ""} ${s.isClientSelection ? "selected" : ""}"
                    >
                      <span>${s.label}</span>
                      <span class="track"
                        ><span class="fill" style="display:block;width:${barWidth(s.totalValue, maxScenario)}%"></span
                      ></span>
                      <span class="num">${$.short(s.totalValue)}</span>
                    </div>`,
                )}
              </div>
              <table data-testid="as-options">
                <thead>
                  <tr>
                    <th>Option</th>
                    <th>Type</th>
                    <th class="num">Total value</th>
                    <th class="num">vs current</th>
                    <th class="num">vs recommendation</th>
                  </tr>
                </thead>
                <tbody>
                  ${m.scenarios.map(
                    (s) =>
                      html`<tr>
                        <td>
                          ${s.label}${s.isClientSelection ? html` <span class="tag info">Client selected</span>` : null}
                          ${s.narrative ? html`<div class="rpt-small rpt-muted rpt-text">${s.narrative}</div>` : null}
                        </td>
                        <td>${KIND_LABELS[s.kind]}</td>
                        <td class="num">${$.short(s.totalValue)}</td>
                        <td class="num">${$.shortChange(s.vsCurrent)}</td>
                        <td class="num">${$.shortChange(s.vsRecommended)}</td>
                      </tr>`,
                  )}
                </tbody>
              </table>`
      }
    </section>

    <section>
      <h2>7. Cardaxia recommendation</h2>
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
      <h2>8. Client decision</h2>
      ${
        m.decision
          ? html`<div class="rpt-panel" data-testid="as-decision">
                <dl class="rpt-kv">
                  <dt>Selected option</dt>
                  <dd><strong>${m.decision.label}</strong> · ${$.short(m.decision.totalValue)}</dd>
                  <dt>Decision maker</dt>
                  <dd>${m.decision.decidedBy}</dd>
                  <dt>Decision date</dt>
                  <dd>${formatDate(m.decision.decidedOn)}</dd>
                  <dt>Rationale</dt>
                  <dd class="rpt-text">${m.decision.rationale ?? "Not recorded."}</dd>
                  <dt>Economic consequence</dt>
                  <dd class="rpt-text">${m.decision.economicConsequence ?? "Not recorded."}</dd>
                  <dt>Difference vs Cardaxia recommendation</dt>
                  <dd data-testid="as-client-difference">
                    <strong>${$.shortChange(m.decision.clientElectedDifference)}</strong> (client-elected)
                  </dd>
                  ${
                    m.decision.evidence
                      ? html`<dt>Supporting evidence</dt>
                          <dd>${m.decision.evidence.code} ${m.decision.evidence.title}</dd>`
                      : null
                  }
                </dl>
              </div>
              <p class="rpt-small rpt-muted">
                The Cardaxia recommendation is preserved as issued. The client decision is recorded separately and does
                not alter it.
              </p>`
          : html`<p class="rpt-muted"><em>No client decision is recorded for this review.</em></p>`
      }
    </section>

    <section>
      <h2>9. Value Change</h2>
      ${
        m.valueChanges.length === 0
          ? html`<p class="rpt-muted"><em>No Value Change has been proposed from this review.</em></p>`
          : m.valueChanges.map(
              (c) =>
                html`<div class="rpt-panel" data-testid="as-value-change">
                  <p>
                    <span class="stamp ${c.status === "authorised" ? "good" : "neutral"}"
                      >${CHANGE_STATUS[c.status]}</span
                    >
                    ${
                      c.status === "proposed" && c.reconciled === false
                        ? html`<span class="stamp">Not reconciled</span>`
                        : null
                    }
                  </p>
                  <dl class="rpt-kv">
                    <dt>Value Change</dt>
                    <dd>${c.code} · V${c.fromVersion} → V${c.toVersion}</dd>
                    <dt>Stated change</dt>
                    <dd>${$.shortChange(c.statedChange)}</dd>
                    <dt>Current authorised value</dt>
                    <dd>${$.short(c.fromTotal)}</dd>
                    ${
                      c.status === "authorised"
                        ? html`<dt>New authorised value</dt>
                            <dd>${$.short(c.toTotal)} (V${c.toVersion})</dd>`
                        : html`<dt>Proposed authorised value</dt>
                            <dd>${$.short(c.projectedValue)}</dd>`
                    }
                    ${
                      c.reason
                        ? html`<dt>Reason</dt>
                            <dd class="rpt-text">${c.reason}</dd>`
                        : null
                    }
                  </dl>
                  ${
                    c.status === "proposed"
                      ? html`<p class="rpt-small">
                          ${
                            c.reconciled === false
                              ? "Not reconciled at Value Driver level — not ready for VCO authorisation. The Authorised Value is unchanged until the VCO authorises a reconciled change."
                              : "Awaiting VCO authorisation. The Authorised Value is unchanged until then."
                          }
                        </p>`
                      : null
                  }
                </div>`,
            )
      }
    </section>

    <section>
      <h2>10. Next actions</h2>
      ${
        m.nextActions.length
          ? html`<ul class="rpt-list" data-testid="as-next-actions">
                ${m.nextActions.map((a) => html`<li>${nextActionText(a)}</li>`)}
              </ul>
              <p class="rpt-small rpt-muted">Only actions recorded in the Value Record are listed.</p>`
          : html`<p class="rpt-muted"><em>No outstanding actions are recorded.</em></p>`
      }
    </section>
    ${reportEnd(meta)}
  `;
}
