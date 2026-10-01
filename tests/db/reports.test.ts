import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { canonicalJson, type AssuranceReport, type ReportModel } from "@/domain/reports";
import { seedCompactAuthorised } from "@/fixtures/compact";
import { HORIZON, seedHorizon } from "@/fixtures/horizon";
import { createReview, finaliseReview, upsertValuePositions } from "@/server/commands/assurance";
import { recordEvidence } from "@/server/commands/evidence";
import {
  addInformationRequestItem,
  createInformationRequest,
  issueInformationRequest,
  updateInformationRequestItem,
} from "@/server/commands/information-request";
import { assessLeakage, createLeakage } from "@/server/commands/leakage";
import { COMMANDS } from "@/server/commands/names";
import { issueRecommendation, recordDecision, saveRecommendation, upsertScenario } from "@/server/commands/options";
import { issueReport as issueReportCommand } from "@/server/commands/reports";
import type { Actor } from "@/server/commands/run";
import { updateDriverVersion } from "@/server/commands/value-case";
import { authoriseValueChange, createValueChange, proposeValueChange } from "@/server/commands/value-change";
import { db, schema } from "@/server/db/client";
import { getAssuranceWorkspace } from "@/server/queries/assurance";
import {
  buildAssuranceReport,
  buildInformationRequestReport,
  buildRequalificationReport,
  buildValueChangeNotice,
  getReportIssue,
  snapshotSha256,
} from "@/server/queries/reports";
import { getReviewResponse, getValueChangeDetail } from "@/server/queries/response";
import { getRequalificationWorkspace } from "@/server/queries/value-case";
import { issueReport } from "@/server/reports/issue";
import { getDocument, sha256 } from "@/server/reports/storage";
import { renderReportArticle, renderReportDocument } from "@/ui/reports/render";

import { asCommand, expectDomainError, newActor, sql, uid } from "../support/fixtures";

const today = new Date().toISOString().slice(0, 10);
const preview = { state: "preview" } as const;

/** Visible text of a rendered report (tags stripped, whitespace collapsed). */
const textOf = (markup: string) =>
  markup
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

let horizonCache: Promise<Awaited<ReturnType<typeof seedHorizon>> & { actor: Actor }> | undefined;
function horizon() {
  horizonCache ??= (async () => {
    const actor = await newActor();
    return { actor, ...(await seedHorizon(actor, { projectCode: `HORIZON-${uid()}` })) };
  })();
  return horizonCache;
}

/** Synthetic Authorised V1 (VD-01 $1.0m, VD-02 $0.5m, VD-03 non-financial) with a decided, finalised review. */
async function compactDecided() {
  const actor = await newActor();
  const code = `R-${uid()}`;
  const { project } = await seedCompactAuthorised(actor, { code, name: `Reports ${code}` });
  const drivers = await db()
    .select({ id: schema.valueDriver.id, code: schema.valueDriver.code })
    .from(schema.valueDriver)
    .where(eq(schema.valueDriver.projectId, project.id));
  const id = (c: string) => drivers.find((d) => d.code === c)!.id;
  const [valueCase] = await db().select().from(schema.valueCase).where(eq(schema.valueCase.projectId, project.id));
  const vco = valueCase!.vcoPersonId!;
  const review = await createReview(actor, { projectId: project.id, trigger: "ad_hoc", reviewDate: today });
  await upsertValuePositions(actor, {
    reviewId: review.id,
    positions: [
      { valueDriverId: id("VD-01"), currentForecast: "900000.00", realisedValue: "100000.00" },
      { valueDriverId: id("VD-02"), currentForecast: "400000.00" },
      { valueDriverId: id("VD-03"), forecastRationale: "On track" },
    ],
  });
  const quantified = await createLeakage(actor, {
    reviewId: review.id,
    code: "VL-001",
    title: "Late cutover",
    driverIds: [id("VD-01")],
  });
  await assessLeakage(actor, {
    leakageId: quantified.id,
    reviewId: review.id,
    totalAmount: "120000.00",
    unrecoverableAmount: "20000.00",
    unrecoverableRationale: "Two months of benefit already lost",
  });
  await createLeakage(actor, { reviewId: review.id, code: "VL-002", title: "Unsized vendor risk" });
  const current = await upsertScenario(actor, {
    reviewId: review.id,
    label: "Current",
    kind: "current",
    totalValue: "1300000.00",
  });
  const recommended = await upsertScenario(actor, {
    reviewId: review.id,
    label: "Act now",
    kind: "recommended",
    totalValue: "1500000.00",
  });
  const delay = await upsertScenario(actor, {
    reviewId: review.id,
    label: "Delay one quarter",
    kind: "alternative",
    totalValue: "1400000.00",
  });
  await saveRecommendation(actor, { reviewId: review.id, scenarioId: recommended.id, narrative: "Act now" });
  await issueRecommendation(actor, { reviewId: review.id });
  await finaliseReview(actor, { reviewId: review.id });
  const decision = await recordDecision(actor, {
    reviewId: review.id,
    selectedScenarioId: delay.id,
    decidedByPersonId: vco,
    decidedOn: today,
    rationale: "Budget timing",
  });
  return { actor, project, vco, review, decision, current, recommended, delay, A: id("VD-01") };
}

