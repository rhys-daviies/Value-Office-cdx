import { and, eq, like } from "drizzle-orm";
import { z } from "zod";

import { DomainError } from "@/domain/errors";
import { schema, type Tx } from "@/server/db/client";

import { COMMANDS } from "./names";
import { defineCommand } from "./run";
import { clearableText, currencyCode, isoDate, keyDateKind, nonBlank, optionalText, uuid } from "./schemas";

export const createClient = defineCommand(
  COMMANDS.createClient,
  z.object({ name: nonBlank }),
  async ({ tx }, input) => {
    const [row] = await tx.insert(schema.client).values({ name: input.name }).returning();
    return row!;
  },
);

/**
 * Establishes a project in one transaction: client (existing or new), the
 * project and its single Value Case, and optionally the Value Basis and the
 * kick-off / go-live dates. Only name, currency and a client are required.
 */
export const createProject = defineCommand(
  COMMANDS.createProject,
  z
    .object({
      clientId: uuid.optional(),
      newClientName: optionalText,
      code: optionalText,
      name: nonBlank,
      context: optionalText,
      currency: currencyCode,
      valueBasisDescription: optionalText,
      valuePeriodStart: isoDate.optional(),
      valuePeriodEnd: isoDate.optional(),
      kickoffDate: isoDate.optional(),
      goLiveDate: isoDate.optional(),
    })
    .refine((v) => Boolean(v.clientId) !== Boolean(v.newClientName), {
      message: "Choose an existing client or enter a new client name",
      path: ["clientId"],
    }),
  async ({ tx }, input) => {
    let clientId = input.clientId;
    if (!clientId) {
      const [client] = await tx.insert(schema.client).values({ name: input.newClientName! }).returning();
      clientId = client!.id;
    }
    const [project] = await tx
      .insert(schema.project)
      .values({
        clientId,
        code: input.code ?? (await nextProjectCode(tx, input.name)),
        name: input.name,
        context: input.context,
        currency: input.currency,
        valueBasisDescription: input.valueBasisDescription,
        valuePeriodStart: input.valuePeriodStart,
        valuePeriodEnd: input.valuePeriodEnd,
      })
      .returning();
    const [valueCase] = await tx.insert(schema.valueCase).values({ projectId: project!.id }).returning();

    const dates = [
      { kind: "kickoff" as const, label: "Kick-off", date: input.kickoffDate },
      { kind: "go_live" as const, label: "Go-Live", date: input.goLiveDate },
    ].flatMap((d) => (d.date ? [{ projectId: project!.id, kind: d.kind, label: d.label, date: d.date }] : []));
    if (dates.length > 0) await tx.insert(schema.keyDate).values(dates);

    return { project: project!, valueCase: valueCase! };
  },
);

/** Derives an unused code such as PROJECT-HORIZON, PROJECT-HORIZON-2, … from the name. */
async function nextProjectCode(tx: Tx, name: string): Promise<string> {
  const base =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "PROJECT";
  const taken = new Set(
    (
      await tx
        .select({ code: schema.project.code })
        .from(schema.project)
        .where(like(schema.project.code, `${base}%`))
    ).map((r) => r.code),
  );
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export const setProjectValueBasis = defineCommand(
  COMMANDS.setProjectValueBasis,
  z.object({
    projectId: uuid,
    valueBasisDescription: nonBlank,
    valuePeriodStart: isoDate.nullable().optional(),
    valuePeriodEnd: isoDate.nullable().optional(),
  }),
  async ({ tx }, { projectId, ...basis }) => {
    const [row] = await tx
      .update(schema.project)
      .set({
        valueBasisDescription: basis.valueBasisDescription,
        valuePeriodStart: basis.valuePeriodStart ?? null,
        valuePeriodEnd: basis.valuePeriodEnd ?? null,
      })
      .where(eq(schema.project.id, projectId))
      .returning();
    if (!row) throw new DomainError("VO_NOT_FOUND", "Project not found");
    return row;
  },
);

export const addKeyDate = defineCommand(
  COMMANDS.addKeyDate,
  z.object({ projectId: uuid, kind: keyDateKind, label: nonBlank, date: isoDate, notes: optionalText }),
  async ({ tx }, input) => {
    const [row] = await tx.insert(schema.keyDate).values(input).returning();
    return row!;
  },
);

/** Name and context only. Currency and Value Basis have their own (lockable) command. */
export const updateProjectDetails = defineCommand(
  COMMANDS.updateProjectDetails,
  z.object({ projectId: uuid, name: nonBlank.optional(), context: clearableText }),
  async ({ tx }, { projectId, ...fields }) => {
    const [row] = await tx.update(schema.project).set(fields).where(eq(schema.project.id, projectId)).returning();
    if (!row) throw new DomainError("VO_NOT_FOUND", "Project not found");
    return row;
  },
);

export const removeKeyDate = defineCommand(
  COMMANDS.removeKeyDate,
  z.object({ projectId: uuid, keyDateId: uuid }),
  async ({ tx }, input) => {
    const [row] = await tx
      .delete(schema.keyDate)
      .where(and(eq(schema.keyDate.id, input.keyDateId), eq(schema.keyDate.projectId, input.projectId)))
      .returning();
    if (!row) throw new DomainError("VO_NOT_FOUND", "Key date not found");
    return row;
  },
);
