import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { COMMANDS } from "@/server/commands/names";
import { createClient } from "@/server/commands/project";
import { db, schema } from "@/server/db/client";

import { asCommand, expectDomainError, newActor, newProject, sql } from "../support/fixtures";

describe("audit", () => {
  it("records actor, command, transaction and row image for every mutation", async () => {
    const actor = await newActor();
    const client = await createClient(actor, { name: "Audited client" });

    const events = await db()
      .select()
      .from(schema.auditEvent)
      .where(and(eq(schema.auditEvent.tableName, "client"), eq(schema.auditEvent.rowId, client.id)));

    expect(events).toHaveLength(1);
    const [e] = events;
    expect(e!.actorUserId).toBe(actor.userId);
    expect(e!.command).toBe(COMMANDS.createClient);
    expect(e!.action).toBe("INSERT");
    expect(e!.occurredAt).toBeInstanceOf(Date);
    expect(e!.transactionId).toBeGreaterThan(0);
    expect(e!.oldRow).toBeNull();
    expect((e!.newRow as { name: string }).name).toBe("Audited client");
  });

  it("groups all row changes of one command under one transaction id", async () => {
    const actor = await newActor();
    const { project, valueCase } = await newProject(actor, { valueBasis: false });
    const events = await db()
      .select()
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.command, COMMANDS.createProject));
    const mine = events.filter((e) => e.rowId === project.id || e.rowId === valueCase.id);
    expect(mine).toHaveLength(2);
    expect(new Set(mine.map((e) => e.transactionId)).size).toBe(1);
  });

  it("captures before and after images on update", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    const [e] = await db()
      .select()
      .from(schema.auditEvent)
      .where(
        and(eq(schema.auditEvent.rowId, project.id), eq(schema.auditEvent.command, COMMANDS.setProjectValueBasis)),
      );
    expect((e!.oldRow as { value_basis_description: string | null }).value_basis_description).toBeNull();
    expect((e!.newRow as { value_basis_description: string }).value_basis_description).toMatch(/FY27/);
  });

  it("rejects authoritative mutations outside a named command", async () => {
    const err = await db()
      .insert(schema.client)
      .values({ name: "Sneaky" })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(String((err as { cause?: Error }).cause?.message ?? err)).toMatch(/VO_NO_COMMAND_CONTEXT/);
  });

  it("is append-only", async () => {
    const actor = await newActor();
    await createClient(actor, { name: "Another" });
    await expectDomainError(
      asCommand(actor, COMMANDS.createClient, (tx) => tx.execute(sql`update audit_event set command = 'x'`)),
      "VO_AUDIT_APPEND_ONLY",
    );
    await expectDomainError(
      asCommand(actor, COMMANDS.createClient, (tx) => tx.execute(sql`delete from audit_event`)),
      "VO_AUDIT_APPEND_ONLY",
    );
    await expectDomainError(
      asCommand(actor, COMMANDS.createClient, (tx) => tx.execute(sql`truncate audit_event cascade`)),
      "VO_AUDIT_APPEND_ONLY",
    );
  });

  it("rolls back the audit record with the command when the command fails", async () => {
    const actor = await newActor();
    const name = `Rolled back ${Date.now()}`;
    await expect(
      asCommand(actor, COMMANDS.createClient, async (tx) => {
        await tx.insert(schema.client).values({ name });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const rows = await db().select().from(schema.client).where(eq(schema.client.name, name));
    expect(rows).toHaveLength(0);
    const events = await db()
      .select()
      .from(schema.auditEvent)
      .where(sql`${schema.auditEvent.newRow}->>'name' = ${name}`);
    expect(events).toHaveLength(0);
  });
});