// ---------------------------------------------------------------------------

describe("report read models use the authoritative Value Record", () => {
  it("Re-Qualification: Horizon inherited $18.0m → Authorised V1 $15.5m, movement −$2.5m, six drivers", async () => {
    const h = await horizon();
    const built = (await buildRequalificationReport(h.project.id, h.v1.id))!;
    const ws = await getRequalificationWorkspace(h.project.id);
    expect(built.issuable.ok).toBe(true);
    expect(built.model.inherited!.total).toBe("18000000.00");
    expect(built.model.authorised).toMatchObject({ versionNumber: 1, status: "authorised", total: "15500000.00" });
    expect(built.model.movement).toBe("-2500000.00");
    expect(built.model.drivers).toHaveLength(6);
    // Same figures as the application's read model — not recalculated.
    expect(built.model.inherited!.total).toBe(ws.inheritedTotal);
    expect(built.model.authorised.total).toBe(ws.requalifiedSummary.financialTotal);
    expect(built.model.movement).toBe(ws.movement);

    const text = textOf(renderReportArticle(built.model, preview));
    expect(text).toContain("Inherited Business Case $18.0m → Re-Qualified Value Case $15.5m · Movement -$2.5m");
    expect(text).toContain("Counts only — no score or weighting is applied");
    expect(text).not.toMatch(/score\s*[:=]?\s*\d/i);
  });

  it("Assurance: Horizon authorised $15.5m, forecast $14.7m, gap $0.8m, movement −$0.8m, realised $2.8m unattributed", async () => {
    const h = await horizon();
    const built = (await buildAssuranceReport(h.project.id, h.review.id))!;
    const ws = (await getAssuranceWorkspace(h.project.id, h.review.id))!;
    const p = built.model.position;
    expect(p).toMatchObject({
      authorisedTotal: "15500000.00",
      forecastTotal: "14700000.00",
      valueGap: "800000.00",
      movement: "-800000.00",
      realisedAttributedTotal: null,
      unattributedRealised: HORIZON.assurance.realisedAggregate,
      realisedTotal: "2800000.00",
    });
    for (const k of ["authorisedTotal", "forecastTotal", "valueGap", "movement", "realisedTotal"] as const) {
      expect(p[k]).toBe(ws.totals[k]);
    }
    expect(built.model.drivers.every((d) => d.realisedValue === null)).toBe(true);

    const text = textOf(renderReportArticle(built.model, preview));
    expect(text).toMatch(/Authorised Value \$15\.5m/);
    expect(text).toMatch(/Current Forecast \$14\.7m/);
    expect(text).toMatch(/Value Gap \$0\.8m/);
    expect(text).toMatch(/Movement -\$0\.8m/);
    expect(text).toMatch(/Unattributed Realised \$2\.8m Not allocated to any Value Driver/);
    expect(text).toMatch(/Attributed Realised — No realised value attributed to drivers/);
    expect(text).toContain("Unattributed realised value (not allocated to any Value Driver) $2,800,000");
  });

  it("Assurance: options, recommendation and client decision stay separate; client-elected difference exact", async () => {
    const h = await horizon();
    const m = (await buildAssuranceReport(h.project.id, h.review.id))!.model;
    const response = await getReviewResponse(h.project.id, h.review.id);
    expect(m.scenarios.map((s) => [s.kind, s.totalValue])).toEqual(
      expect.arrayContaining([
        ["current", "14700000.00"],
        ["recommended", "15300000.00"],
      ]),
    );
    expect(m.recommendation).toMatchObject({ totalValue: "15300000.00" });
    expect(m.decision).toMatchObject({ totalValue: "14900000.00", clientElectedDifference: "-400000.00" });
    expect(m.decision!.clientElectedDifference).toBe(response.decision!.clientElectedDifference);
    expect(m.scenarios.find((s) => s.isRecommendation)!.totalValue).toBe("15300000.00");
    expect(m.scenarios.find((s) => s.isClientSelection)!.totalValue).toBe("14900000.00");

    const text = textOf(renderReportArticle(m, preview));
    // Model v2 numbering (Phase 4D.7: Value Case Evolution is section 2).
    const rec = text.slice(text.indexOf("8. Cardaxia recommendation"), text.indexOf("9. Client decision"));
    const dec = text.slice(text.indexOf("9. Client decision"), text.indexOf("10. Value Change"));
    expect(rec).toContain("$15.3m");
    expect(rec).not.toContain("$14.9m");
    expect(dec).toContain("$14.9m");
    expect(dec).toMatch(/Difference vs Cardaxia recommendation -\$0\.4m/);
  });

  it("Assurance: Horizon VL-001 renders as not yet quantified — never $0, never the prototype figures", async () => {
    const h = await horizon();
    const m = (await buildAssuranceReport(h.project.id, h.review.id))!.model;
    const vl = m.leakage.items.find((i) => i.code === "VL-001")!;
    expect(vl.assessment).toBeNull();
    expect(m.leakage.summary).toMatchObject({ itemCount: 1, assessedCount: 0, total: null });

    const markup = renderReportArticle(m, preview);
    const text = textOf(markup);
    const leakage = text.slice(text.indexOf("6. Value Leakage"), text.indexOf("7. Alternative Value Outcomes"));
    expect(leakage).toContain("Not yet quantified");
    expect(leakage).not.toMatch(/\$0(\b|\.)/);
    for (const figure of Object.values(HORIZON.response.prototypeLeakage)) expect(text).not.toContain(figure);
    expect(text).not.toMatch(/0\.70|0\.25m|0\.30m/);
  });

  it("Assurance: Value Gap and Value Leakage are presented as separate measures", async () => {
    const ctx = await compactDecided();
    const m = (await buildAssuranceReport(ctx.project.id, ctx.review.id))!.model;
    expect(m.position.valueGap).toBe("200000.00");
    expect(m.leakage.summary).toMatchObject({ assessedCount: 1, itemCount: 2, total: "120000.00" });
    expect(m.leakage.items.find((i) => i.code === "VL-001")!.assessment).toMatchObject({
      total: "120000.00",
      recoverable: "100000.00",
      unrecoverable: "20000.00",
    });
    const text = textOf(renderReportArticle(m, preview));
    expect(text).toContain("Value Gap and Value Leakage are separate measures and are not added together");
    // No combined figure: gap + leakage (0.2m + 0.12m) never appears.
    expect(text).not.toContain("$320,000");
    expect(text).not.toContain("$0.3m");
    // The unquantified item says so rather than showing zero.
    const row = text.slice(text.indexOf("VL-002 Unsized vendor risk"));
    expect(row).toMatch(/^VL-002 Unsized vendor risk Not specified Not assigned Not yet quantified/);
  });

  it("Value Change Notice: Horizon VC-002 proposed −$0.6m, $15.5m → $14.9m, not reconciled, not ready", async () => {
    const h = await horizon();
    const built = (await buildValueChangeNotice(h.project.id, h.valueChange.id))!;
    const detail = (await getValueChangeDetail(h.project.id, h.valueChange.id))!;
    const m = built.model;
    expect(built.issuable.ok).toBe(true);
    expect(m.change).toMatchObject({ code: "VC-002", status: "proposed", statedChange: "-600000.00" });
    expect(m.current.total).toBe("15500000.00");
    expect(m.projectedFromStated).toBe(HORIZON.response.valueChange.v2IfAuthorised);
    expect(m.actualChange).toBe("0.00");
    expect(m.reconciled).toBe(false);
    expect(m.readyForAuthorisation).toBe(false);
    expect(m.changedDrivers).toEqual([]); // no fabricated allocation
    expect([m.actualChange, m.reconciled]).toEqual([detail.actualChange, detail.reconciled]);

    const text = textOf(renderReportArticle(m, preview));
    expect(text).toContain("Proposed Not reconciled Not ready for authorisation");
    expect(text).toContain("NOT RECONCILED");
    expect(text).toContain("NOT READY FOR AUTHORISATION");
    expect(text).toMatch(/Current authorised value \$15\.5m/);
    expect(text).toMatch(/Stated change -\$0\.6m/);
    expect(text).toMatch(/Proposed authorised value \$14\.9m/);
    expect(text).toContain("No Value Driver has been changed in the proposed version");
  });

  it("Information Request: summary counts and item table", async () => {
    const ctx = await compactDecided();
    const ir = await createInformationRequest(ctx.actor, {
      projectId: ctx.project.id,
      reference: "IR-01",
      title: "Baseline data",
    });
    const a = await addInformationRequestItem(ctx.actor, {
      informationRequestId: ir.id,
      description: "Baseline tickets",
      valueDriverId: ctx.A,
    });
    await addInformationRequestItem(ctx.actor, { informationRequestId: ir.id, description: "Org chart" });
    await updateInformationRequestItem(ctx.actor, { itemId: a.id, status: "partially_received" });
    const built = (await buildInformationRequestReport(ctx.project.id, ir.id))!;
    expect(built.issuable.ok).toBe(false); // draft request
    expect(built.model.summary).toMatchObject({ total: 2, open: 1, partially_received: 1, received: 0 });
    const text = textOf(renderReportArticle(built.model, preview));
    expect(text).toContain("1 Baseline tickets — — VD-01");
    expect(text).toContain("Partial");
  });
});

