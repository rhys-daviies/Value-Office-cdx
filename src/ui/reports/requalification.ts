import type { RequalificationReport } from "@/domain/reports";
import { EVIDENCE_STATUSES, QUALIFICATION_STATUSES } from "@/domain/statuses";
import { formatDate, formatMetric } from "@/ui/format";
import { EVIDENCE_STATUS_LABELS, QUALIFICATION_LABELS } from "@/ui/labels";

import {
  evidenceList,
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

const AUTHORITY: Record<string, string> = {
  authorised: "Authorised",
  superseded: "Authorised (since superseded by a Value Change)",
  proposed: "Proposed — awaiting VCO authorisation",
  draft: "Draft — not authorised",
};

export function renderRequalification(m: RequalificationReport, meta: ReportIssueMeta): SafeHtml {
  const $ = moneyFormatters(m.header.currency);
  const a = m.authorised;
  const authorised = a.status === "authorised" || a.status === "superseded";
  const status = AUTHORITY[a.status] ?? a.status;
  const decomposed = (m.inherited?.driverCount ?? 0) > 0;
  const bare = m.drivers.filter((d) => d.assumptions.length === 0 && d.evidence.length === 0);
  const detailed = m.drivers.filter((d) => !bare.includes(d));
  const gaps = m.drivers.filter((d) => d.evidenceStatus !== "evidenced" || d.qualificationStatus !== "qualified");

  return html`
    ${reportHeader(m.header, meta, { asAtLabel: "Authorised on", status })}
    ${
      a.status === "superseded"
        ? html`<div class="callout bad" data-testid="rq-superseded">
            <span class="stamp">Superseded — not current Authorised Value Case</span>
            <div>
              This historical report describes the Re-Qualification that established V${a.versionNumber}.
              V${a.versionNumber} has been superseded by an approved Value
              Change${
                m.currentVersion
                  ? ` — the Authorised Value Case now in force is V${m.currentVersion.versionNumber} (${m.currentVersion.title}) at ${$.plain(m.currentVersion.total)}`
                  : ""
              }.
            </div>
          </div>`
        : null
    }

    <section>
      <h2>1. Executive summary</h2>
      <div class="rpt-headline">
        ${figure("Inherited Business Case", $.short(m.inherited?.total), {
          testId: "rq-inherited",
          note: m.inherited ? m.inherited.title : "Not recorded",
        })}
        ${figure(authorised ? "Authorised Value" : "Re-Qualified Value (not authorised)", $.short(a.total), {
          testId: "rq-authorised",
          note: `Value Case V${a.versionNumber}`,
        })}
        ${figure("Movement", $.shortChange(m.movement), { testId: "rq-movement", tone: "gap" })}
        ${figure("Value Drivers", String(m.counts.driverCount), {
          testId: "rq-driver-count",
          note: `${m.counts.financialCount} financial · ${m.counts.nonFinancialCount} non-financial`,
        })}
      </div>
      <p>
        ${
          authorised
            ? `The Re-Qualified Value Case (V${a.versionNumber}) was authorised by ${a.authorisedBy ?? "the Value Case Owner"} on ${formatDate(a.authorisedOn)} at ${$.plain(a.total)}.`
            : `The Re-Qualified Value Case (V${a.versionNumber}) has not been authorised by the Value Case Owner. Figures are not authoritative until it is.`
        }
        ${
          a.status === "superseded"
            ? ` It has since been superseded by a later authorised version following an approved Value Change${a.supersededOn ? ` (${formatDate(a.supersededOn)})` : ""}; this report records the Re-Qualification as authorised and is preserved unchanged.`
            : ""
        }
      </p>
      ${a.summary ? text(a.summary) : null}
    </section>

    <section>
      <h2>2. Value Case movement</h2>
      <p data-testid="rq-movement-line">
        Inherited Business Case <strong>${$.short(m.inherited?.total)}</strong> → Re-Qualified Value Case
        <strong>${$.short(a.total)}</strong> · Movement <strong>${$.shortChange(m.movement)}</strong>
      </p>
      ${
        decomposed
          ? html`<table>
                <thead>
                  <tr>
                    <th>Value Driver</th>
                    <th class="num">Inherited</th>
                    <th class="num">Re-Qualified</th>
                    <th class="num">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  ${m.drivers.map(
                    (d) =>
                      html`<tr>
                        <td>${d.code} ${d.name}</td>
                        <td class="num">
                          ${
                            d.inherited.present
                              ? d.inherited.financialValue === null
                                ? "Non-financial"
                                : $.plain(d.inherited.financialValue)
                              : html`<span class="rpt-muted">Not in Business Case</span>`
                          }
                        </td>
                        <td class="num">${d.financialValue === null ? "Non-financial" : $.plain(d.financialValue)}</td>
                        <td class="num">${$.change(d.inherited.change)}</td>
                      </tr>`,
                  )}
                  ${m.notCarriedForward.map(
                    (d) =>
                      html`<tr>
                        <td>${d.code} ${d.name}</td>
                        <td class="num">${d.financialValue === null ? "Non-financial" : $.plain(d.financialValue)}</td>
                        <td class="num"><span class="rpt-muted">Not carried forward</span></td>
                        <td class="num">—</td>
                      </tr>`,
                  )}
                </tbody>
              </table>
              <p class="rpt-muted rpt-small">
                Differences are shown as recorded. Reasons are limited to the economic rationale recorded for each
                driver below.
              </p>`
          : html`<p class="rpt-muted">
              The inherited Business Case was recorded as a headline figure only, so the movement is not broken down by
              Value Driver.
            </p>`
      }
    </section>

    <section>
      <h2>3. Value Drivers</h2>
      <table data-testid="rq-drivers">
        <thead>
          <tr>
            <th>Value Driver</th>
            <th>Metric: baseline → target</th>
            <th class="num">Financial value</th>
            <th>AVO</th>
            <th>Qualification</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          ${m.drivers.map(
            (d) =>
              html`<tr>
                <td><strong>${d.code}</strong> ${d.name}</td>
                <td>
                  ${d.metric ?? "—"}
                  ${
                    d.metric
                      ? html`<div class="rpt-small rpt-muted">
                          ${formatMetric(d.baselineValue, d.metricUnit)} → ${formatMetric(d.targetValue, d.metricUnit)}
                        </div>`
                      : null
                  }
                </td>
                <td class="num">
                  ${d.financialValue === null ? html`<span class="tag">Non-financial</span>` : $.plain(d.financialValue)}
                </td>
                <td>${d.avoName ?? html`<span class="unq">Not nominated</span>`}</td>
                <td>${qualificationTag(d.qualificationStatus)}</td>
                <td>${evidenceTag(d.evidenceStatus)}</td>
              </tr>`,
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2">Total (financial drivers)</td>
            <td class="num">${$.plain(a.total)}</td>
            <td colspan="3"></td>
          </tr>
        </tfoot>
      </table>
      <h3>Economic rationale</h3>
      <dl class="rpt-kv">
        ${m.drivers.map(
          (d) =>
            html`<dt>${d.code} ${d.name}</dt>
              <dd>
                ${
                  d.economicRationale
                    ? html`<span class="rpt-text">${d.economicRationale}</span>`
                    : html`<span class="rpt-muted"><em>No rationale recorded.</em></span>`
                }
                ${d.timing ? html`<div class="rpt-small rpt-muted">Timing: ${d.timing}</div>` : null}
              </dd>`,
        )}
      </dl>
    </section>

    <section>
      <h2>4. Assumptions and evidence</h2>
      ${
        gaps.length
          ? html`<div class="callout warn" data-testid="rq-gaps">
              <strong>Evidence and qualification gaps</strong>
              ${gaps.map(
                (d) =>
                  html`<div>
                    ${d.code} ${d.name}: ${QUALIFICATION_LABELS[d.qualificationStatus]},
                    ${EVIDENCE_STATUS_LABELS[d.evidenceStatus]}
                  </div>`,
              )}
            </div>`
          : html`<p>All Value Drivers are recorded as qualified and evidenced.</p>`
      }
      ${
        bare.length
          ? html`<p class="rpt-muted" data-testid="rq-no-assumptions">
              No assumptions or evidence recorded for: ${bare.map((d) => `${d.code} ${d.name}`).join("; ")}.
            </p>`
          : null
      }
      ${detailed.map(
        (d) =>
          html`<h3>${d.code} ${d.name}</h3>
            ${
              d.assumptions.length
                ? html`<table>
                    <thead>
                      <tr>
                        <th>Assumption</th>
                        <th style="width:16%">Evidence status</th>
                        <th style="width:30%">Evidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${d.assumptions.map(
                        (x) =>
                          html`<tr>
                            <td>
                              ${x.statement}${x.notes ? html`<div class="rpt-small rpt-muted rpt-text">${x.notes}</div>` : null}
                            </td>
                            <td>${evidenceTag(x.evidenceStatus)}</td>
                            <td class="rpt-small">${evidenceList(x.evidence)}</td>
                          </tr>`,
                      )}
                    </tbody>
                  </table>`
                : html`<p class="rpt-muted"><em>No assumptions recorded.</em></p>`
            }
            <p class="rpt-small"><span class="rpt-muted">Driver evidence:</span> ${evidenceList(d.evidence)}</p>`,
      )}
    </section>

    <section>
      <h2>5. Qualification summary</h2>
      <div class="rpt-cols">
        <table data-testid="rq-qualification">
          <thead>
            <tr>
              <th>Qualification</th>
              <th class="num">Drivers</th>
            </tr>
          </thead>
          <tbody>
            ${[...QUALIFICATION_STATUSES].reverse().map(
              (s) =>
                html`<tr>
                  <td>${QUALIFICATION_LABELS[s]}</td>
                  <td class="num">${m.counts.qualification[s]}</td>
                </tr>`,
            )}
          </tbody>
        </table>
        <table data-testid="rq-evidence">
          <thead>
            <tr>
              <th>Evidence</th>
              <th class="num">Drivers</th>
              <th class="num">Assumptions</th>
            </tr>
          </thead>
          <tbody>
            ${[...EVIDENCE_STATUSES].reverse().map(
              (s) =>
                html`<tr>
                  <td>${EVIDENCE_STATUS_LABELS[s]}</td>
                  <td class="num">${m.counts.evidence[s]}</td>
                  <td class="num">${m.counts.assumptionEvidence[s]}</td>
                </tr>`,
            )}
          </tbody>
        </table>
      </div>
      <p class="rpt-small rpt-muted">
        Counts only — no score or weighting is applied. ${m.counts.withoutEvidenceLinks} driver(s) have no linked
        evidence; ${m.counts.withoutAvo} driver(s) have no Accountable Value Owner.
      </p>
    </section>

    <section>
      <h2>6. Authorisation</h2>
      <dl class="rpt-kv" data-testid="rq-authorisation">
        <dt>Version</dt>
        <dd>V${a.versionNumber} · ${a.title}</dd>
        <dt>Status</dt>
        <dd>${status}</dd>
        <dt>Value Case Owner</dt>
        <dd>${a.authorisedBy ?? "—"}</dd>
        <dt>Authorisation date</dt>
        <dd>${formatDate(a.authorisedOn)}</dd>
        <dt>Authorisation evidence</dt>
        <dd>${a.evidence ? `${a.evidence.code} ${a.evidence.title}` : "—"}</dd>
        ${
          a.note
            ? html`<dt>Note</dt>
                <dd class="rpt-text">${a.note}</dd>`
            : null
        }
        <dt>Authorised Value</dt>
        <dd>${authorised ? $.plain(a.total) : "Not authorised"}</dd>
      </dl>
    </section>
    ${reportEnd(meta)}
  `;
}
