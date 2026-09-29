import { notFound } from "next/navigation";

import { issueReportAction } from "@/server/actions/reports";
import { buildReport, listSubjectIssues } from "@/server/queries/reports";
import { ActionForm, SubmitButton } from "@/ui/components/action-form";
import { Checkbox, Hidden } from "@/ui/components/fields";
import { Notice, TextLink } from "@/ui/components/layout";
import { formatDateTime } from "@/ui/format";
import { renderReportArticle } from "@/ui/reports/render";
import { issuedReportHref, reportTypeForSlug } from "@/ui/reports/routes";
import { isUuid, requireProject } from "@/ui/require";

export const metadata = { title: "Report preview" };

export default async function ReportPreviewPage({
  params,
}: PageProps<"/projects/[projectId]/reports/[kind]/[subjectId]">) {
  const { projectId, kind, subjectId } = await params;
  await requireProject(projectId);
  const type = reportTypeForSlug(kind);
  if (!type || !isUuid(subjectId)) notFound();
  const built = await buildReport(type, projectId, subjectId);
  if (!built) notFound();
  const issues = await listSubjectIssues(type, subjectId);
  const { model, issuable } = built;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4 print:hidden">
        <div>
          <p className="text-sm">
            <TextLink href={`/projects/${projectId}/reports`}>← Reports</TextLink>
          </p>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">
            {model.header.title} <span className="font-normal text-slate-500">· {model.header.subjectLabel}</span>
          </h1>
          <p className="text-sm text-slate-600">Draft preview, generated now from the Value Record — not issued.</p>
          {issues.length > 0 && (
            <p className="mt-1 text-sm text-slate-600" data-testid="previous-issues">
              Issued:{" "}
              {issues.map((i, n) => (
                <span key={i.id}>
                  {n > 0 && ", "}
                  <TextLink href={issuedReportHref(projectId, i.id)}>
                    Issue {i.issueNumber} ({formatDateTime(i.issuedAt)})
                  </TextLink>
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="w-full max-w-md">
          {issuable.ok ? (
            <ActionForm
              action={issueReportAction}
              confirm={`Issue ${model.header.title} (${model.header.subjectLabel}) as issue ${issues.length + 1}? The issued report and its PDF cannot be changed afterwards.`}
              className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
              testId="issue-report-form"
            >
              <Hidden name="projectId" value={projectId} />
              <Hidden name="type" value={type} />
              <Hidden name="subjectId" value={subjectId} />
              <Checkbox
                name="confirm"
                label="I have reviewed this report and it is ready to issue to the client"
                hint="Issuing stores a fixed snapshot and PDF. Later changes to the Value Record need a new issue."
              />
              <div className="mt-2">
                <SubmitButton>Issue report</SubmitButton>
              </div>
            </ActionForm>
          ) : (
            <Notice tone="locked" title="Cannot be issued yet">
              {issuable.reason}
            </Notice>
          )}
        </div>
      </div>
      <div
        className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm print:border-0 print:p-0 print:shadow-none"
        data-testid="report-preview"
        dangerouslySetInnerHTML={{ __html: renderReportArticle(model, { state: "preview" }) }}
      />
    </>
  );
}
