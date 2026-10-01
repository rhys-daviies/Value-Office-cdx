import type { ReportHeader } from "@/domain/reports";
import type { EvidenceStatus, QualificationStatus } from "@/domain/statuses";
import {
  formatDate,
  formatMoneyChange,
  formatMoneyPlain,
  formatMoneyPlainChange,
  formatMoneyShort,
  formatPeriod,
} from "@/ui/format";
import { EVIDENCE_STATUS_LABELS, QUALIFICATION_LABELS } from "@/ui/labels";

import { html, type SafeHtml } from "./html";

/**
 * Bump when the rendered layout changes; recorded on every issue.
 * report-html-1 — Phase 4A. report-html-2 — Phase 4D.7: Assurance model v2 adds the Value Case Evolution
 * and Alternative Value Outcomes sections (server-side SVG). v1 snapshots still render the v1 layout.
 */
export const RENDERER_VERSION = "report-html-2";

/** Preview (draft, not issued) or an issued report's issue details. */
export type ReportIssueMeta =
  { state: "preview" } | { state: "issued"; issueNumber: number; issuedOn: string; issuedBy: string };

export type Money = (value: string | null | undefined) => string;

/** Currency-bound formatters: headline ($15.5m), table ($15,500,000) and signed change. */
export function moneyFormatters(currency: string) {
  return {
    short: ((v) => formatMoneyShort(v, currency)) as Money,
    plain: ((v) => formatMoneyPlain(v, currency)) as Money,
    change: ((v) => formatMoneyPlainChange(v, currency)) as Money,
    shortChange: ((v) => formatMoneyChange(v, currency)) as Money,
  };
}

export function reportHeader(
  h: ReportHeader,
  meta: ReportIssueMeta,
  opts: { asAtLabel: string; status: string },
): SafeHtml {
  const basis = h.valueBasis.description
    ? `${h.valueBasis.description}${
        h.valueBasis.periodStart || h.valueBasis.periodEnd
          ? ` (${formatPeriod(h.valueBasis.periodStart, h.valueBasis.periodEnd)})`
          : ""
      }`
    : "Not defined";
  return html`
    ${
      meta.state === "preview"
        ? html`<div class="rpt-banner" data-testid="report-draft-banner">
            Draft preview — not issued. Figures reflect the Value Record now and may change before issue.
          </div>`
        : null
    }
    <header class="rpt-head">
      <div class="rpt-brand">
        <span><b>Cardaxia</b> · Value Office</span>
        <span data-testid="report-issue-line"
          >${
            meta.state === "issued" ? `Issue ${meta.issueNumber} · ${formatDate(meta.issuedOn)}` : "Draft preview"
          }</span
        >
      </div>
      <h1>${h.title}</h1>
      <p class="rpt-subject">${h.subjectLabel}</p>
      <dl class="rpt-meta">
        <div>
          <dt>Client</dt>
          <dd>${h.clientName}</dd>
        </div>
        <div>
          <dt>Project</dt>
          <dd>${h.projectName}</dd>
        </div>
        <div>
          <dt>Report date</dt>
          <dd>${meta.state === "issued" ? formatDate(meta.issuedOn) : "Not issued"}</dd>
        </div>
        <div>
          <dt>${opts.asAtLabel}</dt>
          <dd>${formatDate(h.asAt)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd data-testid="report-status">${opts.status}</dd>
        </div>
        <div>
          <dt>Value Basis</dt>
          <dd>${basis} · ${h.currency}</dd>
        </div>
      </dl>
    </header>
  `;
}

export function reportEnd(meta: ReportIssueMeta): SafeHtml {
  return html`<p class="rpt-end">
    Prepared by Cardaxia from the governed Value Record.
    ${
      meta.state === "issued"
        ? `Issued by ${meta.issuedBy} on ${formatDate(meta.issuedOn)} (issue ${meta.issueNumber}). This issue is a fixed record; later changes to the Value Record appear only in a later issue.`
        : "Draft preview — not an issued report."
    }
  </p>`;
}

export function figure(
  label: string,
  value: string,
  opts: { note?: string | null; tone?: "gap" | "leak" | "info" | "warn"; testId?: string } = {},
): SafeHtml {
  return html`<div class="rpt-figure${opts.tone ? ` is-${opts.tone}` : ""}" data-testid="${opts.testId ?? ""}">
    <div class="k">${label}</div>
    <div class="v">${value}</div>
    ${opts.note ? html`<div class="n">${opts.note}</div>` : null}
  </div>`;
}

/** Recorded narrative, or a clear statement that none is recorded. */
export function text(value: string | null | undefined, missing = "Not recorded."): SafeHtml {
  return value?.trim() ? html`<p class="rpt-text">${value}</p>` : html`<p class="rpt-muted"><em>${missing}</em></p>`;
}

const QUAL_TONE: Record<QualificationStatus, string> = {
  qualified: "good",
  partially_qualified: "part",
  unqualified: "none",
};
const EVID_TONE: Record<EvidenceStatus, string> = {
  evidenced: "good",
  partially_evidenced: "part",
  unevidenced: "none",
};

export const qualificationTag = (s: QualificationStatus) =>
  html`<span class="tag ${QUAL_TONE[s]}">${QUALIFICATION_LABELS[s]}</span>`;
export const evidenceTag = (s: EvidenceStatus) =>
  html`<span class="tag ${EVID_TONE[s]}">${EVIDENCE_STATUS_LABELS[s]}</span>`;

export function evidenceList(items: readonly { code: string; title: string }[]): SafeHtml {
  return items.length
    ? html`${items.map((e, i) => html`${i ? "; " : ""}${e.code} ${e.title}`)}`
    : html`<span class="rpt-muted">None linked</span>`;
}