// ---------------------------------------------------------------------------

describe("issuing reports", () => {
  it("rejects subjects in an invalid state", async () => {
    const ctx = await compactDecided();
    const draft = await createReview(ctx.actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate: today });
    await expectDomainError(
      issueReport(ctx.actor, { type: "assurance", projectId: ctx.project.id, subjectId: draft.id }),
      "VO_REPORT_SUBJECT_INVALID",
    );
    const ir = await createInformationRequest(ctx.actor, { projectId: ctx.project.id, reference: "IR-X", title: "X" });
    await expectDomainError(
      issueReport(ctx.actor, { type: "information_request", projectId: ctx.project.id, subjectId: ir.id }),
      "VO_REPORT_SUBJECT_INVALID",
    );
    const { change } = await createValueChange(ctx.actor, {
      projectId: ctx.project.id,
      code: "VC-001",
      statedChangeAmount: "-100000.00",
    });
    await expectDomainError(
      issueReport(ctx.actor, { type: "value_change_notice", projectId: ctx.project.id, subjectId: change.id }),
      "VO_REPORT_SUBJECT_INVALID",
    );
    // The database guard refuses invalid subjects independently of the command.
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.issueReport, (tx) =>
        tx
          .insert(schema.reportIssue)
          .values(rawIssue(ctx, { type: "assurance", assuranceReviewId: draft.id, subjectStatus: "draft" })),
      ),
      "VO_REPORT_SUBJECT_INVALID",
    );
    const [v2] = await db()
      .select()
      .from(schema.valueCaseVersion)
      .where(eq(schema.valueCaseVersion.id, change.toVersionId));
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.issueReport, (tx) =>
        tx.insert(schema.reportIssue).values(
          rawIssue(ctx, {
            type: "requalification",
            assuranceReviewId: null,
            valueCaseVersionId: v2!.id,
            subjectStatus: "draft",
          }),
        ),
      ),
      "VO_REPORT_SUBJECT_INVALID",
    );
  });

  it("issues a finalised review: valid PDF stored, snapshot tied to the exact review and version, hash stable", async () => {
    const ctx = await compactDecided();
    const issue = await issueReport(ctx.actor, {
      type: "assurance",
      projectId: ctx.project.id,
      subjectId: ctx.review.id,
    });
    expect(issue).toMatchObject({
      type: "assurance",
      assuranceReviewId: ctx.review.id,
      valueCaseVersionId: null,
      subjectStatus: "finalised",
      issueNumber: 1,
      issuedBy: ctx.actor.userId,
    });
    const snapshot = issue.snapshot as AssuranceReport;
    expect(snapshot.review.againstVersion.number).toBe(1);
    expect(snapshot.header.subjectLabel).toBe(`Assurance Review ${ctx.review.sequence}`);

    // Snapshot hash is stable: recomputed from the stored JSON (key order irrelevant).
    const stored = (await getReportIssue(ctx.project.id, issue.id))!;
    expect(sha256(canonicalJson(stored.snapshot))).toBe(stored.snapshotSha256);
    expect(snapshotSha256(stored.snapshot as ReportModel)).toBe(stored.snapshotSha256);

    // PDF is a real PDF and matches its recorded hash.
    const pdf = (await getDocument(stored.documentKey, stored.documentSha256))!;
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.byteLength).toBe(stored.documentBytes);
    expect(sha256(pdf)).toBe(stored.documentSha256);
    expect(pdf.toString("latin1")).toMatch(/\/Type\s*\/Page\b/);

    // A second issue is a new record with the next number; the first is unchanged.
    const second = await issueReport(ctx.actor, {
      type: "assurance",
      projectId: ctx.project.id,
      subjectId: ctx.review.id,
    });
    expect(second.issueNumber).toBe(2);
    expect(second.snapshotSha256).toBe(issue.snapshotSha256); // same record → same snapshot
    const [first] = await db().select().from(schema.reportIssue).where(eq(schema.reportIssue.id, issue.id));
    expect(first).toEqual(stored);
  }, 60_000);

  it("keeps an issued report unchanged when the Value Record later changes", async () => {
    const ctx = await compactDecided();
    const ir = await createInformationRequest(ctx.actor, {
      projectId: ctx.project.id,
      reference: "IR-02",
      title: "Data",
    });
    const item = await addInformationRequestItem(ctx.actor, { informationRequestId: ir.id, description: "Tickets" });
    await issueInformationRequest(ctx.actor, { informationRequestId: ir.id, issuedOn: today });
    const issue = await issueReport(ctx.actor, {
      type: "information_request",
      projectId: ctx.project.id,
      subjectId: ir.id,
    });
    await updateInformationRequestItem(ctx.actor, { itemId: item.id, status: "received" });

    const stored = (await getReportIssue(ctx.project.id, issue.id))!;
    expect((stored.snapshot as { summary: { received: number } }).summary.received).toBe(0);
    expect(sha256(canonicalJson(stored.snapshot))).toBe(issue.snapshotSha256);
    const now = (await buildInformationRequestReport(ctx.project.id, ir.id))!;
    expect(now.model.summary.received).toBe(1);
    expect(snapshotSha256(now.model)).not.toBe(issue.snapshotSha256);
  }, 60_000);

  it("issued reports are immutable: update, delete and truncate are rejected", async () => {
    const ctx = await compactDecided();
    const issue = await issueReport(ctx.actor, {
      type: "assurance",
      projectId: ctx.project.id,
      subjectId: ctx.review.id,
    });
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.issueReport, (tx) =>
        tx.update(schema.reportIssue).set({ title: "Edited" }).where(eq(schema.reportIssue.id, issue.id)),
      ),
      "VO_REPORT_IMMUTABLE",
    );
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.issueReport, (tx) =>
        tx.delete(schema.reportIssue).where(eq(schema.reportIssue.id, issue.id)),
      ),
      "VO_REPORT_IMMUTABLE",
    );
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.issueReport, (tx) => tx.execute(sql`truncate report_issue`)),
      "VO_REPORT_IMMUTABLE",
    );
    const raw = await db()
      .update(schema.reportIssue)
      .set({ title: "x" })
      .where(eq(schema.reportIssue.id, issue.id))
      .then(
        () => "updated",
        (err: Error & { cause?: Error }) => String(err.cause?.message ?? err.message),
      );
    expect(raw).toMatch(/VO_NO_COMMAND_CONTEXT|VO_REPORT_IMMUTABLE/);
    const audit = await db()
      .select()
      .from(schema.auditEvent)
      .where(and(eq(schema.auditEvent.tableName, "report_issue"), eq(schema.auditEvent.rowId, issue.id)));
    expect(audit.map((a) => [a.action, a.command])).toEqual([["INSERT", "reports.issue"]]);
  }, 60_000);

  it("refuses inserts outside reports.issue, stale snapshots and skipped issue numbers", async () => {
    const ctx = await compactDecided();
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.finaliseAssuranceReview, (tx) =>
        tx.insert(schema.reportIssue).values(rawIssue(ctx, {})),
      ),
      "VO_WRONG_COMMAND",
    );
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.issueReport, (tx) =>
        tx.insert(schema.reportIssue).values(rawIssue(ctx, { issueNumber: 2 })),
      ),
      "VO_REPORT_STALE",
    );
    const base = {
      type: "assurance" as const,
      projectId: ctx.project.id,
      subjectId: ctx.review.id,
      issueNumber: 1,
      issuedOn: today,
      issuedByName: "Consultant",
      rendererVersion: "report-html-1",
      document: { key: `reports/${"a".repeat(64)}.pdf`, sha256: "a".repeat(64), bytes: 10 },
    };
    await expectDomainError(
      issueReportCommand(ctx.actor, { ...base, expectedSnapshotSha256: "b".repeat(64) }),
      "VO_REPORT_STALE",
    );
  });

  it("issues a proposed VC Notice as PROPOSED, and an authorised one after VCO authorisation", async () => {
    const ctx = await compactDecided();
    const { change, version } = await createValueChange(ctx.actor, {
      projectId: ctx.project.id,
      code: "VC-001",
      statedChangeAmount: "-100000.00",
      reason: "Client elected to delay",
      assuranceReviewId: ctx.review.id,
      decisionId: ctx.decision.id,
    });
    const [vA] = await db()
      .select()
      .from(schema.valueDriverVersion)
      .where(
        and(
          eq(schema.valueDriverVersion.valueCaseVersionId, version.id),
          eq(schema.valueDriverVersion.valueDriverId, ctx.A),
        ),
      );
    await updateDriverVersion(ctx.actor, { driverVersionId: vA!.id, financialValue: "900000.00" });
    await proposeValueChange(ctx.actor, { changeId: change.id });

    const proposed = await issueReport(ctx.actor, {
      type: "value_change_notice",
      projectId: ctx.project.id,
      subjectId: change.id,
    });
    expect(proposed).toMatchObject({ subjectStatus: "proposed", issueNumber: 1, valueChangeId: change.id });
    const pm = proposed.snapshot as ReportModel & { readyForAuthorisation: boolean; reconciled: boolean };
    expect([pm.reconciled, pm.readyForAuthorisation]).toEqual([true, true]);

    const evidence = await recordEvidence(ctx.actor, {
      projectId: ctx.project.id,
      code: `E-${uid()}`,
      title: "VCO sign-off",
    });
    await authoriseValueChange(ctx.actor, {
      changeId: change.id,
      authorisedByPersonId: ctx.vco,
      authorisedOn: today,
      authorisationEvidenceId: evidence.id,
    });
    const authorised = await issueReport(ctx.actor, {
      type: "value_change_notice",
      projectId: ctx.project.id,
      subjectId: change.id,
    });
    expect(authorised).toMatchObject({ subjectStatus: "authorised", issueNumber: 2 });
    const text = textOf(
      renderReportDocument(authorised.snapshot as ReportModel, {
        state: "issued",
        issueNumber: 2,
        issuedOn: today,
        issuedBy: "C",
      }),
    );
    expect(text).toContain("V1 · $1,500,000 — superseded and preserved unchanged");
    expect(text).toContain("V2 · $1,400,000");
    expect(text).toContain("Client-elected difference -$0.1m");

    // The proposed issue is untouched by the later authorisation.
    expect((await getReportIssue(ctx.project.id, proposed.id))!.subjectStatus).toBe("proposed");

    // Re-Qualification of the now-superseded V1 remains issuable and labelled as such.
    const [v1] = await db()
      .select()
      .from(schema.valueCaseVersion)
      .where(and(eq(schema.valueCaseVersion.projectId, ctx.project.id), eq(schema.valueCaseVersion.versionNumber, 1)));
    const rq = await issueReport(ctx.actor, { type: "requalification", projectId: ctx.project.id, subjectId: v1!.id });
    expect(rq).toMatchObject({ subjectStatus: "superseded", valueCaseVersionId: v1!.id });
  }, 90_000);
});

