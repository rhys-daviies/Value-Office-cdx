import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

import { and, eq } from "drizzle-orm";
import { chromium } from "playwright-core";
import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  REPORT_MODEL_VERSION,
  type AssuranceReport,
  type ReportModel,
  type RequalificationReport,
  type ValueChangeNotice,
} from "@/domain/reports";
import { seedCompactDecision, seedCompactTrajectory, seedCompactTrajectoryDraft } from "@/fixtures/compact";
import { createReview, finaliseReview, upsertValuePositions } from "@/server/commands/assurance";
import { recordEvidence } from "@/server/commands/evidence";
import { upsertScenario } from "@/server/commands/options";
import { updateStakeholder } from "@/server/commands/stakeholders";
import { removePlanPoint, setForecastPoint, setPlanPoint, setVersionBasis } from "@/server/commands/trajectory";
import { authoriseInitialVersion, proposeVersion } from "@/server/commands/value-case";
import { authoriseValueChange, createValueChange, proposeValueChange } from "@/server/commands/value-change";
import { db, schema } from "@/server/db/client";
import { getValueCaseEvolution } from "@/server/queries/evolution";
import { buildReport, getReportIssue } from "@/server/queries/reports";
import { getValueCaseSummary } from "@/server/queries/value-case-summary";
import { issueReport } from "@/server/reports/issue";
import { formatMoneyAdaptive, formatMoneyAdaptiveChange } from "@/ui/format";
import { renderReportArticle, renderReportDocument } from "@/ui/reports/render";
import { ValueCaseSummary } from "@/ui/value-case/summary";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { newActor, uid } from "../support/fixtures";

// Phase 4D.9J: report Value Trajectory integration (model v3), and the compatibility guarantees around it.

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const preview = { state: "preview" } as const;
const issued = { state: "issued", issueNumber: 1, issuedOn: "2026-10-02", issuedBy: "Golden Consultant" } as const;

describe("model v2 compatibility (goldens captured from the 4D.9I renderer, 41275e4)", () => {
  // Hashes pin the stored goldens themselves; rendering the stored v2 model must reproduce them byte-for-byte.
  const GOLDENS = {
    assurance: [
      "7b6df6e9cb33f9948982b1583da22b77a5189735f73481a1d9e7f5888161e8f7",
      "3150a80519fe7833fbc46636d24281419a9a6110b188e039461a4157150118a9",
      "61b08d2a420ca8e5209459a3340b7dd5ad85545ff23700bebff7f466da7428b4",
    ],
    requalification: [
      "bc70305751cca10bd0faf5b40d748a7c23553453c7d406f9c0033bf9e92b46d5",
      "2e0f219fc021d8b0a66c95eb29e9805c00498c6058d629e7040ee64c6af81f0f",
      "8d2a54443296b96fb8ff9598a05bc92586dc801adfd7c3a512d869ad2325ca01",
    ],
    "value-change-notice": [
      "bbc226edc187d4648fbca9dfa8d65803fa87e3251ce9447f9f1e2ff65b66ff13",
      "a82dd10951e7747660bd70229e772f724d92edaaf5df21be91bab4977a0721c1",
      "d3b14e6585ecea61fcc1ce450eff7cb1b114079a350ebc57159abea886d75f4f",
    ],
    "information-request": [
      "5e266060cccf8c7c4b4a73e92ee58ca6548eebf92254d2e01874d90a0c096f64",
      "e9e05669b206d61b1b519e5a6a4c022520790d2f37613259e1666a1a5c9315d9",
      "430a504048f935b232b68ce23154e12d3541b0ef179f010bd64573f89e9ae7e8",
    ],
  } as const;
  for (const [name, [model, prev, iss]] of Object.entries(GOLDENS)) {
    it(`${name}: a v2 snapshot renders exactly as issued, with no trajectory sections`, () => {
      const base = `tests/fixtures/reports/${name}-v2`;
      const raw = readFileSync(`${base}.model.json`, "utf8");
      expect(sha256(raw)).toBe(model);
      expect(sha256(readFileSync(`${base}.preview.html`))).toBe(prev);
      expect(sha256(readFileSync(`${base}.issued.html`))).toBe(iss);
      const m = JSON.parse(raw) as ReportModel;
      expect(m.header.modelVersion).toBe(2);
      const before = canonicalJson(m);
      const article = renderReportArticle(m, preview);
      expect(article).toBe(readFileSync(`${base}.preview.html`, "utf8"));
      expect(renderReportDocument(m, issued)).toBe(readFileSync(`${base}.issued.html`, "utf8"));
      expect(article).not.toMatch(/rpt-trajectory-svg|rpt-alternatives-svg|rpt-plan-svg|rpt-exec/);
      expect(canonicalJson(m)).toBe(before); // rendering never mutates the snapshot
    });
  }
});

