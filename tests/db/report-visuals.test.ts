import { readFileSync } from "node:fs";

import { asc, eq } from "drizzle-orm";
import { chromium } from "playwright-core";
import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  REPORT_MODEL_VERSION,
  type AssuranceEvolution,
  type AssuranceOutcomes,
  type AssuranceReport,
  type ReportModel,
} from "@/domain/reports";
import { seedCompactDecision, seedCompactEvolution } from "@/fixtures/compact";
import { seedHorizon } from "@/fixtures/horizon";
import { createReview, finaliseReview, upsertValuePositions } from "@/server/commands/assurance";
import { proposeValueChange } from "@/server/commands/value-change";
import { updateStakeholder } from "@/server/commands/stakeholders";
import { db, schema } from "@/server/db/client";
import { listValueChanges } from "@/server/queries/response";
import { buildAssuranceReport, buildReport, getReportIssue } from "@/server/queries/reports";
import { issueReport } from "@/server/reports/issue";
import { htmlToPdf } from "@/server/reports/pdf";
import { sha256 } from "@/server/reports/storage";
import { renderValueCaseEvolutionSvg } from "@/ui/reports/charts/evolution-svg";
import { renderAlternativeValueOutcomesSvg } from "@/ui/reports/charts/outcomes-svg";
import { RENDERER_VERSION, renderReportArticle, renderReportDocument } from "@/ui/reports/render";

import { newActor, uid } from "../support/fixtures";

// Phase 4D.7: report visuals. Value Case Evolution and Alternative Value Outcomes are snapshotted into the
// Assurance report model (v2) and rendered as deterministic server-side SVG; v1 snapshots render exactly
// as they were issued.

const preview = { state: "preview" } as const;
const money = (v: string | null) => (v === null ? "—" : `$${v}`);
const textOf = (markup: string) =>
  markup
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const section = (markup: string, testId: string) => {
  const start = markup.indexOf(`data-testid="${testId}"`);
  return start === -1 ? "" : markup.slice(start, markup.indexOf("</section>", start));
};

async function reviewsOf(projectId: string) {
  return db()
    .select()
    .from(schema.assuranceReview)
    .where(eq(schema.assuranceReview.projectId, projectId))
    .orderBy(asc(schema.assuranceReview.sequence));
}

async function evolutionProject() {
  const actor = await newActor();
  const { project } = await seedCompactEvolution(actor, { code: `EV-${uid()}`, name: "Evolution" });
  return { actor, project, reviews: await reviewsOf(project.id) };
}

