import { eq } from "drizzle-orm";
import { z } from "zod";

import { DomainError } from "@/domain/errors";
import { schema } from "@/server/db/client";

import { COMMANDS } from "./names";
import { defineCommand } from "./run";
import { currencyCode, isoDate, keyDateKind, nonBlank, optionalText, uuid } from "./schemas";

export const createClient = defineCommand(
  COMMANDS.createClient,
  z.object({ name: nonBlank }),
  async ({ tx }, input) => {
    const [row] = await tx.insert(schema.client).values({ name: input.name }).returning();
    return row!;
  },
);

/** Creates the project and its (single) Value Case. */
export const createProject = defineCommand(
  COMMANDS.createProject,
  z.object({
    clientId: uuid,
    code: nonBlank,
    name: nonBlank,
    context: optionalText,
    currency: currencyCode,
  }),
  async ({ tx }, input) => {
    const [project] = await tx.insert(schema.project).values(input).returning();
    const [valueCase] = await tx.insert(schema.valueCase).values({ projectId: project!.id }).returning();
    return { project: project!, valueCase: valueCase! };
  },
);

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
