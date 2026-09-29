import { eq } from "drizzle-orm";
import { z } from "zod";

import { DomainError } from "@/domain/errors";
import { schema } from "@/server/db/client";

import { COMMANDS } from "./names";
import { defineCommand } from "./run";
import { nonBlank, optionalText, uuid } from "./schemas";

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