describe("Assurance report model v2 snapshots", () => {
  it("snapshots governed Value Case Evolution as at the reported review, excluding working and draft values", async () => {
    const { actor, project, reviews } = await evolutionProject();
    // Live, non-governed state that must not reach the report: a draft review and a proposed VC-002.
    await createReview(actor, { projectId: project.id, trigger: "ad_hoc", reviewDate: "2026-10-01" });
    const vc2 = (await listValueChanges(project.id)).find((c) => c.change.code === "VC-002")!;
    await proposeValueChange(actor, { changeId: vc2.change.id });

    const m = (await buildAssuranceReport(project.id, reviews[2]!.id))!.model;
    expect(m.header.modelVersion).toBe(REPORT_MODEL_VERSION);
    expect(REPORT_MODEL_VERSION).toBe(3); // 4D.9J: v3 keeps the v2 evolution/outcomes snapshots and adds trajectories
    const ev = m.evolution!;
    expect(ev.originalBusinessCase).toEqual({ title: "Original Business Case", value: "2000000.00" });
    expect(ev.events.map((e) => e.key)).toEqual(["original", "v1", "r1", "r2", "v2", "r3"]); // no draft r4, no V3
    expect(ev.events.find((e) => e.kind === "review" && e.sequence === 1)).toMatchObject({
      currentForecast: "1400000.00",
      realisedValue: "0.00", // actual zero kept
      againstVersionNumber: 1,
    });
    expect(ev.events.at(-1)).toMatchObject({
      kind: "review",
      sequence: 3,
      againstVersionNumber: 2,
      isThisReview: true,
    });
    const amounts = JSON.stringify(ev);
    for (const v of ["450000.00", '200000.00","kind"', "1750000.00"]) expect(amounts).not.toContain(v);
    expect(amounts).not.toContain("VC-002");

    // As at Review #2: history is cut after it (V2 and Review #3 came later).
    const m2 = (await buildAssuranceReport(project.id, reviews[1]!.id))!.model;
    expect(m2.evolution!.events.map((e) => e.key)).toEqual(["original", "v1", "r1", "r2"]);

    // The forecast connector breaks across versions in the report SVG too.
    const html = renderReportArticle(m, preview);
    expect(html).toContain('data-forecast-connectors="r1&gt;r2|r3"');
  });

  it("snapshots Alternative Value Outcomes for the review: references, roles, signed difference; no Value Changes or working values", async () => {
    const actor = await newActor();
    const { project, review } = await seedCompactDecision(actor, { code: `DC-${uid()}`, name: "Decision" });
    const m = (await buildAssuranceReport(project.id, review.id))!.model;
    const o = m.outcomes!;
    expect(o).toMatchObject({
      againstVersionNumber: 1,
      authorisedValue: "1500000.00",
      currentFormalForecast: "1400000.00",
      differenceFromRecommendation: "-300000.00",
    });
    expect(o.outcomes.map((x) => [x.label, x.totalValue, x.recommended, x.selected])).toEqual([
      ["Accelerate supplier onboarding", "1900000.00", true, false],
      ["Current trajectory", "1400000.00", false, false],
      ["Defer remediation", "1200000.00", false, false],
      ["Phase the rollout", "1600000.00", false, true],
    ]);
    // Equal-valued records keep their roles: the $1.4m formal forecast and the $1.4m Current trajectory option.
    expect(o.currentFormalForecast).toBe(o.outcomes[1]!.totalValue);

    const html = renderReportArticle(m, preview);
    const out = section(html, "as-outcomes");
    expect(textOf(out)).toContain("Alternative Value Outcomes");
    expect(out).not.toMatch(/VC-001|VL-301|VD-04|\$1\.8m|\$0\.4m|\$0\.2m/);
    expect(html).not.toContain("Alternative trajectories"); // v2 terminology
    expect(textOf(out)).toContain("Cardaxia recommendation");
    expect(textOf(out)).not.toMatch(/Cardaxia recommendation · Recommended|Recommended/); // no redundant kind
  });

  it("an older review keeps its own version and forecast; recommendation = selection shows once with both roles", async () => {
    const { project, reviews } = await evolutionProject();
    const m = (await buildAssuranceReport(project.id, reviews[1]!.id))!.model; // Review #2, V2 now in force
    expect(m.outcomes).toMatchObject({
      againstVersionNumber: 1,
      authorisedValue: "1500000.00",
      currentFormalForecast: "1300000.00",
      differenceFromRecommendation: "0.00",
    });
    expect(m.outcomes!.outcomes.filter((x) => x.recommended && x.selected)).toHaveLength(1);
    const html = renderReportArticle(m, preview);
    expect((section(html, "as-outcomes").match(/data-testid="as-outcome-row"/g) ?? []).length).toBe(2);
    expect(textOf(section(html, "as-outcomes"))).toContain("Cardaxia recommendation · Client selected");
  });

  it("omits the Alternative Value Outcomes section cleanly when the review has no options", async () => {
    const { project, reviews } = await evolutionProject();
    const m = (await buildAssuranceReport(project.id, reviews[2]!.id))!.model; // Review #3: no options
    expect(m.outcomes).toBeNull();
    const html = renderReportArticle(m, preview);
    expect(html).not.toContain('data-testid="as-outcomes"');
    expect(html).toContain('data-testid="as-evolution"');
    const headings = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((h) => h[1]);
    // Model v3 (4D.9J) narrative; the options section is omitted when the review has none.
    expect(headings).toEqual([
      "1. Executive value position",
      "2. Value Trajectory",
      "3. Why the value position moved",
      "4. Value Leakage",
      "5. Cardaxia recommendation",
      "6. Management decision",
      "7. Governance and Value Change",
      "8. Value Driver position",
      "9. Value Case Evolution",
      "10. Review record",
    ]);
  });

  it("Horizon: Evolution $18.0m / $15.5m / $14.7m / $2.8m / $0.8m; Outcomes $15.5m / $14.7m / $15.3m / $14.9m / −$0.4m; no VC-002", async () => {
    const actor = await newActor();
    const { project, review } = await seedHorizon(actor, { projectCode: `HORIZON-${uid()}` });
    const m = (await buildAssuranceReport(project.id, review.id))!.model;
    expect(m.evolution!.events).toEqual([
      { kind: "original", key: "original", title: "Original Business Case", value: "18000000.00" },
      expect.objectContaining({ kind: "authorisation", versionNumber: 1, authorisedValue: "15500000.00" }),
      expect.objectContaining({
        kind: "review",
        currentForecast: "14700000.00",
        realisedValue: "2800000.00",
        valueGap: "800000.00",
      }),
    ]);
    const o = m.outcomes!;
    expect(o.authorisedValue).toBe("15500000.00");
    expect(o.currentFormalForecast).toBe("14700000.00");
    expect(o.outcomes.find((x) => x.recommended)!.totalValue).toBe("15300000.00");
    expect(o.outcomes.find((x) => x.selected)!.totalValue).toBe("14900000.00");
    expect(o.differenceFromRecommendation).toBe("-400000.00");
    expect(JSON.stringify(o)).not.toMatch(/VC-002|-600000/);
    // Equal values, distinct roles: formal forecast $14.7m and the stored Current trajectory option $14.7m.
    expect(o.outcomes.find((x) => x.kind === "current")!.totalValue).toBe("14700000.00");

    const text = textOf(renderReportArticle(m, preview));
    // v2 uses the Phase 4D.1 terminology (v1 snapshots keep "Response owner (AVO)").
    expect(text).toContain("Risk / Leakage Owner");
    expect(text).not.toContain("Response owner (AVO)");
    const ev = text.slice(text.indexOf(". Value Case Evolution"), text.indexOf(". Review record"));
    for (const v of ["$18.0m", "$15.5m", "$14.7m", "$2.8m", "$0.8m", "Not dated"]) expect(ev).toContain(v);
    const start = text.indexOf(". Alternative Value Outcomes");
    const out = text.slice(start, text.indexOf(". Cardaxia recommendation", start));
    for (const v of ["$15.5m", "$14.7m", "$15.3m", "$14.9m", "-$0.4m"]) expect(out).toContain(v);
    expect(out).not.toContain("VC-002");
  });
});

