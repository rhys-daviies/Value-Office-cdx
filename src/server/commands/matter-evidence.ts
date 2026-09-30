import { eq } from "drizzle-orm";
import { z } from "zod";

import { DomainError } from "@/domain/errors";
import { schema } from "@/server/db/client";

import { insertRequestItem, itemFields, nextRequestReference } from "./information-request";
import { openMatter } from "./matters";
import { COMMANDS } from "./names";
import { defineCommand } from "./run";
import { isoDate, nonBlank, optionalText, uuid } from "./schemas";

// Evidence in everyday Continuous Assurance (Phase 4D.2). Evidence supporting a living matter is
// either documented directly or requested (an item on an Assurance Information Request, fulfilled
// by evidence through informationRequest.updateItem). Matter links are WORKING links: they never
// lock evidence, never become formal review evidence by themselves, and never move the matter's
// stage, working figures, forecast, Value Gap or Authorised Value. The consultant decides.

/** Record new evidence for an open matter and link it (optionally also to a Value Driver identity). */
export const documentMatterEvidence = defineCommand(
  COMMANDS.documentMatterEvidence,
  z.object({
    matterId: uuid,
    code: nonBlank,
    title: nonBlank,
    summary: optionalText,
    sourcePersonId: uuid.optional(),
    documentId: uuid.optional(),
    evidenceDate: isoDate.optional(),
    receivedOn: isoDate.optional(),
    relevanceNote: optionalText,
    valueDriverId: uuid.optional(),
  }),
  async ({ tx, actor }, { matterId, relevanceNote, valueDriverId, ...fields }) => {
    const matter = await openMatter(tx, matterId);
    const [evidence] = await tx
      .insert(schema.evidence)
      .values({ ...fields, projectId: matter.projectId, recordedBy: actor.userId })
      .returning();
    await tx
      .insert(schema.evidenceLink)
      .values({ evidenceId: evidence!.id, projectId: matter.projectId, valueLeakageId: matter.id, relevanceNote });
    if (valueDriverId) {
      await tx
        .insert(schema.evidenceLink)
        .values({ evidenceId: evidence!.id, projectId: matter.projectId, valueDriverId, relevanceNote });
    }
    return evidence!;
  },
);

/** Link existing evidence (locked or not — the evidence itself is untouched) to an open matter. */
export const linkMatterEvidence = defineCommand(
  COMMANDS.linkMatterEvidence,
  z.object({ matterId: uuid, evidenceId: uuid, relevanceNote: optionalText }),
  async ({ tx }, input) => {
    const matter = await openMatter(tx, input.matterId);
    const [row] = await tx
      .insert(schema.evidenceLink)
      .values({
        evidenceId: input.evidenceId,
        projectId: matter.projectId,
        valueLeakageId: matter.id,
        relevanceNote: input.relevanceNote,
      })
      .returning();
    return row!;
  },
);

/** Remove a working matter link while the matter is open. The evidence record stays. */
export const unlinkMatterEvidence = defineCommand(
  COMMANDS.unlinkMatterEvidence,
  z.object({ evidenceLinkId: uuid }),
  async ({ tx }, input) => {
    const [link] = await tx.select().from(schema.evidenceLink).where(eq(schema.evidenceLink.id, input.evidenceLinkId));
    if (!link?.valueLeakageId) throw new DomainError("VO_NOT_FOUND", "Matter evidence link not found");
    await openMatter(tx, link.valueLeakageId);
    await tx.delete(schema.evidenceLink).where(eq(schema.evidenceLink.id, link.id));
    return link;
  },
);

/**
 * Request missing evidence for an open matter: an item on an existing Assurance Information
 * Request, or on a new one raised in the same transaction. It does not change the matter's stage.
 */
export const requestMatterEvidence = defineCommand(
  COMMANDS.requestMatterEvidence,
  z
    .object({
      matterId: uuid,
      informationRequestId: uuid.optional(),
      newRequestTitle: nonBlank.optional(),
      ...itemFields,
    })
    .refine((v) => Boolean(v.informationRequestId) !== Boolean(v.newRequestTitle), {
      message: "Choose an Assurance Information Request or name a new one",
      path: ["informationRequestId"],
    }),
  async ({ tx }, { matterId, informationRequestId, newRequestTitle, ...item }) => {
    const matter = await openMatter(tx, matterId);
    let requestId = informationRequestId;
    if (requestId) {
      const [request] = await tx
        .select()
        .from(schema.informationRequest)
        .where(eq(schema.informationRequest.id, requestId));
      if (request?.projectId !== matter.projectId)
        throw new DomainError("VO_NOT_FOUND", "Information Request not found");
      if (request.status === "closed") {
        throw new DomainError("VO_INVALID_TRANSITION", `${request.reference} is closed; raise a new request`);
      }
    } else {
      const [request] = await tx
        .insert(schema.informationRequest)
        .values({
          projectId: matter.projectId,
          reference: await nextRequestReference(tx, matter.projectId),
          title: newRequestTitle!,
          purpose: "assurance",
        })
        .returning();
      requestId = request!.id;
    }
    return insertRequestItem(tx, { ...item, informationRequestId: requestId, valueLeakageId: matter.id });
  },
);
