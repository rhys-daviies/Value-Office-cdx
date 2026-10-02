import type { ValueChangeNotice } from "@/domain/reports";
import { formatDate, formatMoneyAdaptiveChange } from "@/ui/format";

import { figure, moneyFormatters, reportEnd, reportHeader, text, type ReportIssueMeta } from "./common";
import { html, type SafeHtml } from "./html";
import { plansBlock, TRAJECTORY_CSS } from "./trajectory-sections";
import { TRAJECTORY_SERIES } from "@/ui/trajectory/series";

const STATUS = {
  draft: "Draft — in preparation",
  proposed: "Proposed — awaiting VCO authorisation",
  authorised: "Authorised",
  rejected: "Rejected by the VCO",
  withdrawn: "Withdrawn",
} as const;

export function renderValueChangeNotice(m: ValueChangeNotice, meta: ReportIssueMeta): SafeHtml {
  const $ = moneyFormatters(m.header.currency);
  const c = m.change;
  const authorised = c.status === "authorised";
  const notReconciled = m.reconciled === false;
  // Model v3 (Phase 4D.9J): plans before/after, provisional wording and adaptive precision for change amounts —
  // spliced in without whitespace so v1/v2 snapshots render byte-for-byte as issued.
  const v3 = m.header.modelVersion >= 3 && m.plans !== undefined;
  const adaptive = (v: string | null) => formatMoneyAdaptiveChange(v, m.header.currency);
  const plansSection = () =>
    v3
      ? html`${plansBlock(
            [
              {
                plan: m.plans!.from,
                label: `V${m.plans!.from.versionNumber} (${authorised ? "before" : "in force"})`,
                color: "#64748b",
                dash: "4 3",
              },
              {
                plan: m.plans!.to,
                label: `V${m.plans!.to.versionNumber} (${authorised ? "authorised" : `${c.status} — not in force`})`,
                color: TRAJECTORY_SERIES.plan.color,
              },
            ],
            $,
            { testId: "vc-plans", title: `Authorised Plan ${authorised ? "before and after" : "now and as proposed"}` },
          )}
          <p class="rpt-small" data-testid="vc-change-precision">
            ${
              m.reconciled === false
                ? `Stated change ${adaptive(c.statedChange)} · ${authorised ? "version" : "current draft"} movement ${adaptive(m.actualChange)} · does not reconcile${authorised ? "" : " — not in force"}.`
                : `${authorised ? "Authorised" : "Proposed"} change ${adaptive(m.actualChange)}${authorised ? "" : " — not in force"}.`
            }
          </p>`
      : null;

  // v1/v2 layout is byte-exact (golden-tested); v3 sections are spliced in without whitespace. Never reformat.
  // prettier-ignore
  return html`
    ${reportHeader(m.header, meta, {
      asAtLabel: authorised ? "Authorised on" : "Proposed on",
      status: STATUS[c.status],
    })}${v3 ? TRAJECTORY_CSS : null}

    <div data-testid="vc-stamps">
      <span class="stamp ${authorised ? "good" : "neutral"}"
        >${authorised ? "Authorised" : c.status === "proposed" ? "Proposed" : STATUS[c.status]}</span
      >
      ${notReconciled ? html`<span class="stamp">Not reconciled</span>` : null}
      ${
        c.status === "proposed" && !m.readyForAuthorisation
          ? html`<span class="stamp">Not ready for authorisation</span>`
          : null
      }
    </div>
    ${
      c.status === "proposed" && !m.readyForAuthorisation
        ? html`<div class="callout bad" data-testid="vc-not-ready">
            <strong>Not ready for authorisation</strong>
            The stated change of ${$.plain(c.statedChange)} does not match the change at Value Driver level
            (${$.plain(m.actualChange)}). The Value Change cannot be authorised until the proposed Value Drivers
            reconcile to the stated change. The Authorised Value remains ${$.plain(m.current.total)}.
          </div>`
        : null
    }

    <section>
      <h2>1. Current authorised position</h2>
      <div class="rpt-headline">
        ${figure(authorised ? "Previous authorised value" : "Current authorised value", $.short(m.current.total), {
          testId: "vc-current",
          note: `Value Case V${m.current.versionNumber}${authorised ? " (superseded, preserved)" : ""}`,
        })}
        ${figure("Stated change", v3 ? adaptive(c.statedChange) : $.shortChange(c.statedChange), { testId: "vc-stated", tone: "gap" })}
        ${figure(
          authorised ? "New authorised value" : "Proposed authorised value",
          $.short(authorised ? m.proposed.total : (m.projectedFromStated ?? m.proposed.total)),
          {
            testId: "vc-proposed",
            tone: authorised ? undefined : "info",
            note: authorised ? `Value Case V${m.proposed.versionNumber}` : "If authorised",
          },
        )}
      </div>
      <p>
        ${
          authorised
            ? `Value Case V${m.current.versionNumber} (${m.current.title}) was the Authorised Value Case before this change. It is preserved unchanged as a historical record.`
            : `The Authorised Value Case in force is V${m.current.versionNumber} (${m.current.title}). It is unchanged unless and until the Value Case Owner authorises this change.`
        }
      </p>
    </section>

    <section>
      <h2>2. ${authorised ? "Change" : "Proposed change"}</h2>
      <dl class="rpt-kv">
        <dt>Value Change</dt>
        <dd>${c.code}</dd>
        <dt>Stated change</dt>
        <dd>${c.statedChange === null ? "No stated change recorded" : $.plain(c.statedChange)}</dd>
        ${
          authorised
            ? html`<dt>New authorised value</dt>
                <dd>${$.plain(m.proposed.total)} (Value Case V${m.proposed.versionNumber})</dd>`
            : html`<dt>Proposed authorised value</dt>
                <dd>
                  ${
                    m.projectedFromStated === null
                      ? $.plain(m.proposed.total)
                      : `${$.plain(m.projectedFromStated)} (current authorised value + stated change)`
                  }
                </dd>
                <dt>Proposed version V${m.proposed.versionNumber}</dt>
                <dd>Value Driver total ${$.plain(m.proposed.total)}</dd>`
        }
        <dt>Proposed on</dt>
        <dd>${formatDate(c.proposedOn)}</dd>
      </dl>
      <h3>Reason</h3>
      ${text(c.reason)}
      <h3>Economic impact</h3>
      ${text(c.economicImpactNarrative)}
    </section>

    <section>
      <h2>3. Affected Value Drivers</h2>
      ${
        m.changedDrivers.length === 0
          ? html`<p class="rpt-muted" data-testid="vc-no-driver-changes">
              <em>No Value Driver has been changed in the proposed version.</em>
            </p>`
          : html`<table data-testid="vc-drivers">
              <thead>
                <tr>
                  <th>Value Driver</th>
                  <th class="num">Before (V${m.current.versionNumber})</th>
                  <th class="num">${authorised ? "Authorised" : "Proposed"} (V${m.proposed.versionNumber})</th>
                  <th class="num">Change</th>
                </tr>
              </thead>
              <tbody>
                ${m.changedDrivers.map(
                  (d) =>
                    html`<tr>
                      <td>
                        ${d.code}
                        ${d.name}${d.added ? html` <span class="tag info">Added</span>` : null}${
                          d.removed ? html` <span class="tag none">Removed</span>` : null
                        }
                      </td>
                      <td class="num">
                        ${d.added ? "—" : d.fromValue === null ? "Non-financial" : $.plain(d.fromValue)}
                      </td>
                      <td class="num">
                        ${d.removed ? "—" : d.toValue === null ? "Non-financial" : $.plain(d.toValue)}
                      </td>
                      <td class="num">${$.change(d.change)}</td>
                    </tr>`,
                )}
              </tbody>
            </table>`
      }
      <p class="rpt-small rpt-muted">${m.unchangedDriverCount} Value Driver(s) unchanged and not listed.</p>${plansSection()}
    </section>

    <section>
      <h2>4. Origin</h2>
      ${
        m.origin.review || m.origin.recommendation || m.origin.decision
          ? html`<dl class="rpt-kv" data-testid="vc-origin">
              ${
                m.origin.review
                  ? html`<dt>Assurance Review</dt>
                      <dd>Review ${m.origin.review.sequence} (${formatDate(m.origin.review.reviewDate)})</dd>`
                  : null
              }
              ${
                m.origin.recommendation
                  ? html`<dt>Cardaxia recommendation</dt>
                      <dd>${m.origin.recommendation.label} · ${$.short(m.origin.recommendation.totalValue)}</dd>`
                  : null
              }
              ${
                m.origin.decision
                  ? html`<dt>Client decision</dt>
                      <dd>
                        ${m.origin.decision.label} · ${$.short(m.origin.decision.totalValue)} —
                        ${m.origin.decision.decidedBy}, ${formatDate(m.origin.decision.decidedOn)}
                      </dd>
                      <dt>Client-elected difference</dt>
                      <dd>${$.shortChange(m.origin.decision.clientElectedDifference)} vs Cardaxia recommendation</dd>`
                  : null
              }
            </dl>`
          : html`<p class="rpt-muted"><em>No originating review or decision is recorded.</em></p>`
      }
    </section>

    <section>
      <h2>5. Reconciliation</h2>
      <table data-testid="vc-reconciliation">
        <tbody>
          <tr>
            <td>Stated change</td>
            <td class="num">${c.statedChange === null ? "Not stated" : $.plain(c.statedChange)}</td>
          </tr>
          <tr>
            <td>
              Change at Value Driver level (V${m.proposed.versionNumber} total − V${m.current.versionNumber} total)
            </td>
            <td class="num">${$.plain(m.actualChange)}</td>
          </tr>
          <tr>
            <td><strong>Result</strong></td>
            <td class="num" data-testid="vc-reconciled">
              <strong
                >${
                  m.reconciled === null
                    ? "No stated change to reconcile"
                    : m.reconciled
                      ? "Reconciled"
                      : "NOT RECONCILED"
                }</strong
              >
            </td>
          </tr>
        </tbody>
      </table>
      ${
        c.status === "proposed"
          ? html`<p data-testid="vc-readiness">
              ${
                m.readyForAuthorisation
                  ? "Ready for VCO authorisation."
                  : html`<strong>NOT READY FOR AUTHORISATION.</strong> The Value Driver allocation of the stated change
                      has not been established.`
              }
            </p>`
          : null
      }
    </section>

    <section>
      <h2>6. Authorisation</h2>
      ${
        m.authorisation
          ? html`<dl class="rpt-kv" data-testid="vc-authorisation">
              <dt>Value Case Owner</dt>
              <dd>${m.authorisation.authorisedBy ?? m.authorisation.vco ?? "—"}</dd>
              <dt>Authorisation date</dt>
              <dd>${formatDate(m.authorisation.authorisedOn)}</dd>
              <dt>Authorisation evidence</dt>
              <dd>
                ${m.authorisation.evidence ? `${m.authorisation.evidence.code} ${m.authorisation.evidence.title}` : "—"}
              </dd>
              ${
                m.authorisation.note
                  ? html`<dt>Note</dt>
                      <dd class="rpt-text">${m.authorisation.note}</dd>`
                  : null
              }
              <dt>Previous version</dt>
              <dd>V${m.current.versionNumber} · ${$.plain(m.current.total)} — superseded and preserved unchanged</dd>
              <dt>New authorised version</dt>
              <dd>V${m.proposed.versionNumber} · ${$.plain(m.proposed.total)}</dd>
            </dl>`
          : html`<p class="rpt-muted">
              <em>Not authorised. Authorisation requires the Value Case Owner's decision, supported by evidence.</em>
            </p>`
      }
    </section>
    ${reportEnd(meta)}
  `;
}