// ---------------------------------------------------------------------------

const textOf = (markup: string) =>
  markup
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
const svgOf = (markup: string, testId: string) => {
  const at = markup.indexOf(`data-testid="${testId}"`);
  if (at < 0) return "";
  return markup.slice(markup.lastIndexOf("<svg", at), markup.indexOf("</svg>", at) + 6);
};
const count = (markup: string, needle: string) => markup.split(needle).length - 1;

/** Trajectory Executive (canonical, synthetic): Review #2 finalised with VL-001, three phased options, decision. */
async function executive() {
  const actor = await newActor();
  const x = await seedCompactTrajectory(actor, { code: `TX-${uid()}`, name: "Trajectory Executive", formal: true });
  return { actor, ...x };
}

/** Authorised V1 ($30m) of the given basis; optional plan; optional finalised review with forecast points / options. */
async function authorisedProject(
  kind: "cumulative_benefit" | "annual_run_rate" | "net_present_value" | "other" | null,
  opts: { period?: boolean; plan?: boolean; forecast?: boolean; options?: boolean } = {},
) {
  const actor = await newActor();
  const d = await seedCompactTrajectoryDraft(actor, { code: `RT-${uid()}`, name: "Report states" });
  const period = opts.period !== false;
  await setVersionBasis(actor, {
    versionId: d.v1.id,
    valueBasisKind: kind,
    valuePeriodStart: period ? "2026-01-01" : null,
    valuePeriodEnd: period ? "2028-12-31" : null,
  });
  if (opts.plan) {
    await setPlanPoint(actor, { versionId: d.v1.id, asOf: "2026-12-31", value: "8000000.00" });
    await setPlanPoint(actor, { versionId: d.v1.id, asOf: "2028-12-31", value: "30000000.00" });
  }
  await proposeVersion(actor, { versionId: d.v1.id });
  const ev = await recordEvidence(actor, { projectId: d.project.id, code: "E-1", title: "Authorisation" });
  await authoriseInitialVersion(actor, {
    versionId: d.v1.id,
    authorisedByPersonId: d.vco.id,
    authorisedOn: "2026-01-15",
    authorisationEvidenceId: ev.id,
  });
  const drivers = await db().select().from(schema.valueDriver).where(eq(schema.valueDriver.projectId, d.project.id));
  const review = await createReview(actor, { projectId: d.project.id, trigger: "ad_hoc", reviewDate: "2026-09-30" });
  await upsertValuePositions(actor, {
    reviewId: review.id,
    positions: drivers.map((x, i) => ({
      valueDriverId: x.id,
      currentForecast: i === 0 ? "18000000.00" : "9000000.00",
      realisedValue: i === 0 ? "1500000.00" : "500000.00",
    })),
  });
  if (opts.forecast) await setForecastPoint(actor, { reviewId: review.id, asOf: "2028-12-31", value: "27000000.00" });
  if (opts.options) {
    await upsertScenario(actor, {
      reviewId: review.id,
      label: "Act now",
      kind: "recommended",
      totalValue: "29000000.00",
    });
    await upsertScenario(actor, {
      reviewId: review.id,
      label: "No action",
      kind: "no_action",
      totalValue: "23000000.00",
    });
  }
  await finaliseReview(actor, { reviewId: review.id });
  return { actor, ...d, review };
}

