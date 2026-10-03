import { createHash } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import { todayIso } from "@/domain/attention";
import { money, sumMoney, toDbMoney } from "@/domain/money";
import type { AssuranceReport, ReportModel, RequalificationReport, ValueChangeNotice } from "@/domain/reports";
import { terminalReconciliation } from "@/domain/trajectory";
import { CANONICAL, canonicalJourney } from "@/fixtures/canonical";
import { seedCompactDecision } from "@/fixtures/compact";
import { proposeValueChange, authoriseValueChange } from "@/server/commands/value-change";
import { recordEvidence } from "@/server/commands/evidence";
import { db, schema } from "@/server/db/client";
import { getAssuranceWorkspace } from "@/server/queries/assurance";
import { getValueCaseEvolution } from "@/server/queries/evolution";
import { getExecutiveOverview } from "@/server/queries/overview";
import { getContinuousAssurance, getValueChangeDetail } from "@/server/queries/response";
import { buildReport, getReportIssue } from "@/server/queries/reports";
import { getReviewStory } from "@/server/queries/review-story";
import { getAlternativeValueTrajectories, getValueTrajectoryChart } from "@/server/queries/trajectory";
import { getValueCaseSummary } from "@/server/queries/value-case-summary";
import { issueReport } from "@/server/reports/issue";
import { getDocument } from "@/server/reports/storage";
import { formatDate, formatMoneyShort } from "@/ui/format";
import { LatestValueDecision } from "@/ui/overview/decision";
import { renderReportDocument } from "@/ui/reports/render";
import { buildTrajectoryPresentation, epoch } from "@/ui/trajectory/model";

import { newActor, uid } from "../support/fixtures";
import { atDateWithoutObservation, untraced } from "../support/tooltip-trace";

// Phase 4D.9K: the canonical end-to-end Value Office journey, validated through commands and every governed surface.
// One synthetic project (src/fixtures/canonical.ts): V0 $32.0m → Authorised V1 $30.0m with plan → Reviews #1/#2 →
// VL-001 → options → recommendation (Act now $29.0m) → decision (Delay 3 months $27.0m) → VC-001 −$3.0m (adopted Delay path) → Authorised
// V2 $27.0m with the Delay path's phasing → Review #3 against V2 (4D.9N.1A story). Client reports are issued at their lifecycle points and must
// never change afterwards. The steps run in order and share state.

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const preview = { state: "preview" } as const;
const C = CANONICAL;
const sum = (xs: readonly string[]) => toDbMoney(sumMoney(xs));

type Issued = { id: string; snapshotSha256: string; renderSha: string; documentSha256: string; snapshotJson: string };
const issued: Record<string, Issued> = {};

let actor: Awaited<ReturnType<typeof newActor>>;
let j: ReturnType<typeof canonicalJourney>;
let s: ReturnType<typeof canonicalJourney>["state"];
let v1Frozen: string;

async function issue(key: string, type: Parameters<typeof issueReport>[1]["type"], subjectId: string) {
  const row = await issueReport(actor, { type, projectId: s.project.id, subjectId });
  const doc = await getDocument(row.documentKey, row.documentSha256); // verified against the recorded hash
  expect(doc).not.toBeNull();
  issued[key] = {
    id: row.id,
    snapshotSha256: row.snapshotSha256,
    renderSha: sha(renderReportDocument(row.snapshot as ReportModel, preview)),
    documentSha256: row.documentSha256,
    snapshotJson: JSON.stringify(row.snapshot),
  };
  return row.snapshot as ReportModel;
}

/** Every issued report is exactly as issued: snapshot, its fingerprint, its rendering and its PDF. */
async function expectReportsUnchanged() {
  for (const [key, before] of Object.entries(issued)) {
    const now = (await getReportIssue(s.project.id, before.id))!;
    expect(JSON.stringify(now.snapshot), key).toBe(before.snapshotJson);
    expect(now.snapshotSha256, key).toBe(before.snapshotSha256);
    expect(now.documentSha256, key).toBe(before.documentSha256);
    expect(await getDocument(now.documentKey, before.documentSha256), key).not.toBeNull(); // PDF bytes unchanged
    expect(sha(renderReportDocument(now.snapshot as ReportModel, preview)), key).toBe(before.renderSha);
  }
}

