import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { RequalificationReport } from "@/domain/reports";
import { seedCompactAuthorised } from "@/fixtures/compact";
import { HORIZON_VL001_DESCRIPTION, seedHorizon } from "@/fixtures/horizon";
import { alignHorizonFixture, LEGACY_VL001_MARKER } from "@/fixtures/horizon-cleanup";
import { recordEvidence } from "@/server/commands/evidence";
import { updateLeakage } from "@/server/commands/leakage";
import { createClient, createProject } from "@/server/commands/project";
import { updateDriverVersion } from "@/server/commands/value-case";
import { authoriseValueChange, createValueChange, proposeValueChange } from "@/server/commands/value-change";
import { db, schema } from "@/server/db/client";
import { buildRequalificationReport, getReportIssue } from "@/server/queries/reports";
import { issueReport } from "@/server/reports/issue";
import { issueMetaOf } from "@/server/reports/issue-meta";
import { renderReportArticle } from "@/ui/reports/render";

import { newActor, uid } from "../support/fixtures";

const today = new Date().toISOString().slice(0, 10);
const text = (m: string) => m.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("superseded V1 Re-Qualification Report (PMO decision)", () => {
  it("labels new previews/issues SUPERSEDED once V2 is in force; earlier issues stay unchanged", async () => {
    const actor = await newActor();
    const code = `S-${uid()}`;
    const { project } = await seedCompactAuthorised(actor, { code, name: `Superseded ${code}` });
    const [v1] = await db()
      .select()
      .from(schema.valueCaseVersion)
      .where(and(eq(schema.valueCaseVersion.projectId, project.id), eq(schema.valueCaseVersion.versionNumber, 1)));
    const before = await issueReport(actor, { type: "requalification", projectId: project.id, subjectId: v1!.id });
    expect(text(renderReportArticle(before.snapshot as RequalificationReport, issueMetaOf(before)))).not.toContain(
      "Superseded — not current Authorised Value Case",
    );

    // V2 via an authorised Value Change.
    const [valueCase] = await db().select().from(schema.valueCase).where(eq(schema.valueCase.projectId, project.id));
    const { change, version } = await createValueChange(actor, {
      projectId: project.id,
      code: "VC-001",
      statedChangeAmount: "-100000.00",
      reason: "Client elected a smaller scope",
    });
    const drivers = await db()
      .select()
      .from(schema.valueDriverVersion)
      .where(eq(schema.valueDriverVersion.valueCaseVersionId, version.id));
    const dv = drivers.find((d) => d.financialValue === "1000000.00")!;
    await updateDriverVersion(actor, { driverVersionId: dv.id, financialValue: "900000.00" });
    await proposeValueChange(actor, { changeId: change.id });
    const evidence = await recordEvidence(actor, { projectId: project.id, code: `E-${uid()}`, title: "VCO approval" });
    await authoriseValueChange(actor, {
      changeId: change.id,
      authorisedByPersonId: valueCase!.vcoPersonId!,
      authorisedOn: today,
      authorisationEvidenceId: evidence.id,
    });

    const preview = (await buildRequalificationReport(project.id, v1!.id))!;
    expect(preview.issuable.ok).toBe(true);
    expect(preview.model.authorised.status).toBe("superseded");
    expect(preview.model.currentVersion).toMatchObject({ versionNumber: 2 });
    const previewText = text(renderReportArticle(preview.model, { state: "preview" }));
    expect(previewText).toContain("Superseded — not current Authorised Value Case");
    expect(previewText).toMatch(/the Authorised Value Case now in force is V2/);

    const after = await issueReport(actor, { type: "requalification", projectId: project.id, subjectId: v1!.id });
    expect(after).toMatchObject({ subjectStatus: "superseded", issueNumber: 2 });
    expect(text(renderReportArticle(after.snapshot as RequalificationReport, issueMetaOf(after)))).toContain(
      "Superseded — not current Authorised Value Case",
    );

    // The issue made before supersession is untouched.
    const stored = (await getReportIssue(project.id, before.id))!;
    expect(stored).toEqual(before);
    expect((stored.snapshot as RequalificationReport).authorised.status).toBe("authorised");
  }, 90_000);
});

describe("Horizon development fixture cleanup", () => {
  async function legacyHorizon() {
    const actor = await newActor();
    const code = `HORIZON-${uid()}`;
    const { project, review } = await seedHorizon(actor, { projectCode: code });
    const [vl] = await db()
      .select()
      .from(schema.valueLeakage)
      .where(and(eq(schema.valueLeakage.projectId, project.id), eq(schema.valueLeakage.code, "VL-001")));
    await updateLeakage(actor, {
      leakageId: vl!.id,
      description: `[FIXTURE PLACEHOLDER] ${LEGACY_VL001_MARKER} exposure $0.70m, "leakage to date" $0.25m, "still recoverable" $0.30m.`,
    });
    return { actor, code, project, review, vl: vl! };
  }

  it("aligns only the Horizon fixture's legacy VL-001 narrative, once, through an audited command", async () => {
    const { actor, code, vl } = await legacyHorizon();
    expect(await alignHorizonFixture(actor, "development", code)).toMatchObject({ status: "updated" });
    const [after] = await db().select().from(schema.valueLeakage).where(eq(schema.valueLeakage.id, vl.id));
    expect(after!.description).toBe(HORIZON_VL001_DESCRIPTION);
    expect(after!.description).not.toMatch(/0\.70|0\.25|0\.30/);
    expect(await alignHorizonFixture(actor, "development", code)).toMatchObject({ status: "already-aligned" });
    const audit = await db()
      .select()
      .from(schema.auditEvent)
      .where(and(eq(schema.auditEvent.rowId, vl.id), eq(schema.auditEvent.command, "leakage.update")));
    expect(audit).toHaveLength(2); // the legacy text set by this test, then the alignment
  });

  it("refuses production and never touches a non-fixture project", async () => {
    const { actor, code } = await legacyHorizon();
    await expect(alignHorizonFixture(actor, "production", code)).rejects.toThrow(
      /Refusing to modify data in production/,
    );

    // A real client project with the same code shape and legacy-looking text is not the fixture.
    const client = await createClient(actor, { name: "Real Client Ltd" });
    const realCode = `HORIZON-REAL-${uid()}`;
    await createProject(actor, { clientId: client.id, code: realCode, name: "Horizon", currency: "USD" });
    expect(await alignHorizonFixture(actor, "development", realCode)).toEqual({ status: "no-fixture" });
  });

  it("is safe when the fixture is already canonical", async () => {
    const actor = await newActor();
    const code = `HORIZON-${uid()}`;
    await seedHorizon(actor, { projectCode: code });
    expect(await alignHorizonFixture(actor, "test", code)).toMatchObject({ status: "already-aligned" });
  });
});
