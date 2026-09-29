import { eq, max } from "drizzle-orm";
import { z } from "zod";

import { DomainError } from "@/domain/errors";
import { schema } from "@/server/db/client";

import { COMMANDS } from "./names";
import { defineCommand } from "./run";
import { isoDate, nonBlank, optionalText, uuid } from "./schemas";

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
