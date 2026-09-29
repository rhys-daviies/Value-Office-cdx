import type { ReportType } from "@/domain/statuses";

// URL slugs for report routes: /projects/[projectId]/reports/[slug]/[subjectId]

export const REPORT_SLUGS: Record<ReportType, string> = {
  information_request: "information-request",
  requalification: "requalification",
  assurance: "assurance",
  value_change_notice: "value-change",
};

export function reportTypeForSlug(slug: string): ReportType | null {
  return (Object.entries(REPORT_SLUGS).find(([, s]) => s === slug)?.[0] as ReportType | undefined) ?? null;
}

export const reportPreviewHref = (projectId: string, type: ReportType, subjectId: string) =>
  `/projects/${projectId}/reports/${REPORT_SLUGS[type]}/${subjectId}`;

export const issuedReportHref = (projectId: string, issueId: string) =>
  `/projects/${projectId}/reports/issued/${issueId}`;
