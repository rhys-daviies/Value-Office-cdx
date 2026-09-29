import { and, eq, like } from "drizzle-orm";

import { updateLeakage } from "@/server/commands/leakage";
import type { Actor } from "@/server/commands/run";
import { db, schema } from "@/server/db/client";

import { HORIZON_VL001_DESCRIPTION, PLACEHOLDER } from "./horizon";

// Development-only alignment of an existing Project Horizon *fixture* with the current
// canonical seed. Bounded on purpose: it refuses production, touches only the Horizon
// fixture project (code HORIZON, placeholder client), only VL-001, and only when VL-001
// still carries the pre-Phase-4A narrative that quoted the prototype leakage figures.
// The change goes through the normal command (leakage.update) and is audited.

export const LEGACY_VL001_MARKER = "Old-prototype figures:";

export type AlignResult =
  | { status: "updated"; projectId: string }
  | { status: "already-aligned"; projectId: string }
  | { status: "no-fixture" };

export async function alignHorizonFixture(
  actor: Actor,
  nodeEnv: string | undefined,
  projectCode = "HORIZON",
): Promise<AlignResult> {
  if (nodeEnv === "production") throw new Error("Refusing to modify data in production: this is a fixture-only tool");

  const [fixture] = await db()
    .select({ projectId: schema.project.id })
    .from(schema.project)
    .innerJoin(schema.client, eq(schema.client.id, schema.project.clientId))
    .where(and(eq(schema.project.code, projectCode), like(schema.client.name, `${PLACEHOLDER}%`)));
  if (!fixture) return { status: "no-fixture" };

  const [vl] = await db()
    .select()
    .from(schema.valueLeakage)
    .where(and(eq(schema.valueLeakage.projectId, fixture.projectId), eq(schema.valueLeakage.code, "VL-001")));
  if (!vl || !vl.description?.includes(LEGACY_VL001_MARKER)) {
    return { status: "already-aligned", projectId: fixture.projectId };
  }
  await updateLeakage(actor, { leakageId: vl.id, description: HORIZON_VL001_DESCRIPTION });
  return { status: "updated", projectId: fixture.projectId };
}
