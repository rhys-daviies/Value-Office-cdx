import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Server actions run outside a Next request here: stub the framework calls.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));

import { createProjectAction } from "@/server/actions/projects";
import { IDLE } from "@/server/actions/state";
import { authoriseInitialVersionAction, updateDriverVersionAction } from "@/server/actions/value-case";
import { addValueDriver, createDraftVersion } from "@/server/commands/value-case";
import { db, schema } from "@/server/db/client";

import { newActor, newProject, proposedV1, uid } from "../support/fixtures";

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

beforeAll(() => {
  process.env.VO_DEV_USER_EMAIL = `actions-${uid()}@cardaxia.ai`;
});

describe("server actions adapt forms to commands", () => {
  it("createProjectAction creates and redirects to the project", async () => {
    const name = `Action Project ${uid()}`;
    const err = await createProjectAction(
      IDLE,
      form({ clientId: "", newClientName: "Action Client", name, currency: "nzd" }),
    ).then(
      () => null,
      (e: { url?: string }) => e,
    );
    expect(err?.url).toMatch(/^\/projects\/[0-9a-f-]{36}$/);
    const [row] = await db().select().from(schema.project).where(eq(schema.project.name, name));
    expect(row!.currency).toBe("NZD");
  });

  it("createProjectAction reports missing required fields per field", async () => {
    const state = await createProjectAction(IDLE, form({ clientId: "", newClientName: "X", name: "", currency: "" }));
    expect(state.status).toBe("error");
    expect(state.fieldErrors).toMatchObject({ name: "Required" });
    expect(state.fieldErrors?.currency).toBeDefined();
  });

  it("parses '4.8m' and marks drivers non-financial via the checkbox", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "V1" });
    const { driverVersion } = await addValueDriver(actor, { versionId: v1.id, code: "VD-01", name: "D" });
    const base = {
      projectId: project.id,
      driverVersionId: driverVersion.id,
      name: "D",
      qualificationStatus: "qualified",
      evidenceStatus: "evidenced",
    };

    expect((await updateDriverVersionAction(IDLE, form({ ...base, financialValue: "4.8m" }))).status).toBe("ok");
    let [row] = await db()
      .select()
      .from(schema.valueDriverVersion)
      .where(eq(schema.valueDriverVersion.id, driverVersion.id));
    expect(row!.financialValue).toBe("4800000.00");

    expect(
      (await updateDriverVersionAction(IDLE, form({ ...base, financialValue: "4.8m", nonFinancial: "on" }))).status,
    ).toBe("ok");
    [row] = await db()
      .select()
      .from(schema.valueDriverVersion)
      .where(eq(schema.valueDriverVersion.id, driverVersion.id));
    expect(row!.financialValue).toBeNull();

    const missing = await updateDriverVersionAction(IDLE, form({ ...base, financialValue: "" }));
    expect(missing.fieldErrors?.financialValue).toMatch(/non-financial/);
    const bad = await updateDriverVersionAction(IDLE, form({ ...base, financialValue: "lots" }));
    expect(bad.fieldErrors?.financialValue).toMatch(/not an amount/);
  });

  it("explains a non-VCO authorisation attempt instead of throwing", async () => {
    const actor = await newActor();
    const { project, v1, other, evidence } = await proposedV1(actor);
    const state = await authoriseInitialVersionAction(
      IDLE,
      form({
        projectId: project.id,
        versionId: v1.id,
        authorisedByPersonId: other.id,
        authorisedOn: new Date().toISOString().slice(0, 10),
        authorisationEvidenceId: evidence.id,
      }),
    );
    expect(state).toMatchObject({ status: "error", message: "Only the Value Case Owner can authorise the Value Case" });
    const [version] = await db().select().from(schema.valueCaseVersion).where(eq(schema.valueCaseVersion.id, v1.id));
    expect(version!.status).toBe("proposed");
  });

  it("records the acting consultant as the authorisation recorder", async () => {
    const actor = await newActor();
    const { project, v1, vco, evidence } = await proposedV1(actor);
    const state = await authoriseInitialVersionAction(
      IDLE,
      form({
        projectId: project.id,
        versionId: v1.id,
        authorisedByPersonId: vco.id,
        authorisedOn: new Date().toISOString().slice(0, 10),
        authorisationEvidenceId: evidence.id,
      }),
    );
    expect(state.status).toBe("ok");
    const [row] = await db()
      .select({ status: schema.valueCaseVersion.status, email: schema.appUser.email })
      .from(schema.valueCaseVersion)
      .innerJoin(schema.appUser, eq(schema.appUser.id, schema.valueCaseVersion.authorisationRecordedBy))
      .where(eq(schema.valueCaseVersion.id, v1.id));
    expect(row).toEqual({ status: "authorised", email: process.env.VO_DEV_USER_EMAIL });
  });
});