describe("report-model compatibility", () => {
  const golden = "tests/fixtures/reports/assurance-v1";
  const v1 = () => JSON.parse(readFileSync(`${golden}.model.json`, "utf8")) as ReportModel;

  it("renders a v1 snapshot byte-for-byte as the released renderer (a88cc72) did, with no charts", () => {
    const m = v1();
    expect(m.header.modelVersion).toBe(1);
    expect("evolution" in m).toBe(false);
    expect(sha256(Buffer.from(canonicalJson(m)))).toBe(
      "c1585b234aa9a2d989396d95cd60047c133c6aec4f1aaf83ce0134e6e0558565",
    ); // the stored snapshot itself is untouched
    const issued = { state: "issued", issueNumber: 1, issuedOn: "2026-07-01", issuedBy: "Golden Consultant" } as const;
    const article = renderReportArticle(m, preview);
    // Production baseline (Phase 4D.8A): a real model-v1 snapshot issued by the released code (a88cc72)
    // and that release's own rendering of it. Their hashes pin them.
    expect(sha256(readFileSync(`${golden}.preview.html`))).toBe(
      "fa2e7b4b78d59904a23b4742ca1743882139d62c4ef29e8e2e2116b817c40550",
    );
    expect(sha256(readFileSync(`${golden}.issued.html`))).toBe(
      "ff50c92ecb29a65822909e16d31b892008dd2ec96f77c0e3fc316b7b01c41c48",
    );
    expect(article).toBe(readFileSync(`${golden}.preview.html`, "utf8"));
    expect(renderReportDocument(m, issued)).toBe(readFileSync(`${golden}.issued.html`, "utf8"));
    expect(article).toContain("6. Alternative trajectories");
    // v1 keeps its issued wording (Phase 4D.1 renamed these only for new models).
    expect(article).toContain("<th>Response owner (AVO)</th>");
    expect(article).toContain("response owner");
    expect(article).not.toContain("Risk / Leakage Owner");
    expect(article).not.toMatch(/as-evolution|as-outcomes|<svg class="rpt-svg"/);
    expect(JSON.stringify(m)).toBe(JSON.stringify(v1())); // rendering never mutates the snapshot
  });

  it("an issued v2 report keeps its chart data after later live changes", async () => {
    const { actor, project, reviews } = await evolutionProject();
    const r2 = reviews[1]!;
    const issue = await issueReport(actor, { type: "assurance", projectId: project.id, subjectId: r2.id });
    expect(issue.rendererVersion).toBe(RENDERER_VERSION);
    const issuedSnapshot = JSON.stringify(issue.snapshot);
    const issuedHtml = renderReportArticle(issue.snapshot as ReportModel, preview);

    // Live changes after issue: the VCO is renamed and a further review is finalised.
    const [vc] = await db().select().from(schema.valueCase).where(eq(schema.valueCase.projectId, project.id));
    await updateStakeholder(actor, { projectId: project.id, personId: vc!.vcoPersonId!, name: "Renamed VCO" });
    const next = await createReview(actor, { projectId: project.id, trigger: "ad_hoc", reviewDate: "2026-10-01" });
    const drivers = await db().select().from(schema.valueDriver).where(eq(schema.valueDriver.projectId, project.id));
    await upsertValuePositions(actor, {
      reviewId: next.id,
      positions: drivers
        .filter((d) => d.code === "VD-01" || d.code === "VD-02") // the V2 drivers (VD-04 is emerging)
        .map((d) => ({
          forecastRationale: "Synthetic test rationale",
          valueDriverId: d.id,
          currentForecast: "100000.00",
        })),
    });
    await finaliseReview(actor, { reviewId: next.id });

    // A live rebuild now differs (the renamed VCO) …
    const live = (await buildReport("assurance", project.id, r2.id))!.model as AssuranceReport;
    expect(JSON.stringify(live.evolution)).toContain("Renamed VCO");
    // … but the issued record and its rendering do not.
    const stored = (await getReportIssue(project.id, issue.id))!;
    expect(JSON.stringify(stored.snapshot)).toBe(issuedSnapshot);
    expect(JSON.stringify(stored.snapshot)).not.toContain("Renamed VCO");
    expect(renderReportArticle(stored.snapshot as ReportModel, preview)).toBe(issuedHtml);
    expect((stored.snapshot as AssuranceReport).evolution!.events.map((e) => e.key)).toEqual([
      "original",
      "v1",
      "r1",
      "r2",
    ]);
  }, 60_000);
});