describe("no floating-point money in the report layer", () => {
  it("report modules never convert amounts to JavaScript numbers", () => {
    const root = path.resolve(import.meta.dirname, "../../src");
    // Recursive: includes the Phase 4D.7 server-side SVG chart modules (ui/reports/charts).
    const tree = (dir: string): string[] =>
      readdirSync(path.join(root, dir), { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".ts"))
        .map((f) => path.join(root, dir, f));
    const files = [
      ...tree("ui/reports"),
      ...tree("server/reports"),
      path.join(root, "server/queries/reports.ts"),
      path.join(root, "domain/reports.ts"),
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/parseFloat|parseInt|(?<![A-Za-z])Number\(|Math\.|\.toFixed\(\s*\)|\+\s*Number/);
      expect(source, file).not.toMatch(/\bvalue\w*\s*[*/]\s*\d/);
    }
  });
});

function rawIssue(
  ctx: Awaited<ReturnType<typeof compactDecided>>,
  over: Partial<typeof schema.reportIssue.$inferInsert>,
): typeof schema.reportIssue.$inferInsert {
  return {
    projectId: ctx.project.id,
    type: "assurance",
    assuranceReviewId: ctx.review.id,
    subjectStatus: "finalised",
    issueNumber: 1,
    title: "Raw",
    snapshot: {},
    snapshotSha256: "a".repeat(64),
    rendererVersion: "raw",
    documentKey: `reports/${"a".repeat(64)}.pdf`,
    documentSha256: "a".repeat(64),
    documentBytes: 1,
    issuedBy: ctx.actor.userId,
    issuedByName: "Raw",
    ...over,
  };
}