describe("Section A: governance refinements", () => {
  it("30. adaptive precision: smaller change amounts are never rounded into a different-looking figure", () => {
    const f = (v: string) => formatMoneyAdaptive(v, "USD");
    expect([f("30000000.00"), f("2500000.00"), f("1250000.00"), f("450000.00"), f("250000.00"), f("0.00")]).toEqual([
      "$30.0m",
      "$2.5m",
      "$1.25m",
      "$450k",
      "$250k",
      "$0",
    ]);
    expect([f("12345.00"), f("512.40"), f("-600000.00")]).toEqual(["$12.3k", "$512.4", "-$600k"]);
    expect(formatMoneyAdaptiveChange("450000.00", "USD")).toBe("+$450k");
    expect(formatMoneyAdaptiveChange("0.00", "USD")).toBe("$0");
    expect(formatMoneyAdaptiveChange("450000.00", "USD")).not.toBe("+$0.5m");
  });

  it("29. stated change vs draft movement: both shown when they do not reconcile; neither is altered", async () => {
    const actor = await newActor();
    const { project } = await seedCompactDecision(actor, { code: `DC-${uid()}`, name: "Decision Compact" });
    const s = await getValueCaseSummary(project.id, await getValueCaseEvolution(project.id));
    expect(s.pending).toEqual([
      expect.objectContaining({
        code: "VC-001",
        status: "draft",
        statedChange: "250000.00",
        proposedChange: "0.00",
        reconciled: false,
      }),
    ]);
    const text = textOf(renderToStaticMarkup(createElement(ValueCaseSummary, { summary: s, base: "/p" })));
    expect(text).toContain(
      "Stated change +$250k · Current draft movement $0 · Does not reconcile · Draft — not in force",
    );
    const [vc] = await db().select().from(schema.valueChange).where(eq(schema.valueChange.projectId, project.id));
    expect(vc!.statedChangeAmount).toBe("250000.00"); // unchanged
  });
});