describe("report SVG renderers", () => {
  const evolution: AssuranceEvolution = {
    originalBusinessCase: null,
    events: [
      {
        kind: "authorisation",
        key: "v1",
        versionNumber: 1,
        authorisedValue: "1000.00",
        authorisedOn: null,
        vcoName: null,
        valueChangeCode: null,
      },
      {
        kind: "review",
        key: "r1",
        sequence: 1,
        reviewDate: "2026-01-01",
        againstVersionNumber: 1,
        currentForecast: "900.00",
        realisedValue: null,
        valueGap: "100.00",
        inForceValue: "1000.00",
        isThisReview: true,
      },
    ],
  };
  const outcomes = (label: string): AssuranceOutcomes => ({
    againstVersionNumber: 1,
    authorisedValue: "1000.00",
    currentFormalForecast: null,
    outcomes: [
      { label, kind: "recommended", totalValue: "1200.00", narrative: null, recommended: true, selected: true },
      { label: "", kind: "alternative", totalValue: "0.00", narrative: null, recommended: false, selected: false },
    ],
    differenceFromRecommendation: "0.00",
  });

  it("are deterministic for identical input", () => {
    expect(renderValueCaseEvolutionSvg(evolution, money).value).toBe(
      renderValueCaseEvolutionSvg(evolution, money).value,
    );
    const o = outcomes("Option");
    expect(renderAlternativeValueOutcomesSvg(o, 1, money).value).toBe(
      renderAlternativeValueOutcomesSvg(o, 1, money).value,
    );
    // Fixed-precision coordinates only (no float noise like 12.300000000000001).
    expect(renderValueCaseEvolutionSvg(evolution, money).value).not.toMatch(/\d\.\d{3,}/);
  });

  it("never plots a missing value: no realised mark, no forecast reference, no invented date", () => {
    const svg = renderValueCaseEvolutionSvg(evolution, money).value;
    expect(svg).not.toContain('data-series="realised"');
    expect(svg).toContain('data-series="forecast"');
    expect(svg).toContain("Date not recorded");
    const out = renderAlternativeValueOutcomesSvg(outcomes("x"), 1, money).value;
    expect(out).not.toContain('data-role="forecast"');
    expect(out).toContain("$0.00"); // an actual zero option is plotted, not dropped
  });

  it("escapes text and survives long or empty labels", () => {
    const hostile = `<script>alert("x")</script> & ${"Very long option name ".repeat(10)}`;
    const svg = renderAlternativeValueOutcomesSvg(outcomes(hostile), 1, money).value;
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("…"); // clipped in the chart; the table carries the full label
    expect(svg).toMatch(/viewBox="0 0 680 \d+"/);
  });

  it("chart values match the companion tables", async () => {
    const actor = await newActor();
    const { project, review } = await seedCompactDecision(actor, { code: `DC-${uid()}`, name: "Decision" });
    const html = renderReportArticle((await buildAssuranceReport(project.id, review.id))!.model, preview);
    for (const id of ["as-evolution", "as-outcomes"]) {
      const sec = section(html, id);
      const svg = sec.slice(sec.indexOf("<svg"), sec.indexOf("</svg>"));
      const table = sec.slice(sec.indexOf("<table"));
      const svgValues = [...svg.matchAll(/class="v">([^<]+)</g)].map((x) => x[1]!);
      expect(svgValues.length).toBeGreaterThan(0);
      for (const v of svgValues) expect(table).toContain(v);
    }
  });
});

