import { getReportIssue } from "@/server/queries/reports";
import { getDocument } from "@/server/reports/storage";
import { isUuid } from "@/ui/require";

/** Streams an issued report's stored PDF, verified against the hash recorded at issue. */
export async function GET(_req: Request, ctx: RouteContext<"/projects/[projectId]/reports/issued/[issueId]/pdf">) {
  const { projectId, issueId } = await ctx.params;
  if (!isUuid(projectId) || !isUuid(issueId)) return new Response("Not found", { status: 404 });
  const issue = await getReportIssue(projectId, issueId);
  if (!issue) return new Response("Not found", { status: 404 });
  const bytes = await getDocument(issue.documentKey, issue.documentSha256);
  if (!bytes) {
    return new Response(
      "The PDF for this issue is not available in this environment's document store. The issued snapshot is preserved and can be viewed in the application.",
      { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
  const filename = `${issue.title.replace(/[^A-Za-z0-9 ._-]+/g, "").replace(/\s+/g, "-")}-issue-${issue.issueNumber}.pdf`;
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}"`,
      "x-content-sha256": issue.documentSha256,
      "cache-control": "private, no-store",
    },
  });
}
