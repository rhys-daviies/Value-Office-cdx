import { eq } from "drizzle-orm";
import { z } from "zod";

import { DomainError } from "@/domain/errors";

import { schema } from "@/server/db/client";

import { COMMANDS } from "./names";
import { defineCommand } from "./run";
import { clearableDate, clearableText, clearableUuid, isoDate, nonBlank, optionalText, uuid } from "./schemas";

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
    isMaterialChange: z.boolean().optional(),
    materialChangeNote: optionalText,
  }),
  async ({ tx, actor }, input) => {
    const [row] = await tx
      .insert(schema.evidence)
      .values({ ...input, recordedBy: actor.userId })
      .returning();
    return row!;
  },
);

/**
 * Edits evidence metadata. The database refuses edits to evidence relied on by a
 * locked (proposed/recorded/authorised) version — record superseding evidence instead.
 */
export const updateEvidence = defineCommand(
  COMMANDS.updateEvidence,
  z.object({
    evidenceId: uuid,
    title: nonBlank.optional(),
    summary: clearableText,
    documentId: clearableUuid,
    sourcePersonId: clearableUuid,
    evidenceDate: clearableDate,
    receivedOn: clearableDate,
    supersedesEvidenceId: clearableUuid,
    isMaterialChange: z.boolean().optional(),
    materialChangeNote: clearableText,
  }),
  async ({ tx }, { evidenceId, ...fields }) => {
    const [row] = await tx.update(schema.evidence).set(fields).where(eq(schema.evidence.id, evidenceId)).returning();
    if (!row) throw new DomainError("VO_NOT_FOUND", "Evidence not found");
    return row;
  },
);

// --- Working links to a stable Value Driver identity (Phase 4D.2) -------------
// Evidence accumulates against the continuing driver without touching any authorised
// value_driver_version. A working link never locks the evidence and is not formal reliance.

export const linkDriverEvidence = defineCommand(
  COMMANDS.linkDriverEvidence,
  z.object({ evidenceId: uuid, valueDriverId: uuid, relevanceNote: optionalText }),
  async ({ tx }, input) => {
    const [evidence] = await tx
      .select({ projectId: schema.evidence.projectId })
      .from(schema.evidence)
      .where(eq(schema.evidence.id, input.evidenceId));
    if (!evidence) throw new DomainError("VO_NOT_FOUND", "Evidence not found");
    const [driver] = await tx
      .select({ projectId: schema.valueDriver.projectId })
      .from(schema.valueDriver)
      .where(eq(schema.valueDriver.id, input.valueDriverId));
    if (driver?.projectId !== evidence.projectId) throw new DomainError("VO_NOT_FOUND", "Value Driver not found");
    const [row] = await tx
      .insert(schema.evidenceLink)
      .values({ ...input, projectId: evidence.projectId })
      .returning();
    return row!;
  },
);

export const unlinkDriverEvidence = defineCommand(
  COMMANDS.unlinkDriverEvidence,
  z.object({ evidenceLinkId: uuid }),
  async ({ tx }, input) => {
    const [link] = await tx.select().from(schema.evidenceLink).where(eq(schema.evidenceLink.id, input.evidenceLinkId));
    if (!link?.valueDriverId) throw new DomainError("VO_NOT_FOUND", "Value Driver evidence link not found");
    await tx.delete(schema.evidenceLink).where(eq(schema.evidenceLink.id, link.id));
    return link;
  },
);
