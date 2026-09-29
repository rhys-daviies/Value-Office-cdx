import type { InformationRequestReport } from "@/domain/reports";
import { formatDate } from "@/ui/format";
import { IR_ITEM_STATUS_LABELS, IR_STATUS_LABELS } from "@/ui/labels";

import { figure, reportEnd, reportHeader, type ReportIssueMeta } from "./common";
import { html, type SafeHtml } from "./html";

export function renderInformationRequest(m: InformationRequestReport, meta: ReportIssueMeta): SafeHtml {
  const { request, summary } = m;
  return html`
    ${reportHeader(m.header, meta, {
      asAtLabel: "Request issued",
      status: IR_STATUS_LABELS[request.status as keyof typeof IR_STATUS_LABELS] ?? request.status,
    })}
    <section>
      <h2>${request.title}</h2>
      <p>
        Reference ${request.reference}. This request sets out the information Cardaxia needs from ${m.header.clientName}
        to establish and re-qualify the Value Case for ${m.header.projectName}. Each item supports the evidence behind a
        Value Driver, its assumptions or its financial value.
      </p>
      <p class="rpt-muted rpt-small">
        Please provide each item to the named contact by the due date. Where information is not available, please say
        so, so that the Value Case can record the gap rather than assume a value.
      </p>
    </section>
    <section>
      <h2>Request summary</h2>
      <div class="rpt-headline" data-testid="ir-summary">
        ${figure("Items", String(summary.total))} ${figure("Open", String(summary.open))}
        ${figure("Partial", String(summary.partially_received))} ${figure("Received", String(summary.received))}
        ${figure("Not available", String(summary.not_available))}
      </div>
    </section>
    <section>
      <h2>Information requested</h2>
      ${
        m.items.length === 0
          ? html`<p class="rpt-muted"><em>No items recorded.</em></p>`
          : html`<table data-testid="ir-items">
              <thead>
                <tr>
                  <th style="width:6%">#</th>
                  <th>Information requested</th>
                  <th style="width:16%">Requested from</th>
                  <th style="width:12%">Due</th>
                  <th style="width:18%">Value Driver</th>
                  <th style="width:11%">Status</th>
                </tr>
              </thead>
              <tbody>
                ${m.items.map(
                  (i) =>
                    html`<tr>
                      <td>${i.sequence}</td>
                      <td>
                        ${i.description}
                        ${i.notes ? html`<div class="rpt-muted rpt-small rpt-text">${i.notes}</div>` : null}
                      </td>
                      <td>${i.requestedFrom ?? "—"}</td>
                      <td>${formatDate(i.dueOn)}</td>
                      <td>${i.driver ? `${i.driver.code} ${i.driver.name}` : "General"}</td>
                      <td>${IR_ITEM_STATUS_LABELS[i.status]}</td>
                    </tr>`,
                )}
              </tbody>
            </table>`
      }
    </section>
    ${reportEnd(meta)}
  `;
}
