import Link from "next/link";

import { REPORT_TITLES } from "@/domain/reports";
import type { ReportType } from "@/domain/statuses";
import { listAvailableReports, listReportIssues, subjectIdOf } from "@/server/queries/reports";
import { PlainBadge } from "@/ui/components/badges";
import { Empty, Section, Table, TextLink } from "@/ui/components/layout";
import { formatDateTime } from "@/ui/format";
import { issuedReportHref, reportPreviewHref } from "@/ui/reports/routes";
import { requireProject } from "@/ui/require";

export const metadata = { title: "Reports" };

const ORDER: ReportType[] = ["information_request", "requalification", "assurance", "value_change_notice"];

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  issued: "Issued",
  closed: "Closed",
  proposed: "Proposed",
  authorised: "Authorised",
  superseded: "Authorised (superseded)",
  finalised: "Finalised",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export default async function ReportsPage({ params }: PageProps<"/projects/[projectId]/reports">) {
  const { projectId } = await params;
  await requireProject(projectId);
  const [available, issued] = await Promise.all([listAvailableReports(projectId), listReportIssues(projectId)]);
  const labelFor = new Map(available.map((a) => [a.subjectId, a.subjectLabel]));

  return (
    <>
      <p className="mb-4 max-w-3xl text-sm text-slate-600">
        Client outputs generated from the governed Value Record. Preview a report, review it, then issue it: issuing
        stores a fixed snapshot and PDF that never change, even if the Value Record changes later. A later issue is a
        new record.
      </p>

      <Section title="Available reports">
        {available.length === 0 ? (
          <Empty>No report subjects yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Report</th>
                <th>Subject</th>
                <th>Subject status</th>
                <th>Issue</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ORDER.flatMap((type) =>
                available
                  .filter((a) => a.type === type)
                  .map((a) => (
                    <tr key={`${a.type}-${a.subjectId}`} data-testid="available-report">
                      <td className="font-medium">{REPORT_TITLES[a.type]}</td>
                      <td>{a.subjectLabel}</td>
                      <td>{STATUS_LABEL[a.subjectStatus] ?? a.subjectStatus}</td>
                      <td>
                        {a.issuable.ok ? (
                          <PlainBadge tone="emerald">Can be issued</PlainBadge>
                        ) : (
                          <span className="text-xs text-slate-500">{a.issuable.reason}</span>
                        )}
                      </td>
                      <td className="text-right">
                        <TextLink href={reportPreviewHref(projectId, a.type, a.subjectId)}>Preview</TextLink>
                      </td>
                    </tr>
                  )),
              )}
            </tbody>
          </Table>
        )}
      </Section>

      <Section title={`Issued reports (${issued.length})`}>
        {issued.length === 0 ? (
          <Empty>No reports issued yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Report</th>
                <th>Subject</th>
                <th>Issue</th>
                <th>Subject status at issue</th>
                <th>Issued</th>
                <th>Issued by</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {issued.map((r) => (
                <tr key={r.id} data-testid="issued-report">
                  <td className="font-medium">{REPORT_TITLES[r.type]}</td>
                  <td>{labelFor.get(subjectIdOf(r)) ?? r.title}</td>
                  <td>Issue {r.issueNumber}</td>
                  <td>{STATUS_LABEL[r.subjectStatus] ?? r.subjectStatus}</td>
                  <td className="whitespace-nowrap">{formatDateTime(r.issuedAt)}</td>
                  <td>{r.issuedByName}</td>
                  <td className="text-right whitespace-nowrap">
                    <TextLink href={issuedReportHref(projectId, r.id)}>View</TextLink>
                    {" · "}
                    <Link
                      href={`${issuedReportHref(projectId, r.id)}/pdf`}
                      prefetch={false}
                      className="text-sky-800 underline decoration-sky-300 underline-offset-2"
                    >
                      PDF
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </>
  );
}