describe("model v3 report trajectories", () => {
  it("3/4/6–10/20–26. Value Assurance (canonical): executive position, trajectory, story, alternatives, decision", async () => {
    const x = await executive();
    const m = (await buildReport("assurance", x.project.id, x.review.id))!.model as AssuranceReport;
    expect(REPORT_MODEL_VERSION).toBe(3);
    expect(m.header.modelVersion).toBe(3);
    const t = m.trajectory!;
    expect(t.plan).toMatchObject({ versionNumber: 1, valueBasisKind: "cumulative_benefit", total: "30000000.00" });
    expect(t.plan.milestones.map((p) => p.value)).toEqual(["0.00", "6000000.00", "18000000.00", "30000000.00"]);
    expect(t.realised!.checkpoints).toEqual([
      { sequence: 1, asOf: "2026-03-31", value: "1000000.00" },
      { sequence: 2, asOf: "2026-09-30", value: "4000000.00" },
    ]);
    expect(t.formal).toEqual({ sequence: 2, reviewDate: "2026-09-30", forecastTotal: "26000000.00" });
    expect(t.forecast).toEqual({
      anchor: { asOf: "2026-09-30", value: "4000000.00" },
      points: [
        { asOf: "2027-12-31", value: "16000000.00" },
        { asOf: "2028-12-31", value: "26000000.00" },
      ],
    });
    expect(t.notes).toEqual([]);
    expect(t.versionChange).toBeNull();
    const a = m.alternatives!;
    expect(a.options.map((o) => [o.label, o.totalValue, o.recommended, o.selected, o.milestones.length])).toEqual([
      ["Act now", "29000000.00", true, false, 2],
      ["No action", "23000000.00", false, false, 3],
      ["Delay 3 months", "27000000.00", false, true, 3],
    ]);
    expect(a.decisionComparison!.difference).toBe("-2000000.00");
    // Nothing generated: every snapshotted value is a stored milestone, a realised position or a stored total.
    expect(JSON.stringify(m.trajectory)).not.toMatch(/2027-0[1-9]|2028-0[1-9]/);

    const markup = renderReportArticle(m, { state: "preview" });
    const text = textOf(markup);
    expect(text).toContain(
      "Formal position as at 30 Sept 2026 · Assurance Review 2 · measured against Authorised Value Case V1",
    );
    expect(text).toMatch(
      /Authorised Value \$30\.0m V1 Realised \$4\.0m Formal Forecast \$26\.0m At the Value Period end Value Gap \$4\.0m/,
    );
    const svg = svgOf(markup, "rpt-trajectory-svg");
    expect(count(svg, 'data-series="plan"')).toBe(4);
    expect(count(svg, 'data-series="realised"')).toBe(3);
    expect(count(svg, 'data-series="forecast"')).toBe(2); // the anchor is not a forecast mark
    expect(svg).toContain('data-marker="Formal position 30 Sept 2026"');
    expect(text).toContain("VL-001: Total Value Leakage $700,000 = Recoverable $450,000 + Unrecoverable $250,000");
    expect(text).toContain("Value Leakage is assessed per matter; it is not the Value Gap.");
    expect(text).toContain("Value Gap and Value Leakage are separate measures and are not added together.");
    expect(text).toContain("VD-01 Procurement Savings: forecast $14.0m → $13.0m (-$1.0m)");
    const alt = svgOf(markup, "rpt-alternatives-svg");
    expect(count(alt, 'data-series="o0"')).toBe(2);
    expect(text).toMatch(
      /Cardaxia recommendation \$29\.0m Act now Client selected \$27\.0m Delay 3 months Difference from Cardaxia recommendation -\$2\.0m/,
    );
    expect(text).toContain("Recommendation: Act now · stored option total $29.0m");
    expect(text).toContain("Selected: Delay 3 months · $27.0m");
    expect(text).not.toMatch(/cost of delay|best option|optimal/i);
    expect(text).toContain("Appendix — trajectory values");
  });

  it("11. the authorised Value Change that created the plan's version is marked", async () => {
    const x = await executive();
    const { change } = await createValueChange(x.actor, {
      projectId: x.project.id,
      code: "VC-001",
      reason: "Re-phase",
      statedChangeAmount: "0.00",
    });
    await proposeValueChange(x.actor, { changeId: change.id });
    const ev = await recordEvidence(x.actor, { projectId: x.project.id, code: "E-VC", title: "VCO approval" });
    await authoriseValueChange(x.actor, {
      changeId: change.id,
      authorisedByPersonId: x.vco.id,
      authorisedOn: "2026-10-01",
      authorisationEvidenceId: ev.id,
    });
    const drivers = await db().select().from(schema.valueDriver).where(eq(schema.valueDriver.projectId, x.project.id));
    const r3 = await createReview(x.actor, { projectId: x.project.id, trigger: "ad_hoc", reviewDate: "2026-10-02" });
    await upsertValuePositions(x.actor, {
      reviewId: r3.id,
      positions: drivers.map((d) => ({ valueDriverId: d.id, currentForecast: "9000000.00" })),
    });
    await finaliseReview(x.actor, { reviewId: r3.id });
    const m = (await buildReport("assurance", x.project.id, r3.id))!.model as AssuranceReport;
    expect(m.trajectory!.versionChange).toEqual({ code: "VC-001", versionNumber: 2, authorisedOn: "2026-10-01" });
    const markup = renderReportArticle(m, { state: "preview" });
    expect(svgOf(markup, "rpt-trajectory-svg")).toContain('data-marker="V2 authorised (VC-001)"');
    expect(textOf(markup)).toContain("Formal forecast phasing was not entered for this review.");
  });

  it("12/13. annual run rate: plan and formal forecast only; no cumulative realised, no anchor", async () => {
    const p = await authorisedProject("annual_run_rate", { plan: true, forecast: true });
    const m = (await buildReport("assurance", p.project.id, p.review.id))!.model as AssuranceReport;
    expect(m.trajectory).toMatchObject({
      measure: "run_rate",
      realised: null,
      notes: ["realised_run_rate_not_recorded"],
    });
    expect(m.trajectory!.forecast!.anchor).toBeNull();
    const markup = renderReportArticle(m, { state: "preview" });
    const svg = svgOf(markup, "rpt-trajectory-svg");
    expect(svg).toContain('data-series="plan"');
    expect(svg).toContain('data-series="forecast"');
    expect(svg).not.toContain('data-series="realised"');
    expect(textOf(markup)).toContain("Realised run-rate is not currently recorded.");
    expect(textOf(markup)).toContain("Annual Run Rate");
  });

  it("14–19/31. NPV, Other, unclassified, no period, no phasing: concise statements, no empty charts; still issuable", async () => {
    for (const [kind, expected] of [
      ["net_present_value", "Value trajectory is not available for NPV."],
      ["other", "Value trajectory is not available for this Value Basis."],
      [null, "Value Basis not classified — no Value Trajectory is shown."],
    ] as const) {
      const p = await authorisedProject(kind);
      const built = (await buildReport("assurance", p.project.id, p.review.id))!;
      expect(built.issuable.ok).toBe(true); // legacy / non-trajectory projects are never blocked
      const markup = renderReportArticle(built.model, { state: "preview" });
      expect(textOf(markup)).toContain(expected);
      expect(markup).not.toContain("rpt-trajectory-svg");
    }
    const noPeriod = await authorisedProject("cumulative_benefit", { period: false });
    expect(
      textOf(
        renderReportArticle((await buildReport("assurance", noPeriod.project.id, noPeriod.review.id))!.model, {
          state: "preview",
        }),
      ),
    ).toContain("Value Period not set — no Value Trajectory is shown.");
    const unphased = await authorisedProject("cumulative_benefit");
    const m = (await buildReport("assurance", unphased.project.id, unphased.review.id))!.model as AssuranceReport;
    expect(m.trajectory!.notes).toEqual(["plan_phasing_not_entered", "forecast_phasing_not_entered"]);
    const text = textOf(renderReportArticle(m, { state: "preview" }));
    expect(text).toContain("Authorised plan phasing was not entered.");
    expect(text).toContain("Formal forecast phasing was not entered for this review.");
    // Realised alone is still a governed series ($0 origin and the review's $2.0m).
    expect(m.trajectory!.realised!.checkpoints).toEqual([{ sequence: 1, asOf: "2026-09-30", value: "2000000.00" }]);
  });

  it("27. options without phasing keep the 4D.6 endpoint-only outcomes (no manufactured path)", async () => {
    const p = await authorisedProject("cumulative_benefit", { plan: true, options: true });
    const m = (await buildReport("assurance", p.project.id, p.review.id))!.model as AssuranceReport;
    expect(m.alternatives).toBeNull();
    const markup = renderReportArticle(m, { state: "preview" });
    expect(markup).not.toContain("rpt-alternatives-svg");
    expect(textOf(markup)).toContain("Alternative Value Outcomes");
  });

  it("32. Re-Qualification: Value Basis, Value Period and the authorised plan as recorded (no later Assurance)", async () => {
    const x = await executive();
    const m = (await buildReport("requalification", x.project.id, x.v1.id))!.model as RequalificationReport;
    expect(m.plan!.milestones).toHaveLength(4);
    const markup = renderReportArticle(m, { state: "preview" });
    const svg = svgOf(markup, "rpt-plan-svg");
    expect(count(svg, 'data-series="plan0"')).toBe(4);
    expect(svg).not.toMatch(/realised|forecast/);
    expect(textOf(markup)).toContain("Value Basis Cumulative Benefit · Value Period 1 Jan 2026 – 31 Dec 2028");
    const legacy = await authorisedProject(null);
    const lm = (await buildReport("requalification", legacy.project.id, legacy.v1.id))!.model;
    expect(textOf(renderReportArticle(lm, { state: "preview" }))).toContain("Value Basis not classified");
  });

  it("28/33. Value Change Notice: plans before/after; proposed wording; mismatch and adaptive precision", async () => {
    const x = await executive();
    const { change, version } = await createValueChange(x.actor, {
      projectId: x.project.id,
      code: "VC-001",
      reason: "Re-phase",
      statedChangeAmount: "0.00",
    });
    const pts = await db()
      .select()
      .from(schema.valueTrajectoryPoint)
      .where(eq(schema.valueTrajectoryPoint.valueCaseVersionId, version.id));
    await removePlanPoint(x.actor, { pointId: pts.find((p) => p.asOf === "2026-12-31")!.id });
    await setPlanPoint(x.actor, { versionId: version.id, asOf: "2027-03-31", value: "6000000.00" });
    await proposeValueChange(x.actor, { changeId: change.id });
    const m = (await buildReport("value_change_notice", x.project.id, change.id))!.model as ValueChangeNotice;
    expect(m.plans!.from.milestones.map((p) => p.asOf)).toContain("2026-12-31");
    expect(m.plans!.to.milestones.map((p) => p.asOf)).toContain("2027-03-31");
    const markup = renderReportArticle(m, { state: "preview" });
    expect(svgOf(markup, "rpt-plan-svg")).toContain('data-series="plan1"');
    const text = textOf(markup);
    expect(text).toContain("V2 (proposed — not in force)");
    expect(text).toContain("Proposed change $0 — not in force.");

    // A draft that does not reconcile: both figures, adaptive precision, never presented as authorised.
    const actor = await newActor();
    const { project } = await seedCompactDecision(actor, { code: `DC-${uid()}`, name: "Decision Compact" });
    const [vc] = await db()
      .select()
      .from(schema.valueChange)
      .where(and(eq(schema.valueChange.projectId, project.id), eq(schema.valueChange.code, "VC-001")));
    const draft = (await buildReport("value_change_notice", project.id, vc!.id))!.model;
    const dt = textOf(renderReportArticle(draft, { state: "preview" }));
    expect(dt).toContain("Stated change +$250k · current draft movement $0 · does not reconcile — not in force.");
    expect(dt).not.toMatch(/\bAuthorised change\b|New authorised value/);
  });

  it("34. Information Request: unchanged by v3 (its renderer has no version-dependent content)", () => {
    const base = "tests/fixtures/reports/information-request-v2";
    const m = JSON.parse(readFileSync(`${base}.model.json`, "utf8")) as ReportModel;
    const v3 = { ...m, header: { ...m.header, modelVersion: 3 } } as ReportModel;
    expect(renderReportArticle(v3, { state: "preview" })).toBe(readFileSync(`${base}.preview.html`, "utf8"));
  });

  it("35. report SVG is well-formed and deterministic (no NaN, balanced elements)", async () => {
    const x = await executive();
    const m = (await buildReport("assurance", x.project.id, x.review.id))!.model;
    const a = renderReportArticle(m, { state: "preview" });
    expect(renderReportArticle(m, { state: "preview" })).toBe(a);
    for (const id of ["rpt-trajectory-svg", "rpt-alternatives-svg"]) {
      const svg = svgOf(a, id);
      expect(svg.length).toBeGreaterThan(500);
      expect(svg).not.toMatch(/NaN|undefined|Infinity|null/);
      const stack: string[] = [];
      for (const [, close, name, selfClose] of svg.matchAll(/<(\/?)([a-zA-Z]+)\b[^>]*?(\/?)>/g)) {
        if (selfClose) continue;
        if (close) expect(stack.pop()).toBe(name);
        else stack.push(name!);
      }
      expect(stack).toEqual([]);
    }
  });

  it("5/37. an issued v3 report is a fixed record: later live changes do not alter its snapshot or rendering", async () => {
    const x = await executive();
    const issue = await issueReport(x.actor, { type: "assurance", projectId: x.project.id, subjectId: x.review.id });
    const snapshot = JSON.stringify(issue.snapshot);
    const rendered = renderReportDocument(issue.snapshot as ReportModel, { state: "preview" });
    expect((issue.snapshot as AssuranceReport).trajectory!.plan.milestones).toHaveLength(4);
    // Later live changes: a stakeholder rename and a further finalised review with its own realised and forecast.
    await updateStakeholder(x.actor, { projectId: x.project.id, personId: x.vco.id, name: "Renamed VCO" });
    const drivers = await db().select().from(schema.valueDriver).where(eq(schema.valueDriver.projectId, x.project.id));
    const r3 = await createReview(x.actor, { projectId: x.project.id, trigger: "ad_hoc", reviewDate: "2026-10-02" });
    await upsertValuePositions(x.actor, {
      reviewId: r3.id,
      positions: drivers.map((d) => ({
        valueDriverId: d.id,
        currentForecast: "9000000.00",
        realisedValue: "2000000.00",
      })),
    });
    await setForecastPoint(x.actor, { reviewId: r3.id, asOf: "2028-12-31", value: "27000000.00" });
    await finaliseReview(x.actor, { reviewId: r3.id });
    const stored = (await getReportIssue(x.project.id, issue.id))!;
    expect(JSON.stringify(stored.snapshot)).toBe(snapshot);
    expect(renderReportDocument(stored.snapshot as ReportModel, { state: "preview" })).toBe(rendered);
    expect(JSON.stringify(stored.snapshot)).not.toContain("Renamed VCO");
    // The live rebuild differs (renamed VCO in the Evolution) — but its trajectory stays "as at Review #2".
    const live = (await buildReport("assurance", x.project.id, x.review.id))!.model as AssuranceReport;
    expect(JSON.stringify(live)).toContain("Renamed VCO");
    expect(live.trajectory).toEqual((issue.snapshot as AssuranceReport).trajectory);
  }, 60_000);

  it("36. print layout: charts fit the page width, keep-together blocks fit a page and carry their heading", async () => {
    const x = await executive();
    const docs = [
      renderReportDocument((await buildReport("assurance", x.project.id, x.review.id))!.model, { state: "preview" }),
      renderReportDocument((await buildReport("requalification", x.project.id, x.v1.id))!.model, { state: "preview" }),
    ];
    const browser = await chromium.launch(
      process.env.VO_CHROMIUM_EXECUTABLE ? { executablePath: process.env.VO_CHROMIUM_EXECUTABLE } : {},
    );
    try {
      const page = await browser.newPage({ viewport: { width: 688, height: 994 }, javaScriptEnabled: false });
      await page.emulateMedia({ media: "print" });
      for (const doc of docs) {
        await page.setContent(doc);
        const layout = await page.evaluate(() => ({
          keeps: [...document.querySelectorAll(".rpt-keep")].map((e) => ({
            h: e.getBoundingClientRect().height,
            heading: Boolean(e.querySelector("h2, h3")),
          })),
          svgWithin: [...document.querySelectorAll("svg.rpt-svg")].every(
            (e) => e.getBoundingClientRect().right <= document.documentElement.clientWidth + 0.5,
          ),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }));
        expect(layout.keeps.length).toBeGreaterThan(0);
        for (const k of layout.keeps) {
          expect(k.h).toBeLessThan(994 * 0.85);
          expect(k.heading).toBe(true); // a chart is never separated from its title
        }
        expect(layout.svgWithin).toBe(true);
        expect(layout.overflow).toBeLessThanOrEqual(0);
      }
    } finally {
      await browser.close();
    }
  }, 120_000);

  it("38. report fixtures are synthetic: no personal emails, phone numbers or real client names", () => {
    const dir = "tests/fixtures/reports";
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".model.json"))) {
      const json = readFileSync(`${dir}/${f}`, "utf8");
      expect(json, f).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/);
      // Phone shapes need separators (amounts and ISO dates do not match): +44 20 7946 0000, (020) 7946-0000.
      expect(json, f).not.toMatch(/(\+\d{1,3}[ -])?\(?\d{2,4}\)?[ -]\d{3,4}[ -]\d{3,4}\b/);
      const m = JSON.parse(json) as ReportModel;
      expect(m.header.clientName, f).toMatch(/Synthetic|Golden|Test|Placeholder|Client/i);
    }
  });
});
