import type { ReportModel } from "@/domain/reports";

import type { ReportIssueMeta } from "./common";
import { html, trusted, type SafeHtml } from "./html";
import { renderAssurance } from "./assurance";
import { renderAssuranceV3 } from "./assurance-v3";
import { renderInformationRequest } from "./information-request";
import { renderRequalification } from "./requalification";
import { REPORT_CSS } from "./styles";
import { renderValueChangeNotice } from "./value-change";

export { RENDERER_VERSION, type ReportIssueMeta } from "./common";

function body(model: ReportModel, meta: ReportIssueMeta): SafeHtml {
  switch (model.header.type) {
    case "information_request":
      return renderInformationRequest(model as Parameters<typeof renderInformationRequest>[0], meta);
    case "requalification":
      return renderRequalification(model as Parameters<typeof renderRequalification>[0], meta);
    case "assurance":
      // Model v3 (Phase 4D.9J) has its own layout; v1/v2 snapshots render exactly as issued.
      return model.header.modelVersion >= 3
        ? renderAssuranceV3(model as Parameters<typeof renderAssuranceV3>[0], meta)
        : renderAssurance(model as Parameters<typeof renderAssurance>[0], meta);
    case "value_change_notice":
      return renderValueChangeNotice(model as Parameters<typeof renderValueChangeNotice>[0], meta);
  }
}

/** The report article (stylesheet included) for embedding in an application page. */
export function renderReportArticle(model: ReportModel, meta: ReportIssueMeta): string {
  return html`<style>
      ${trusted(REPORT_CSS)}
    </style>
    <article class="vo-report" data-report-type="${model.header.type}">${body(model, meta)}</article>`.value;
}

/** A complete standalone HTML document, as printed to PDF. */
export function renderReportDocument(model: ReportModel, meta: ReportIssueMeta): string {
  const h = model.header;
  return `<!doctype html>${
    html`<html lang="en-GB">
      <head>
        <meta charset="utf-8" />
        <title>${h.title} — ${h.projectName} — ${h.subjectLabel}</title>
        <style>
          @page { size: A4; }
          html, body { margin: 0; padding: 0; background: #fff; }
          ${trusted(REPORT_CSS)}
        </style>
      </head>
      <body>
        <article class="vo-report" data-report-type="${h.type}">${body(model, meta)}</article>
      </body>
    </html>`.value
  }`;
}
