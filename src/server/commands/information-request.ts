import { and, eq, max } from "drizzle-orm";
import { z } from "zod";

import { DomainError } from "@/domain/errors";
import { INFORMATION_REQUEST_ITEM_STATUSES, INFORMATION_REQUEST_PURPOSES } from "@/domain/statuses";
import { schema, type Tx } from "@/server/db/client";

import { COMMANDS } from "./names";
import { defineCommand } from "./run";
import { clearableDate, clearableText, clearableUuid, isoDate, nonBlank, optionalText, uuid } from "./schemas";

/**
 * Information Requests can be raised throughout the engagement (Phase 4D.2): for Mobilisation /
 * Re-Qualification, or for Assurance evidence. Requests from before 4D.2 have no purpose and read
 * as Mobilisation.
 */
export const createInformationRequest = defineCommand(
  COMMANDS.createInformationRequest,
  z.object({
    projectId: uuid,
    reference: nonBlank,
    title: nonBlank,
    purpose: z.enum(INFORMATION_REQUEST_PURPOSES).default("mobilisation"),
  }),
  async ({ tx }, input) => {
    const [row] = await tx.insert(schema.informationRequest).values(input).returning();
    return row!;
  },
);

/** The next free IR-nn reference in the project. */
export async function nextRequestReference(tx: Tx, projectId: string): Promise<string> {
  const rows = await tx
    .select({ reference: schema.informationRequest.reference })
    .from(schema.informationRequest)
    .where(eq(schema.informationRequest.projectId, projectId));
  return formatRequestReference(rows.map((r) => r.reference));
}

export function formatRequestReference(references: readonly string[]): string {
  const last = references.reduce((m, r) => Math.max(m, Number(/^IR-(\d+)$/.exec(r)?.[1] ?? 0)), 0);
  return `IR-${String(last + 1).padStart(2, "0")}`;
}

export const itemFields = {
  description: nonBlank,
  requestedFromPersonId: uuid.optional(),
  dueOn: isoDate.optional(),
  valueDriverId: uuid.optional(),
  notes: optionalText,
};

type NewItem = {
  informationRequestId: string;
  description: string;
  requestedFromPersonId?: string;
  dueOn?: string;
  valueDriverId?: string;
  valueLeakageId?: string;
  notes?: string;
};

/** Appends an item to a request (shared by addItem and matter.requestEvidence). */
export async function insertRequestItem(tx: Tx, input: NewItem) {
  const [request] = await tx
    .select({ projectId: schema.informationRequest.projectId })
    .from(schema.informationRequest)
    .where(eq(schema.informationRequest.id, input.informationRequestId));
  if (!request) throw new DomainError("VO_NOT_FOUND", "Information Request not found");

  const [{ last } = { last: null }] = await tx
    .select({ last: max(schema.informationRequestItem.sequence) })
    .from(schema.informationRequestItem)
    .where(eq(schema.informationRequestItem.informationRequestId, input.informationRequestId));

  const [row] = await tx
    .insert(schema.informationRequestItem)
    .values({ ...input, projectId: request.projectId, sequence: (last ?? 0) + 1 })
    .returning();
  return row!;
}

export const addInformationRequestItem = defineCommand(
  COMMANDS.addInformationRequestItem,
  z.object({
    informationRequestId: uuid,
    ...itemFields,
    // Assurance requests only (checked in the database).
    valueLeakageId: uuid.optional(),
  }),
  async ({ tx }, input) => insertRequestItem(tx, input),
);

export const updateInformationRequestItem = defineCommand(
  COMMANDS.updateInformationRequestItem,
  z.object({
    itemId: uuid,
    description: nonBlank.optional(),
    requestedFromPersonId: clearableUuid,
    dueOn: clearableDate,
    valueDriverId: clearableUuid,
    status: z.enum(INFORMATION_REQUEST_ITEM_STATUSES).optional(),
    fulfilledByEvidenceId: clearableUuid,
    notes: clearableText,
  }),
  async ({ tx }, { itemId, ...fields }) => {
    const [row] = await tx
      .update(schema.informationRequestItem)
      .set(fields)
      .where(eq(schema.informationRequestItem.id, itemId))
      .returning();
    if (!row) throw new DomainError("VO_NOT_FOUND", "Information Request item not found");
    return row;
  },
);

/** Items can be removed only while the Information Request is still a draft. */
export const removeInformationRequestItem = defineCommand(
  COMMANDS.removeInformationRequestItem,
  z.object({ itemId: uuid }),
  async ({ tx }, input) => {
    const [item] = await tx
      .select({ status: schema.informationRequest.status })
      .from(schema.informationRequestItem)
      .innerJoin(
        schema.informationRequest,
        eq(schema.informationRequest.id, schema.informationRequestItem.informationRequestId),
      )
      .where(eq(schema.informationRequestItem.id, input.itemId));
    if (!item) throw new DomainError("VO_NOT_FOUND", "Information Request item not found");
    if (item.status !== "draft") {
      throw new DomainError(
        "VO_REQUEST_ISSUED",
        "Items cannot be removed once the Information Request is issued; mark them not available instead",
      );
    }
    await tx.delete(schema.informationRequestItem).where(eq(schema.informationRequestItem.id, input.itemId));
  },
);

export const issueInformationRequest = defineCommand(
  COMMANDS.issueInformationRequest,
  z.object({ informationRequestId: uuid, issuedOn: isoDate }),
  async ({ tx }, input) => {
    const [row] = await tx
      .update(schema.informationRequest)
      .set({ status: "issued", issuedOn: input.issuedOn })
      .where(
        and(
          eq(schema.informationRequest.id, input.informationRequestId),
          eq(schema.informationRequest.status, "draft"),
        ),
      )
      .returning();
    if (!row) throw new DomainError("VO_INVALID_TRANSITION", "Only a draft Information Request can be issued");
    return row;
  },
);

export const closeInformationRequest = defineCommand(
  COMMANDS.closeInformationRequest,
  z.object({ informationRequestId: uuid, closedOn: isoDate }),
  async ({ tx }, input) => {
    const [row] = await tx
      .update(schema.informationRequest)
      .set({ status: "closed", closedOn: input.closedOn })
      .where(
        and(
          eq(schema.informationRequest.id, input.informationRequestId),
          eq(schema.informationRequest.status, "issued"),
        ),
      )
      .returning();
    if (!row) throw new DomainError("VO_INVALID_TRANSITION", "Only an issued Information Request can be closed");
    return row;
  },
);
