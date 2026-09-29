import { and, eq, max } from "drizzle-orm";
import { z } from "zod";

import { DomainError } from "@/domain/errors";
import { INFORMATION_REQUEST_ITEM_STATUSES } from "@/domain/statuses";
import { schema } from "@/server/db/client";

import { COMMANDS } from "./names";
import { defineCommand } from "./run";
import { clearableDate, clearableText, clearableUuid, isoDate, nonBlank, optionalText, uuid } from "./schemas";

export const createInformationRequest = defineCommand(
  COMMANDS.createInformationRequest,
  z.object({ projectId: uuid, reference: nonBlank, title: nonBlank }),
  async ({ tx }, input) => {
    const [row] = await tx.insert(schema.informationRequest).values(input).returning();
    return row!;
  },
);

export const addInformationRequestItem = defineCommand(
  COMMANDS.addInformationRequestItem,
  z.object({
    informationRequestId: uuid,
    description: nonBlank,
    requestedFromPersonId: uuid.optional(),
    dueOn: isoDate.optional(),
    valueDriverId: uuid.optional(),
    notes: optionalText,
  }),
  async ({ tx }, input) => {
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
  },
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