describe("report pagination (Chromium print layout)", () => {
  // A4 with the PDF margins (14 mm sides, 16 + 18 mm top/bottom) at 96 dpi: 182 × 263 mm ≈ 688 × 994 px.
  const PAGE = { width: 688, height: 994 };

  it("keeps each visual (heading, explanation, summary, chart) on one page, with no overflow or blank pages", async () => {
    const actor = await newActor();
    const { project: horizon, review } = await seedHorizon(actor, { projectCode: `HORIZON-${uid()}` });
    const { project: decision, review: decided } = await seedCompactDecision(actor, { code: `DC-${uid()}`, name: "D" });
    const docs = [
      renderReportDocument((await buildAssuranceReport(horizon.id, review.id))!.model, preview),
      renderReportDocument((await buildAssuranceReport(decision.id, decided.id))!.model, preview),
    ];
    const browser = await chromium.launch(
      process.env.VO_CHROMIUM_EXECUTABLE ? { executablePath: process.env.VO_CHROMIUM_EXECUTABLE } : {},
    );
    try {
      const page = await browser.newPage({ viewport: PAGE, javaScriptEnabled: false });
      await page.emulateMedia({ media: "print" });
      for (const doc of docs) {
        await page.setContent(doc);
        const layout = await page.evaluate(() => ({
          keep: [...document.querySelectorAll(".rpt-keep")].map((e) => e.getBoundingClientRect().height),
          keepHasHeading: [...document.querySelectorAll(".rpt-keep")].every((e) => e.querySelector("h2")),
          svgWithin: [...document.querySelectorAll("svg.rpt-svg")].every(
            (e) => e.getBoundingClientRect().right <= document.documentElement.clientWidth + 0.5,
          ),
          avoid: [...document.querySelectorAll(".rpt-keep")].map((e) => getComputedStyle(e).breakInside),
          total: document.documentElement.scrollHeight,
        }));
        expect(layout.keep).toHaveLength(2);
        for (const h of layout.keep) expect(h).toBeLessThan(PAGE.height * 0.6); // fits a page with room to spare
        expect(layout.keepHasHeading).toBe(true); // a chart title can never be orphaned from its chart
        expect(layout.avoid.every((v) => v === "avoid")).toBe(true);
        expect(layout.svgWithin).toBe(true);
        const pdf = (await htmlToPdf(doc, "pagination")).toString("latin1");
        const pages = (pdf.match(/\/Type\s*\/Page\b/g) ?? []).length;
        // Keep-together blocks can push content down by at most one block per visual: no blank pages.
        expect(pages).toBeGreaterThanOrEqual(Math.ceil(layout.total / PAGE.height));
        expect(pages).toBeLessThanOrEqual(Math.ceil(layout.total / PAGE.height) + 1);
      }
    } finally {
      await browser.close();
    }
  }, 120_000);
});
