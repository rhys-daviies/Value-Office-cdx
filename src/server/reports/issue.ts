import "server-only";

import { eq } from "drizzle-orm";

import { DomainError } from "@/domain/errors";
import type { ReportType } from "@/domain/statuses";
import { issueReport as issueReportCommand } from "@/server/commands/reports";
import type { Actor } from "@/server/commands/run";
import { db, schema } from "@/server/db/client";
import { buildReport, nextIssueNumber, snapshotSha256 } from "@/server/queries/reports";
import { RENDERER_VERSION, renderReportDocument, type ReportIssueMeta } from "@/ui/reports/render";

import { htmlToPdf, PdfUnavailableError } from "./pdf";
import { putDocument } from "./storage";

/**
 * Issue a report: snapshot the Value Record → render the issued document → PDF →
 * store the artefact → record the immutable issue (command `reports.issue`).
 * The artefact is content-addressed, so a refused issue leaves at most an
 * unreferenced file behind, never a half-recorded issue.
 */
export async function issueReport(actor: Actor, input: { type: ReportType; projectId: string; subjectId: string }) {
  const built = await buildReport(input.type, input.projectId, input.subjectId);
  if (!built) throw new DomainError("VO_NOT_FOUND", "The report subject was not found in this project");
  if (!built.issuable.ok) throw new DomainError("VO_REPORT_SUBJECT_INVALID", built.issuable.reason!);

  const [user] = await db()
    .select({ name: schema.appUser.displayName })
    .from(schema.appUser)
    .where(eq(schema.appUser.id, actor.userId));
  const meta: Extract<ReportIssueMeta, { state: "issued" }> = {
    state: "issued",
    issueNumber: await nextIssueNumber(input.type, input.subjectId),
    issuedOn: new Date().toISOString().slice(0, 10),
    issuedBy: user?.name ?? "Cardaxia",
  };

  const h = built.model.header;
  const pdf = await htmlToPdf(
    renderReportDocument(built.model, meta),
    `${h.title} · ${h.projectName} · ${h.subjectLabel} · Issue ${meta.issueNumber}`,
  ).catch((err) => {
    throw err instanceof PdfUnavailableError ? new DomainError("VO_PDF_UNAVAILABLE", err.message) : err;
  });
  const document = await putDocument(pdf);

  return issueReportCommand(actor, {
    ...input,
    expectedSnapshotSha256: snapshotSha256(built.model),
    issueNumber: meta.issueNumber,
    issuedOn: meta.issuedOn,
    issuedByName: meta.issuedBy,
    rendererVersion: RENDERER_VERSION,
    document,
  });
}

/** Issue details as printed on a stored issue. */
export function issueMetaOf(row: { issueNumber: number; issuedAt: Date; issuedByName: string }): ReportIssueMeta {
  return {
    state: "issued",
    issueNumber: row.issueNumber,
    issuedOn: row.issuedAt.toISOString().slice(0, 10),
    issuedBy: row.issuedByName,
  };
}
