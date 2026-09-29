import { z } from "zod";

import { schema } from "@/server/db/client";

import { COMMANDS } from "./names";
import { defineCommand } from "./run";
import { isoDate, nonBlank, optionalText, uuid } from "./schemas";

/**
 * Phase 1 documents are references: where the document lives, where it came
 * from, and (when available) its SHA-256. Binary storage comes later via storage_key.
 */
export const recordDocumentReference = defineCommand(
  COMMANDS.recordDocumentReference,
  z.object({
    projectId: uuid,
    title: nonBlank,
    sourceDescription: nonBlank,
    sourcePersonId: uuid.optional(),
    uri: optionalText,
    originalFilename: optionalText,
    mimeType: optionalText,
    sizeBytes: z.number().int().nonnegative().optional(),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    receivedOn: isoDate.optional(),
  }),
  async ({ tx, actor }, input) => {
    const [row] = await tx
      .insert(schema.document)
      .values({ ...input, recordedBy: actor.userId })
      .returning();
    return row!;
  },
);

export const recordEvidence = defineCommand(
  COMMANDS.recordEvidence,
  z.object({
    projectId: uuid,
    code: nonBlank,
    title: nonBlank,
    summary: optionalText,
    documentId: uuid.optional(),
    sourcePersonId: uuid.optional(),
    evidenceDate: isoDate.optional(),
    receivedOn: isoDate.optional(),
    supersedesEvidenceId: uuid.optional(),
  }),
  async ({ tx, actor }, input) => {
    const [row] = await tx
      .insert(schema.evidence)
      .values({ ...input, recordedBy: actor.userId })
      .returning();
    return row!;
  },
);
