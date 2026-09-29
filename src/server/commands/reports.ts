import { z } from "zod";

import { DomainError } from "@/domain/errors";
import { REPORT_TYPES } from "@/domain/statuses";
import { schema } from "@/server/db/client";
import { buildReport, SUBJECT_COLUMN, snapshotSha256 } from "@/server/queries/reports";

import { COMMANDS } from "./names";
import { defineCommand } from "./run";
import { isoDate, nonBlank, uuid } from "./schemas";

const sha = z.string().regex(/^[0-9a-f]{64}$/, "sha256 hex digest");

/**
 * Record an issued report. The snapshot is rebuilt here from the Value Record and must
 * match the one the PDF was rendered from (`expectedSnapshotSha256`); otherwise the
 * record changed during generation and the issue is refused as stale. The database
 * guard checks the subject's state, the issue number and immutability.
 */
export const issueReport = defineCommand(
  COMMANDS.issueReport,
  z.object({
    type: z.enum(REPORT_TYPES),
    projectId: uuid,
    subjectId: uuid,
    expectedSnapshotSha256: sha,
    issueNumber: z.number().int().min(1),
    issuedOn: isoDate,
    issuedByName: nonBlank,
    rendererVersion: nonBlank,
    document: z.object({
      key: z.string().regex(/^reports\/[0-9a-f]{64}\.pdf$/),
      sha256: sha,
      bytes: z.number().int().positive(),
    }),
  }),
  async ({ tx, actor }, input) => {
    const built = await buildReport(input.type, input.projectId, input.subjectId);
    if (!built) throw new DomainError("VO_NOT_FOUND", "The report subject was not found in this project");
    if (!built.issuable.ok) throw new DomainError("VO_REPORT_SUBJECT_INVALID", built.issuable.reason!);
    const hash = snapshotSha256(built.model);
    if (hash !== input.expectedSnapshotSha256) {
      throw new DomainError(
        "VO_REPORT_STALE",
        "The Value Record changed while the report was being generated. Review the preview again and reissue.",
      );
    }
    if (input.issuedOn !== new Date().toISOString().slice(0, 10)) {
      throw new DomainError("VO_REPORT_STALE", "The issue date is not today. Review the preview again and reissue.");
    }

    const [row] = await tx
      .insert(schema.reportIssue)
      .values({
        projectId: input.projectId,
        type: input.type,
        [SUBJECT_COLUMN[input.type]]: input.subjectId,
        subjectStatus: built.model.header.subjectStatus,
        issueNumber: input.issueNumber,
        title: `${built.model.header.title} — ${built.model.header.subjectLabel}`,
        snapshot: built.model,
        snapshotSha256: hash,
        rendererVersion: input.rendererVersion,
        documentKey: input.document.key,
        documentSha256: input.document.sha256,
        documentBytes: input.document.bytes,
        issuedBy: actor.userId,
        issuedByName: input.issuedByName,
      })
      .returning();
    return row!;
  },
);
