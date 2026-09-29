import { notFound } from "next/navigation";

import type { ReportModel } from "@/domain/reports";
import { getReportIssue } from "@/server/queries/reports";
import { issueMetaOf } from "@/server/reports/issue";
import { ButtonLink, KeyValues, Notice, TextLink } from "@/ui/components/layout";
import { formatDateTime } from "@/ui/format";
import { renderReportArticle } from "@/ui/reports/render";
import { isUuid, requireProject } from "@/ui/require";

export const metadata = { title: "Issued report" };

export default async function IssuedReportPage({
  params,
}: PageProps<"/projects/[projectId]/reports/issued/[issueId]">) {
  const { projectId, issueId } = await params;
  await requireProject(projectId);
  if (!isUuid(issueId)) notFound();
  const issue = await getReportIssue(projectId, issueId);
  if (!issue) notFound();

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4 print:hidden">
        <div>
          <p className="text-sm">
            <TextLink href={`/projects/${projectId}/reports`}>← Reports</TextLink>
          </p>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">
            {issue.title} <span className="font-normal text-slate-500">· Issue {issue.issueNumber}</span>
          </h1>
          <div className="mt-2" data-testid="issue-record">
            <KeyValues
              items={[
                ["Issued", `${formatDateTime(issue.issuedAt)} by ${issue.issuedByName}`],
                ["Subject status at issue", issue.subjectStatus],
                [
                  "Snapshot SHA-256",
                  <code key="s" className="text-xs break-all">
                    {issue.snapshotSha256}
                  </code>,
                ],
                [
                  "PDF SHA-256",
                  <code key="d" className="text-xs break-all">
                    {issue.documentSha256}
                  </code>,
                ],
              ]}
            />
          </div>
        </div>
        <ButtonLink href={`/projects/${projectId}/reports/issued/${issue.id}/pdf`}>Download PDF</ButtonLink>
      </div>
      <Notice tone="locked" title="Issued report — fixed record">
        This is the snapshot stored when the report was issued. It does not change if the Value Record changes; a later
        issue is a separate record.
      </Notice>
      <div
        className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm print:border-0 print:p-0 print:shadow-none"
        data-testid="issued-report-view"
        dangerouslySetInnerHTML={{ __html: renderReportArticle(issue.snapshot as ReportModel, issueMetaOf(issue)) }}
      />
    </>
  );
}