/** All value_trajectory_point rows of the project, with parent and governing context. */
async function trajectoryRows() {
  return db().select().from(schema.valueTrajectoryPoint).where(eq(schema.valueTrajectoryPoint.projectId, s.project.id));
}

async function v1State() {
  const [v1] = await db().select().from(schema.valueCaseVersion).where(eq(schema.valueCaseVersion.id, s.v1.id));
  const drivers = await db()
    .select()
    .from(schema.valueDriverVersion)
    .where(eq(schema.valueDriverVersion.valueCaseVersionId, s.v1.id));
  const plan = await db()
    .select()
    .from(schema.valueTrajectoryPoint)
    .where(eq(schema.valueTrajectoryPoint.valueCaseVersionId, s.v1.id));
  const { status, supersededAt, updatedAt, ...frozen } = v1! as typeof v1 & {
    supersededAt?: unknown;
    updatedAt?: unknown;
  };
  void status;
  void supersededAt;
  void updatedAt;
  return JSON.stringify({ frozen, drivers: drivers.sort((a, b) => a.id.localeCompare(b.id)), plan });
}

describe("canonical Value Office journey (4D.9K)", () => {
  beforeAll(async () => {
    actor = await newActor();
    j = canonicalJourney(actor, { code: `CANON-${uid()}`, name: "Canonical Value Journey" });
    s = j.state;
  });

  it("1–4. V0 → Re-Qualification → Authorised V1 with a reconciled plan; Re-Qualification Report issued", async () => {
    await j.establish({ inherited: true });
    const summary = await getValueCaseSummary(s.project.id, await getValueCaseEvolution(s.project.id));
    expect(summary).toMatchObject({
      current: { versionNumber: 1, authorisedValue: C.v1.total, authorisedOn: C.v1.authorisedOn },
      originalBusinessCase: { value: C.originalBusinessCase },
      authorisedChangeCount: 0,
      pending: [],
    });
    const chart = await getValueTrajectoryChart(s.project.id);
    expect(chart).toMatchObject({ status: "ready", measure: "cumulative", latestFormal: null });
    expect(chart.plan.map((p) => [p.asOf, p.value])).toEqual(C.v1.plan.map(([a, v]) => [a, v]));
    expect(terminalReconciliation(chart.plan, C.valuePeriod.end, C.v1.total).state).toBe("reconciled");

    const rq = (await issue("requalification", "requalification", s.v1.id)) as RequalificationReport;
    expect(rq).toMatchObject({
      inherited: { total: C.originalBusinessCase },
      authorised: { versionNumber: 1, total: C.v1.total, authorisedOn: C.v1.authorisedOn },
      movement: "-2000000.00",
      plan: { versionNumber: 1, valueBasisKind: "cumulative_benefit", total: C.v1.total },
    });
    v1Frozen = await v1State();
  }, 120_000);

  it("5–16. Continuous Assurance → Reviews #1/#2 → realised, forecast, Value Gap, Value Leakage, options, decision", async () => {
    await j.assure();
    const r1 = (await getAssuranceWorkspace(s.project.id, s.review1.id))!;
    const r2 = (await getAssuranceWorkspace(s.project.id, s.review2.id))!;
    expect(r1.totals).toMatchObject({ forecastTotal: sum(C.review1.forecast), realisedTotal: sum(C.review1.realised) });
    expect(r2.totals).toMatchObject({
      authorisedTotal: C.v1.total,
      forecastTotal: "26000000.00",
      realisedTotal: "4000000.00",
      valueGap: "4000000.00", // Authorised − Formal Forecast
    });
    expect(r2.againstVersion.versionNumber).toBe(1);

    // Continuous Assurance: the living matter, its working evidence, and its formal assessment in Review #2.
    const ca = await getContinuousAssurance(s.project.id);
    const vl = ca.open.find((e) => e.leakage.code === "VL-001")!;
    expect(vl.latestFinalised!.amounts).toEqual({
      total: "700000.00",
      recoverable: "450000.00",
      unrecoverable: "250000.00",
    });
    expect(vl.working).toBeNull(); // no working figure was entered; the formal one is not copied back
    const matterEvidence = await db()
      .select()
      .from(schema.evidenceLink)
      .where(eq(schema.evidenceLink.valueLeakageId, s.matter.id));
    expect(matterEvidence).toHaveLength(1); // working evidence on the living matter

    // Recommendation ≠ decision; neither changes the Authorised Value Case.
    const story = (await getReviewStory(s.project.id, s.review2.id))!;
    expect(story.recommendation).toMatchObject({ issued: true, label: "Act now", totalValue: "29000000.00" });
    expect(story.decision).toMatchObject({
      label: "Delay 3 months",
      totalValue: "27000000.00",
      decidedOn: j.today,
      differenceFromRecommendation: "-2000000.00",
    });
    expect(story.valueChanges).toEqual([]);
    expect((await getValueCaseSummary(s.project.id, await getValueCaseEvolution(s.project.id))).current).toMatchObject({
      versionNumber: 1,
      authorisedValue: C.v1.total,
    });
    expect(await v1State()).toBe(v1Frozen);
  }, 120_000);

  it("34 (stage B). cross-surface reconciliation at Review #2 (V1 in force); Value Assurance Report issued", async () => {
    const o = await getExecutiveOverview(s.project.id, j.today);
    const alt = (await getAlternativeValueTrajectories(s.project.id, s.review2.id))!;
    const story = (await getReviewStory(s.project.id, s.review2.id))!;
    const chart = await getValueTrajectoryChart(s.project.id, { today: j.today });
    const va = (await issue("assurance-r2", "assurance", s.review2.id)) as AssuranceReport;

    // The matrix: one expected value per governed concept, read from every surface that shows it.
    const M = {
      authorised: C.v1.total,
      realised: "4000000.00",
      forecast: "26000000.00",
      gap: "4000000.00",
      leakage: { total: "700000.00", recoverable: "450000.00", unrecoverable: "250000.00" },
      recommended: ["Act now", "29000000.00"],
      selected: ["Delay 3 months", "27000000.00"],
      difference: "-2000000.00",
      formalDate: C.review2.date,
      period: C.valuePeriod,
    };
    // Overview
    expect(o.authorised).toEqual({ versionNumber: 1, total: M.authorised });
    expect(o.formal).toMatchObject({ sequence: 2, date: M.formalDate, againstVersionNumber: 1 });
    expect(o.formal!.totals).toMatchObject({ realisedTotal: M.realised, forecastTotal: M.forecast, valueGap: M.gap });
    expect(o.attention.matter!.formal!.amounts).toEqual(M.leakage);
    expect(o.decision.recorded!.differenceFromRecommendation).toBe(M.difference);
    expect(o.valueCase.originalBusinessCase).toEqual({ value: C.originalBusinessCase });
    // Primary trajectory
    expect(chart.period).toEqual(M.period);
    expect(chart.latestFormal).toMatchObject({ reviewDate: M.formalDate, forecastTotal: M.forecast });
    expect(chart.realised!.checkpoints.at(-1)).toEqual({ sequence: 2, asOf: M.formalDate, value: M.realised });
    // Review story and alternatives
    expect(story.position).toMatchObject({ authorisedTotal: M.authorised, forecastTotal: M.forecast, valueGap: M.gap });
    expect(story.matters[0]!.leakage).toEqual(M.leakage);
    expect(alt.decisionComparison).toEqual({
      recommended: { label: M.recommended[0], totalValue: M.recommended[1] },
      selected: { label: M.selected[0], totalValue: M.selected[1] },
      difference: M.difference,
    });
    // Value Assurance Report snapshot (the stored, issued record)
    expect(va.position).toMatchObject({
      authorisedTotal: M.authorised,
      realisedTotal: M.realised,
      forecastTotal: M.forecast,
      valueGap: M.gap,
    });
    expect(va.review).toMatchObject({ reviewDate: M.formalDate, againstVersion: { number: 1 } });
    expect(va.leakage.items[0]!.assessment).toMatchObject(M.leakage);
    expect(va.recommendation).toMatchObject({ label: M.recommended[0], totalValue: M.recommended[1] });
    expect(va.decision).toMatchObject({
      label: M.selected[0],
      totalValue: M.selected[1],
      clientElectedDifference: M.difference,
    });
    expect(va.trajectory!.plan.period).toEqual(M.period);
    expect(va.trajectory!.formal).toEqual({ sequence: 2, reviewDate: M.formalDate, forecastTotal: M.forecast });
    expect(va.alternatives!.decisionComparison!.difference).toBe(M.difference);
    // Value Gap ≠ Value Leakage: different numbers, never added or netted.
    expect(M.gap).not.toBe(M.leakage.total);
    const rendered = renderReportDocument(va, preview);
    expect(rendered).toContain("Value Leakage is assessed per matter; it is not the Value Gap.");
    expect(rendered).not.toContain(toDbMoney(money(M.gap).plus(money(M.leakage.total))));
    expect(rendered).not.toMatch(/>Today</);
  }, 120_000);

  it("17–18/26/32. Value Change: draft and proposed are not in force; it reconciles; Value Change Notice issued", async () => {
    await j.change();
    let summary = await getValueCaseSummary(s.project.id, await getValueCaseEvolution(s.project.id));
    expect(summary.current!.versionNumber).toBe(1);
    expect(summary.pending).toEqual([
      expect.objectContaining({
        code: "VC-001",
        status: "draft",
        toVersionNumber: 2,
        statedChange: C.valueChange.stated,
        proposedChange: C.valueChange.stated, // VD-01 $15.0m → $12.0m: −$3.0m, reconciles
        reconciled: true,
      }),
    ]);
    // The Overview never plots the draft plan.
    const chart = await getValueTrajectoryChart(s.project.id);
    expect(chart.version!.versionNumber).toBe(1);
    expect(chart.plan.map((p) => p.value)).toEqual(C.v1.plan.map(([, v]) => v));

    await j.proposeChange();
    summary = await getValueCaseSummary(s.project.id, await getValueCaseEvolution(s.project.id));
    expect(summary.current!.versionNumber).toBe(1);
    expect(summary.pending[0]).toMatchObject({ status: "proposed", reconciled: true });
    const detail = (await getValueChangeDetail(s.project.id, s.change.id))!;
    expect(detail).toMatchObject({ actualChange: C.valueChange.stated, reconciled: true });
    expect(detail.toVersion.status).toBe("proposed");

    const vcn = (await issue("vcn-proposed", "value_change_notice", s.change.id)) as ValueChangeNotice;
    expect(vcn).toMatchObject({
      change: { status: "proposed", statedChange: C.valueChange.stated },
      current: { versionNumber: 1, total: C.v1.total },
      proposed: { versionNumber: 2, total: "27000000.00" },
      actualChange: C.valueChange.stated,
      reconciled: true,
      readyForAuthorisation: true,
      origin: { review: { sequence: 2 }, decision: { label: "Delay 3 months" } },
    });
    expect(vcn.plans!.to.milestones.map((p) => [p.asOf, p.value])).toEqual(
      C.valueChange.v2Plan.map(([a, v]) => [a, v]),
    );
    expect(renderReportDocument(vcn, preview)).toContain("Proposed change -$3.0m — not in force.");
    expect(await v1State()).toBe(v1Frozen);
  }, 120_000);

  it("19–23/27–33. VCO authorisation: V2 in force, V1 superseded and unchanged, trajectory and Evolution move to V2", async () => {
    await j.authoriseChange();
    expect(await v1State()).toBe(v1Frozen); // V1's content, drivers and plan are untouched
    const [v1] = await db().select().from(schema.valueCaseVersion).where(eq(schema.valueCaseVersion.id, s.v1.id));
    expect(v1!.status).toBe("superseded");

    const o = await getExecutiveOverview(s.project.id, j.today);
    expect(o.authorised).toEqual({ versionNumber: 2, total: "27000000.00" });
    expect(o.valueCase).toMatchObject({
      current: { versionNumber: 2, authorisedValue: "27000000.00", authorisedOn: j.today },
      authorisedChangeCount: 1,
      latestAuthorisedChange: { code: "VC-001", versionNumber: 2, authorisedOn: j.today },
      pending: [],
    });
    const chart = await getValueTrajectoryChart(s.project.id, { today: j.today });
    expect(chart.version).toEqual({ versionNumber: 2, total: "27000000.00" });
    expect(chart.plan.map((p) => [p.asOf, p.value])).toEqual(C.valueChange.v2Plan.map(([a, v]) => [a, v]));
    expect(terminalReconciliation(chart.plan, C.valuePeriod.end, "27000000.00").state).toBe("reconciled");
    expect(chart.versionChange).toEqual({ code: "VC-001", versionNumber: 2, authorisedOn: j.today, inPeriod: true });
    expect(chart.notes).toContain("formal_measured_against_earlier_version"); // Review #2 was against V1

    const evolution = await getValueCaseEvolution(s.project.id);
    expect(evolution.events.map((e) => e.key)).toEqual(["original", "v1", "r1", "r2", "v2"]);
    expect(
      evolution.authorisedVersions.map((v) => [v.versionNumber, v.status, v.authorisedValue, v.valueChangeCode]),
    ).toEqual([
      [1, "superseded", C.v1.total, null],
      [2, "authorised", "27000000.00", "VC-001"],
    ]);

    // The authorised notice is a second issue; the proposed one stays as issued.
    const vcn2 = (await issue("vcn-authorised", "value_change_notice", s.change.id)) as ValueChangeNotice;
    expect(vcn2.change.status).toBe("authorised");
    expect(vcn2.authorisation).toMatchObject({ authorisedOn: j.today });
    await expectReportsUnchanged();
  }, 120_000);

  it("24/33. historical Review #2 keeps its V1 meaning after V2 (live and in its issued report)", async () => {
    const r2 = (await getAssuranceWorkspace(s.project.id, s.review2.id))!;
    expect(r2.againstVersion.versionNumber).toBe(1);
    expect(r2.totals).toMatchObject({
      authorisedTotal: C.v1.total,
      forecastTotal: "26000000.00",
      valueGap: "4000000.00",
    });
    const story = (await getReviewStory(s.project.id, s.review2.id))!;
    expect(story.review.againstVersionNumber).toBe(1);
    expect(story.valueChanges).toEqual([
      expect.objectContaining({
        code: "VC-001",
        status: "authorised",
        fromVersionNumber: 1,
        toVersionNumber: 2,
        linkedBy: ["review", "decision"],
      }),
    ]);
    // A live rebuild of the Review #2 report still describes Review #2 against V1, with the same trajectory.
    const live = (await buildReport("assurance", s.project.id, s.review2.id))!.model as AssuranceReport;
    const stored = JSON.parse(issued["assurance-r2"]!.snapshotJson) as AssuranceReport;
    // Same economics, dates and milestones; only V1's lifecycle status has moved on (issued record keeps "authorised").
    expect({ ...live.trajectory!, plan: { ...live.trajectory!.plan, status: "x" } }).toEqual({
      ...stored.trajectory!,
      plan: { ...stored.trajectory!.plan, status: "x" },
    });
    expect([stored.trajectory!.plan.status, live.trajectory!.plan.status]).toEqual(["authorised", "superseded"]);
    expect(live.trajectory!.plan.versionNumber).toBe(1);
    expect(live.alternatives).toEqual(stored.alternatives);
    expect(live.position).toEqual(stored.position);
  }, 120_000);

  it("35. Assurance continues against V2 (Review #3); Today and the formal position coincide; reports unchanged", async () => {
    await j.continueAssurance();
    const r3 = (await getAssuranceWorkspace(s.project.id, s.review3.id))!;
    expect(r3.againstVersion.versionNumber).toBe(2);
    expect(r3.totals).toMatchObject({
      authorisedTotal: "27000000.00",
      forecastTotal: "25000000.00",
      realisedTotal: "4600000.00",
      valueGap: "2000000.00",
    });
    const chart = await getValueTrajectoryChart(s.project.id, { today: j.today });
    expect(chart.realised!.checkpoints.map((c) => [c.sequence, c.value])).toEqual([
      [1, "1000000.00"],
      [2, "4000000.00"],
      [3, "4600000.00"],
    ]);
    // 4D.9N.1B.1: Review #3's explicit formal milestones carry the timing of the variance — aligned with V2 at Dec 2026,
    // $1.0m below at Dec 2027, $2.0m below at the period end. Chart joins never carry it.
    expect(chart.forecast!.points.map((p) => [p.asOf, p.value])).toEqual([
      ["2026-12-31", "5000000.00"],
      ["2027-12-31", "15500000.00"],
      ["2028-12-31", "25000000.00"],
    ]);
    const plan = new Map(chart.plan.map((p) => [p.asOf, p.value]));
    expect(
      chart.forecast!.points.map((p) => [p.asOf, toDbMoney(money(p.value).minus(money(plan.get(p.asOf)!)))]),
    ).toEqual([
      ["2026-12-31", "0.00"],
      ["2027-12-31", "-1000000.00"],
      ["2028-12-31", "-2000000.00"],
    ]);
    const p3 = buildTrajectoryPresentation(chart, "USD")!;
    const dec26 = p3.rows.find((r) => r.t === epoch("2026-12-31"))!;
    expect([dec26.plan, dec26.forecast, dec26.forecastAnchor, dec26.month]).toEqual([5000000, 5000000, false, false]);
    expect(p3.gap).toMatchObject({ plan: 27000000, forecast: 25000000, label: "Value Gap · $2.0m" });
    const governed = new Set(
      [
        ...chart.plan.map((x) => x.value),
        "0.00",
        ...chart.realised!.checkpoints.map((x) => x.value),
        ...chart.forecast!.points.map((x) => x.value),
        chart.version!.total,
        chart.latestFormal!.forecastTotal!,
        "2000000.00", // Value Gap at Value Period end = $27.0m − $25.0m
      ].map((v) => formatMoneyShort(v, "USD")),
    );
    expect(
      untraced(
        p3.rows.map((r) => r.cursor),
        governed,
      ),
    ).toEqual([]);
    expect(atDateWithoutObservation(p3.rows)).toEqual([]);
    expect(chart.notes).toEqual([]);
    expect(chart.today).toEqual({ asOf: j.today, inPeriod: true });
    expect(chart.latestFormal!.reviewDate).toBe(j.today); // same calendar day → one combined marker in the web chart
    // 4D.9L: the latest formal position (Review #3) and the latest recorded value decision (Review #2) are distinct.
    const o = await getExecutiveOverview(s.project.id, j.today);
    expect(o.formal).toMatchObject({ sequence: 3, date: j.today, againstVersionNumber: 2 });
    expect(o.decision.awaiting).toBeNull(); // Review #3 made no recommendation
    const rd = o.decision.recorded!;
    expect(rd.review).toMatchObject({ id: s.review2.id, sequence: 2, date: C.review2.date, againstVersionNumber: 1 });
    expect(rd.decision!.decidedOn).toBe(j.today);
    expect(rd.outcomes.find((x) => x.recommended)).toMatchObject({ label: "Act now", totalValue: "29000000.00" });
    expect(rd.outcomes.find((x) => x.selected)).toMatchObject({ label: "Delay 3 months", totalValue: "27000000.00" });
    expect(rd.differenceFromRecommendation).toBe("-2000000.00");
    const html = renderToStaticMarkup(createElement(LatestValueDecision, { o, base: "/p" }))
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    expect(html).toContain("Latest recorded value decision");
    expect(html).toContain("Source: Review #2 · formal position as at 30 Sept 2026 · against V1");
    expect(html).toContain(`Decision ${formatDate(j.today)}`);
    expect(html).toContain(
      `Recorded at Review #2. The latest formal position (Review #3 · ${formatDate(j.today)}) records no Cardaxia recommendation or management decision.`,
    );
    expect(html).not.toMatch(/Source: Review #3/);
    await expectReportsUnchanged();
    const rq = JSON.parse(issued["requalification"]!.snapshotJson) as RequalificationReport;
    expect(JSON.stringify(rq)).not.toMatch(/Review|realised|VL-001|VC-001/); // no later Assurance in the V1 report
  }, 120_000);

  it("I. every stored trajectory point is owned, dated, in period and reconciled; nothing interpolated", async () => {
    const rows = await trajectoryRows();
    const versions = await db()
      .select()
      .from(schema.valueCaseVersion)
      .where(eq(schema.valueCaseVersion.projectId, s.project.id));
    const v0 = versions.find((v) => v.versionNumber === 0)!;
    expect(rows.some((r) => r.valueCaseVersionId === v0.id)).toBe(false); // no V0 trajectory
    for (const r of rows) {
      const parents = [r.valueCaseVersionId, r.assuranceReviewId, r.scenarioId].filter(Boolean);
      expect(parents).toHaveLength(1);
      expect(r.asOf >= C.valuePeriod.start && r.asOf <= C.valuePeriod.end).toBe(true);
    }
    const ofVersion = (id: string) => rows.filter((r) => r.valueCaseVersionId === id);
    expect(terminalReconciliation(ofVersion(s.v1.id), C.valuePeriod.end, C.v1.total).state).toBe("reconciled");
    expect(terminalReconciliation(ofVersion(s.v2.id), C.valuePeriod.end, "27000000.00").state).toBe("reconciled");
    for (const [review, forecast] of [
      [s.review2, "26000000.00"],
      [s.review3, "25000000.00"],
    ] as const) {
      const fp = rows.filter((r) => r.assuranceReviewId === review.id);
      expect(terminalReconciliation(fp, C.valuePeriod.end, forecast).state).toBe("reconciled");
      expect(fp.every((p) => p.asOf > review.reviewDate)).toBe(true); // after the review date only
    }
    const scenarios = await db()
      .select()
      .from(schema.scenario)
      .where(
        inArray(
          schema.scenario.id,
          Object.values(s.scenarios).map((x) => x.id),
        ),
      );
    for (const sc of scenarios) {
      const op = rows.filter((r) => r.scenarioId === sc.id);
      expect(terminalReconciliation(op, C.valuePeriod.end, sc.totalValue).state).toBe("reconciled");
      expect(op.every((p) => p.asOf > C.review2.date)).toBe(true);
    }
    // Only explicitly entered milestones exist: 4 (V1) + 4 (V2) + 2 (Review #2 forecast) + 3 (Review #3 forecast, incl. the
    // 31 Dec 2026 $5.0m milestone, 4D.9N.1B.1) + options 2 (Act now) + 3 (No action) + 3 (Delay 3 months) — the two
    // 30 Dec 2026 scenario milestones are the stored delayed-action pivot (4D.9N.1A).
    expect(rows).toHaveLength(4 + 4 + 2 + 3 + 2 + 3 + 3);
    expect(rows.filter((r) => r.assuranceReviewId === s.review2.id)).toHaveLength(2);
    expect(
      rows
        .filter((r) => r.asOf === "2026-12-31" && !r.scenarioId)
        .map((r) => [
          r.valueCaseVersionId === s.v1.id ? "V1 plan" : r.valueCaseVersionId === s.v2.id ? "V2 plan" : "",
          r.assuranceReviewId === s.review3.id ? "Review #3 forecast" : r.assuranceReviewId ? "other review" : "",
          r.value,
        ])
        .sort(),
    ).toEqual([
      ["", "Review #3 forecast", "5000000.00"], // the only added point (4D.9N.1B.1)
      ["V1 plan", "", "6000000.00"],
      ["V2 plan", "", "5000000.00"],
    ]);
    const pivot = rows.filter((r) => r.scenarioId && r.asOf === "2026-12-30");
    expect(pivot.map((r) => [r.value, r.note]).sort((x, y) => String(x[1]).localeCompare(String(y[1])))).toEqual([
      ["5000000.00", "Management acts — delayed action"],
      ["5000000.00", null],
    ]);
  });

  it("H. temporal order: nothing happens before the event that enables it", async () => {
    const [rec] = await db()
      .select()
      .from(schema.recommendation)
      .where(eq(schema.recommendation.assuranceReviewId, s.review2.id));
    const [vc] = await db().select().from(schema.valueChange).where(eq(schema.valueChange.id, s.change.id));
    const [matter] = await db().select().from(schema.valueLeakage).where(eq(schema.valueLeakage.id, s.matter.id));
    const issuedOn = rec!.issuedAt!.toISOString().slice(0, 10);
    const order = [
      ["Value Period start", C.valuePeriod.start],
      ["V1 authorised", C.v1.authorisedOn],
      ["Review #1", C.review1.date],
      ["VL-001 identified", matter!.identifiedOn!],
      ["Review #2", C.review2.date],
      ["recommendation issued", issuedOn],
      ["decision", s.decision.decidedOn],
      ["VC-001 authorised", vc!.authorisedOn!],
      ["Review #3", s.review3.reviewDate],
    ] as const;
    for (let i = 1; i < order.length; i++) {
      expect(order[i]![1] >= order[i - 1]![1], `${order[i - 1]![0]} ≤ ${order[i]![0]}`).toBe(true);
    }
    expect(s.review3.reviewDate <= todayIso()).toBe(true);
    expect(C.valuePeriod.end > s.review3.reviewDate).toBe(true);
  });
});

describe("canonical governance gates (separate projects)", () => {
  it("27. a $0 phasing-only Value Change re-phases V2 without changing the Authorised Value", async () => {
    const a = await newActor();
    const k = canonicalJourney(a, { code: `PH-${uid()}`, name: "Phasing only" });
    const st = await k.establish({ inherited: true });
    const { createValueChange } = await import("@/server/commands/value-change");
    const { removePlanPoint, setPlanPoint } = await import("@/server/commands/trajectory");
    const { change, version } = await createValueChange(a, {
      projectId: st.project.id,
      code: "VC-001",
      reason: "Re-phase only",
      statedChangeAmount: "0.00",
    });
    const pts = await db()
      .select()
      .from(schema.valueTrajectoryPoint)
      .where(eq(schema.valueTrajectoryPoint.valueCaseVersionId, version.id));
    await removePlanPoint(a, { pointId: pts.find((p) => p.asOf === "2026-12-31")!.id });
    await setPlanPoint(a, { versionId: version.id, asOf: "2027-03-31", value: "6000000.00" });
    await proposeValueChange(a, { changeId: change.id });
    const ev = await recordEvidence(a, { projectId: st.project.id, code: "E-9", title: "VCO approval" });
    await authoriseValueChange(a, {
      changeId: change.id,
      authorisedByPersonId: st.vco.id,
      authorisedOn: k.today,
      authorisationEvidenceId: ev.id,
    });
    const chart = await getValueTrajectoryChart(st.project.id);
    expect(chart.version).toEqual({ versionNumber: 2, total: C.v1.total });
    expect(chart.plan.map((p) => p.asOf)).toContain("2027-03-31");
    expect(chart.plan.map((p) => p.asOf)).not.toContain("2026-12-31");
  }, 60_000);

  it("M. a Value Change that does not reconcile cannot be authorised", async () => {
    const a = await newActor();
    const { project } = await seedCompactDecision(a, { code: `DC-${uid()}`, name: "Decision Compact" });
    const [vc] = await db()
      .select()
      .from(schema.valueChange)
      .where(and(eq(schema.valueChange.projectId, project.id), eq(schema.valueChange.code, "VC-001")));
    const detail = (await getValueChangeDetail(project.id, vc!.id))!;
    expect(detail.reconciled).toBe(false); // stated +$250k; drivers unchanged
    const [valueCase] = await db().select().from(schema.valueCase).where(eq(schema.valueCase.projectId, project.id));
    const ev = await recordEvidence(a, { projectId: project.id, code: "E-9", title: "Approval" });
    const attempt = async () => {
      await proposeValueChange(a, { changeId: vc!.id });
      await authoriseValueChange(a, {
        changeId: vc!.id,
        authorisedByPersonId: valueCase!.vcoPersonId!,
        authorisedOn: todayIso(),
        authorisationEvidenceId: ev.id,
      });
    };
    await expect(attempt()).rejects.toThrow();
    const [after] = await db().select().from(schema.valueChange).where(eq(schema.valueChange.id, vc!.id));
    expect(after!.status).not.toBe("authorised");
  });
});
