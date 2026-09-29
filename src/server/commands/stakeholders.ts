import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { DomainError } from "@/domain/errors";
import { schema } from "@/server/db/client";

import { COMMANDS } from "./names";
import { defineCommand } from "./run";
import { clearableText, nonBlank, optionalText, uuid } from "./schemas";

/** Records a client-side person and adds them as a stakeholder on the project. */
export const addStakeholder = defineCommand(
  COMMANDS.addStakeholder,
  z.object({
    projectId: uuid,
    name: nonBlank,
    title: optionalText,
    organisation: optionalText,
    email: z.email().optional(),
    roleDescription: optionalText,
  }),
  async ({ tx }, input) => {
    const [project] = await tx
      .select({ clientId: schema.project.clientId })
      .from(schema.project)
      .where(eq(schema.project.id, input.projectId));
    if (!project) throw new DomainError("VO_NOT_FOUND", "Project not found");

    const [person] = await tx
      .insert(schema.person)
      .values({
        clientId: project.clientId,
        name: input.name,
        title: input.title,
        organisation: input.organisation,
        email: input.email,
      })
      .returning();
    const [stakeholder] = await tx
      .insert(schema.projectStakeholder)
      .values({
        projectId: input.projectId,
        personId: person!.id,
        clientId: project.clientId,
        roleDescription: input.roleDescription,
      })
      .returning();
    return { person: person!, stakeholder: stakeholder! };
  },
);

/** Sets the Value Case Owner. The person must already be a project stakeholder (FK-enforced). */
export const setValueCaseOwner = defineCommand(
  COMMANDS.setValueCaseOwner,
  z.object({ projectId: uuid, personId: uuid }),
  async ({ tx }, input) => {
    const [row] = await tx
      .update(schema.valueCase)
      .set({ vcoPersonId: input.personId })
      .where(eq(schema.valueCase.projectId, input.projectId))
      .returning();
    if (!row) throw new DomainError("VO_NOT_FOUND", "Value Case not found");
    return row;
  },
);

/** Edits a stakeholder's identifying details and project role. */
export const updateStakeholder = defineCommand(
  COMMANDS.updateStakeholder,
  z.object({
    projectId: uuid,
    personId: uuid,
    name: nonBlank.optional(),
    title: clearableText,
    organisation: clearableText,
    email: z.email().nullable().optional(),
    roleDescription: clearableText,
  }),
  async ({ tx }, { projectId, personId, roleDescription, ...person }) => {
    const onProject = and(
      eq(schema.projectStakeholder.projectId, projectId),
      eq(schema.projectStakeholder.personId, personId),
    );
    const [stakeholder] =
      roleDescription === undefined
        ? await tx.select().from(schema.projectStakeholder).where(onProject)
        : await tx.update(schema.projectStakeholder).set({ roleDescription }).where(onProject).returning();
    if (!stakeholder) throw new DomainError("VO_NOT_FOUND", "Stakeholder not found on this project");

    const changes = Object.fromEntries(Object.entries(person).filter(([, v]) => v !== undefined));
    const [row] =
      Object.keys(changes).length === 0
        ? await tx.select().from(schema.person).where(eq(schema.person.id, personId))
        : await tx.update(schema.person).set(changes).where(eq(schema.person.id, personId)).returning();
    return { person: row!, stakeholder };
  },
);
