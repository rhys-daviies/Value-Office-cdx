import { and, eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Server actions run outside a Next request here: stub the framework calls.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));

import { DAY_ONE_SUGGESTIONS } from "@/domain/day-one-requests";
import { addDayOneItemsAction, createDayOneRequestAction } from "@/server/actions/mobilisation";
import { createProjectAction } from "@/server/actions/projects";
import { IDLE } from "@/server/actions/state";
import { closeInformationRequest, issueInformationRequest } from "@/server/commands/information-request";
import { createClient } from "@/server/commands/project";
import { db, schema } from "@/server/db/client";
import { getMobilisationStatus } from "@/server/queries/projects";

import { newActor, newProject, uid } from "../support/fixtures";

// Phase 4D.10C: explicit client choice at project creation, and the Day-1 Information Request created from
// Mobilisation through the existing commands.

const form = (fields: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) fd.append(k, x);
  return fd;
};
const createdUrl = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { url?: string }) => e.url ?? null,
  );
const projectNamed = async (name: string) =>
  (await db().select().from(schema.project).where(eq(schema.project.name, name)))[0];

beforeAll(() => {
  process.env.VO_DEV_USER_EMAIL = `mobilisation-${uid()}@cardaxia.ai`;
});

describe("project creation: existing or new client, chosen explicitly", () => {
  it("uses an existing client", async () => {
    const actor = await newActor();
    const client = await createClient(actor, { name: `Existing ${uid()}` });
    const name = `Existing-client project ${uid()}`;
    const url = await createdUrl(
      createProjectAction(IDLE, form({ clientMode: "existing", clientId: client.id, name, currency: "USD" })),
    );
    expect(url).toMatch(/^\/projects\//);
    expect((await projectNamed(name))!.clientId).toBe(client.id);
  });

  it("creates a new client", async () => {
    const clientName = `New Client ${uid()}`;
    const name = `New-client project ${uid()}`;
    await createdUrl(
      createProjectAction(IDLE, form({ clientMode: "new", newClientName: clientName, name, currency: "USD" })),
    );
    const [client] = await db().select().from(schema.client).where(eq(schema.client.name, clientName));
    expect((await projectNamed(name))!.clientId).toBe(client!.id);
  });

  it("resolves an ambiguous submission by the explicit choice, and refuses a missing one", async () => {
    const actor = await newActor();
    const client = await createClient(actor, { name: `Chosen ${uid()}` });
    const ignored = `Ignored ${uid()}`;
    const name = `Ambiguous project ${uid()}`;
    await createdUrl(
      createProjectAction(
        IDLE,
        form({ clientMode: "existing", clientId: client.id, newClientName: ignored, name, currency: "USD" }),
      ),
    );
    expect((await projectNamed(name))!.clientId).toBe(client.id);
    expect(await db().select().from(schema.client).where(eq(schema.client.name, ignored))).toHaveLength(0);

    const noChoice = await createProjectAction(
      IDLE,
      form({ clientId: client.id, name: `x ${uid()}`, currency: "USD" }),
    );
    expect(noChoice).toMatchObject({ status: "error", fieldErrors: { clientMode: expect.any(String) } });
    const noClient = await createProjectAction(
      IDLE,
      form({ clientMode: "existing", name: `x ${uid()}`, currency: "USD" }),
    );
    expect(noClient).toMatchObject({ status: "error", fieldErrors: { clientId: "Choose a client" } });
    const noName = await createProjectAction(IDLE, form({ clientMode: "new", name: `x ${uid()}`, currency: "USD" }));
    expect(noName).toMatchObject({ status: "error", fieldErrors: { newClientName: expect.any(String) } });
  });
});

describe("Day-1 Information Request from Mobilisation", () => {
  it("creates the request with selected suggestions and custom items through the normal commands", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    const state = await createDayOneRequestAction(
      IDLE,
      form({
        projectId: project.id,
        title: "Day-1 Information Request",
        suggestion: ["business-case", "baseline-evidence", "not-a-suggestion"],
        additionalItems: "Org chart\n\n  Existing Business Case \nOrg chart",
      }),
    );
    expect(state).toMatchObject({ status: "ok", message: "IR-01 created with 3 items" });

    const m = (await getMobilisationStatus(project.id))!;
    expect(m.dayOneRequest).toMatchObject({ reference: "IR-01", status: "draft", items: 3 });
    // Suggestions in list order, then custom lines; repeats of a selected suggestion are not added twice.
    expect(m.dayOneRequest!.descriptions).toEqual([
      "Existing Business Case",
      "Baseline performance evidence",
      "Org chart",
    ]);
    const [request] = await db()
      .select()
      .from(schema.informationRequest)
      .where(eq(schema.informationRequest.projectId, project.id));
    expect(request!.purpose).toBe("mobilisation");

    // Every write took the command + audit path.
    const items = await db()
      .select({ id: schema.informationRequestItem.id })
      .from(schema.informationRequestItem)
      .where(eq(schema.informationRequestItem.informationRequestId, request!.id));
    const audit = await db()
      .select({ command: schema.auditEvent.command, action: schema.auditEvent.action })
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.tableName, "information_request_item"),
          inArray(
            schema.auditEvent.rowId,
            items.map((i) => i.id),
          ),
        ),
      );
    expect(audit).toHaveLength(3);
    expect(audit.every((a) => a.command === "informationRequest.addItem" && a.action === "INSERT")).toBe(true);
  });

  it("never duplicates the request; adds only suggestions not already on it; refuses a closed one", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    await createDayOneRequestAction(IDLE, form({ projectId: project.id, suggestion: ["business-case"] }));

    const again = await createDayOneRequestAction(
      IDLE,
      form({ projectId: project.id, suggestion: ["programme-plan"] }),
    );
    expect(again).toMatchObject({ status: "error", message: expect.stringMatching(/IR-01 already exists/) });
    expect(
      await db().select().from(schema.informationRequest).where(eq(schema.informationRequest.projectId, project.id)),
    ).toHaveLength(1);

    const m = (await getMobilisationStatus(project.id))!;
    const added = await addDayOneItemsAction(
      IDLE,
      form({
        projectId: project.id,
        informationRequestId: m.dayOneRequest!.id,
        suggestion: DAY_ONE_SUGGESTIONS.map((s) => s.key),
      }),
    );
    expect(added).toMatchObject({ status: "ok", message: "4 items added to IR-01" });
    expect((await getMobilisationStatus(project.id))!.dayOneRequest!.items).toBe(5);
    const none = await addDayOneItemsAction(
      IDLE,
      form({ projectId: project.id, informationRequestId: m.dayOneRequest!.id, suggestion: ["business-case"] }),
    );
    expect(none).toMatchObject({ status: "ok", message: "Nothing new to add" });

    await issueInformationRequest(actor, { informationRequestId: m.dayOneRequest!.id, issuedOn: "2026-10-01" });
    await closeInformationRequest(actor, { informationRequestId: m.dayOneRequest!.id, closedOn: "2026-10-02" });
    const closed = await addDayOneItemsAction(
      IDLE,
      form({ projectId: project.id, informationRequestId: m.dayOneRequest!.id, additionalItems: "Late item" }),
    );
    expect(closed).toMatchObject({ status: "error", message: expect.stringMatching(/closed/) });
  });
});
