import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { expect } from "vitest";

import { DomainError } from "@/domain/errors";
import { recordEvidence } from "@/server/commands/evidence";
import type { CommandName } from "@/server/commands/names";
import { createClient, createProject, setProjectValueBasis } from "@/server/commands/project";
import { runCommand, type Actor } from "@/server/commands/run";
import { addStakeholder, setValueCaseOwner } from "@/server/commands/stakeholders";
import { ensureUser } from "@/server/commands/users";
import { addValueDriver, createDraftVersion, proposeVersion } from "@/server/commands/value-case";
import type { Tx } from "@/server/db/client";

// Tests never truncate: each test creates its own uniquely-coded client/project.

export const uid = () => randomUUID().slice(0, 8);

export async function newActor(): Promise<Actor> {
  const id = uid();
  return ensureUser(`consultant-${id}@cardaxia.ai`, `Consultant ${id}`);
}

export async function newProject(actor: Actor, opts: { valueBasis?: boolean } = {}) {
  const client = await createClient(actor, { name: `Client ${uid()}` });
  const { project, valueCase } = await createProject(actor, {
    clientId: client.id,
    code: `P-${uid()}`,
    name: "Test project",
    currency: "USD",
  });
  if (opts.valueBasis !== false) {
    await setProjectValueBasis(actor, {
      projectId: project.id,
      valueBasisDescription: "Cumulative financial benefit over FY27–FY30",
      valuePeriodStart: "2026-07-01",
      valuePeriodEnd: "2030-06-30",
    });
  }
  return { client, project, valueCase };
}

/** A project with a VCO and a proposed V1 containing one driver, ready to authorise. */
export async function proposedV1(actor: Actor) {
  const { project, client } = await newProject(actor);
  const { person: vco } = await addStakeholder(actor, { projectId: project.id, name: "Val Owner" });
  const { person: other } = await addStakeholder(actor, { projectId: project.id, name: "Someone Else" });
  await setValueCaseOwner(actor, { projectId: project.id, personId: vco.id });
  const v1 = await createDraftVersion(actor, { projectId: project.id, title: "Re-Qualified Value Case" });
  const { driver, driverVersion } = await addValueDriver(actor, {
    adjustmentRationale: "Synthetic test rationale",
    versionId: v1.id,
    code: "VD-01",
    name: "Service Productivity",
    financialValue: "4800000.00",
    avoPersonId: other.id,
  });
  await proposeVersion(actor, { versionId: v1.id });
  const evidence = await recordEvidence(actor, {
    projectId: project.id,
    code: "E-AUTH",
    title: "Signed authorisation notice",
  });
  return { client, project, vco, other, v1, driver, driverVersion, evidence };
}

/** Run raw SQL inside a command context — for testing DB guards beneath the command layer. */
export function asCommand<R>(actor: Actor, name: CommandName, fn: (tx: Tx) => Promise<R>) {
  return runCommand(name, actor, ({ tx }) => fn(tx));
}

export async function expectDomainError(promise: Promise<unknown>, code: string) {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err, `expected DomainError ${code}`).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
  return err as DomainError;
}

export { sql };
