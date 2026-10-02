import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { seedCompactDecision, seedCompactEvolution } from "@/fixtures/compact";
import { seedHorizon } from "@/fixtures/horizon";
import { createReview, finaliseReview, upsertValuePositions } from "@/server/commands/assurance";
import { saveRecommendation, upsertScenario } from "@/server/commands/options";
import { authoriseInitialVersion } from "@/server/commands/value-case";
import { db, schema } from "@/server/db/client";
import { getValueCaseEvolution } from "@/server/queries/evolution";
import {
  type AlternativeValueOutcomes as Data,
  getAlternativeValueOutcomes,
  getLatestValueDecision,
} from "@/server/queries/outcomes";
import { AlternativeValueOutcomes } from "@/ui/outcomes/outcomes";
import { asc, eq } from "drizzle-orm";

import { DomainError } from "@/domain/errors";

import { newActor, proposedV1, sql, uid } from "../support/fixtures";

// Phase 4D.6: Alternative Value Outcomes — one review's stored options and decision economics, with the
// review's own Authorised Value and formal forecast as references. Point in time; not a trajectory.

const render = (data: Data, variant: "full" | "compact" = "full") =>
  renderToStaticMarkup(createElement(AlternativeValueOutcomes, { data, variant }));

async function reviews(projectId: string) {
  return db()
    .select({ id: schema.assuranceReview.id, sequence: schema.assuranceReview.sequence })
    .from(schema.assuranceReview)
    .where(eq(schema.assuranceReview.projectId, projectId))
    .orderBy(asc(schema.assuranceReview.sequence));
}

/** Every amount string exposed by the read model. */
const amounts = (d: Data) =>
  [
    d.authorisedValue,
    d.currentFormalForecast,
    d.differenceFromRecommendation,
    ...d.outcomes.map((o) => o.totalValue),
  ].filter((v): v is string => v !== null);

describe("Alternative Value Outcomes read model", () => {
  it("Decision Compact: references, outcomes in semantic order, recommendation and decision kept apart", async () => {
    const actor = await newActor();
    const { project, review } = await seedCompactDecision(actor, { code: `DC-${uid()}`, name: "Decision" });
    const d = (await getAlternativeValueOutcomes(project.id, review.id))!;

    expect(d.review).toMatchObject({ sequence: 1, finalised: true, againstVersionNumber: 1 });
    expect(d.authorisedValue).toBe("1500000.00"); // reference, not an option
    expect(d.currentFormalForecast).toBe("1400000.00"); // reference, not an option
    expect(d.outcomes.map((o) => [o.label, o.totalValue, o.recommended, o.selected])).toEqual([
      ["Accelerate supplier onboarding", "1900000.00", true, false],
      ["Current trajectory", "1400000.00", false, false],
      ["Defer remediation", "1200000.00", false, false],
      ["Phase the rollout", "1600000.00", false, true],
    ]);
    expect(d.recommendation!.scenarioId).not.toBe(d.decision!.selectedScenarioId);
    expect(d.differenceFromRecommendation).toBe("-300000.00");
    expect(amounts(d).every((v) => /^-?\d+\.\d{2}$/.test(v))).toBe(true); // decimal strings

    // Not options: draft VC-001 (+$0.25m → $1.75m), working matter ($0.35m), emerging driver ($0.2m).
    for (const v of ["250000.00", "1750000.00", "350000.00", "200000.00"]) expect(amounts(d)).not.toContain(v);
    const html = render(d);
    expect(html).not.toContain("VC-001");
    expect(html).not.toContain("VL-301");
    expect(html).not.toContain("VD-04");

    // Overview: the latest finalised review's context; a later draft review does not displace it.
    await createReview(actor, { projectId: project.id, trigger: "ad_hoc", reviewDate: review.reviewDate });
    expect((await getLatestValueDecision(project.id)).recorded!.review.id).toBe(review.id);
  });

  it("an older review keeps its own measured-against version and forecast; one scenario can hold both roles", async () => {
    const actor = await newActor();
    const { project } = await seedCompactEvolution(actor, { code: `EV-${uid()}`, name: "Evolution" });
    const [, r2, r3] = await reviews(project.id);
    const d = (await getAlternativeValueOutcomes(project.id, r2!.id))!;

    expect(d.review.againstVersionNumber).toBe(1); // not V2, which is now in force
    expect(d.authorisedValue).toBe("1500000.00"); // not V2's $1.3m
    expect(d.currentFormalForecast).toBe("1300000.00"); // not Review #3's $1.2m
    const both = d.outcomes.filter((o) => o.recommended || o.selected);
    expect(both).toEqual([
      expect.objectContaining({ label: "Rebase Alpha Savings", recommended: true, selected: true }),
    ]);
    expect(d.differenceFromRecommendation).toBe("0.00"); // zero preserved
    expect(render(d)).toContain("Client selected Cardaxia&#x27;s recommendation");

    // The latest finalised review (#3) has no options: the latest recorded decision is still Review #2's (4D.9L),
    // identified as Review #2's — Review #3 gains nothing.
    expect((await getAlternativeValueOutcomes(project.id, r3!.id))!.outcomes).toEqual([]);
    const latest = await getLatestValueDecision(project.id);
    expect(latest.recorded!.review).toMatchObject({ id: r2!.id, sequence: 2, againstVersionNumber: 1 });
    expect(latest.awaiting).toBeNull();
  });

  it("handles a missing (unissued) recommendation and a missing decision", async () => {
    const actor = await newActor();
    const ctx = await proposedV1(actor);
    await authoriseInitialVersion(actor, {
      versionId: ctx.v1.id,
      authorisedByPersonId: ctx.vco.id,
      authorisedOn: "2026-01-10",
      authorisationEvidenceId: ctx.evidence.id,
    });
    const review = await createReview(actor, {
      projectId: ctx.project.id,
      trigger: "ad_hoc",
      reviewDate: "2026-02-01",
    });
    await upsertValuePositions(actor, {
      reviewId: review.id,
      positions: [{ valueDriverId: ctx.driver.id, currentForecast: "4500000.00" }],
    });
    const a = await upsertScenario(actor, {
      reviewId: review.id,
      label: "Act",
      kind: "recommended", // a recommendation must reference the review's recommended scenario (DB guard)
      totalValue: "4700000.00",
    });
    await upsertScenario(actor, { reviewId: review.id, label: "Wait", kind: "alternative", totalValue: "4400000.00" });
    await saveRecommendation(actor, { reviewId: review.id, scenarioId: a.id, narrative: "Draft only" }); // not issued
    await finaliseReview(actor, { reviewId: review.id });

    const d = (await getAlternativeValueOutcomes(ctx.project.id, review.id))!;
    expect(d.recommendation).toBeNull(); // an unissued recommendation is not presented as Cardaxia's position
    expect(d.decision).toBeNull();
    expect(d.outcomes.every((o) => !o.recommended && !o.selected)).toBe(true);
    expect(d.differenceFromRecommendation).toBeNull();
    const html = render(d);
    expect(html).toContain("Not issued");
    expect(html).toContain("No decision recorded");
    expect(await getLatestValueDecision(ctx.project.id)).toEqual({ recorded: null, awaiting: null }); // no decision context
  });

  it("every scenario returned has a governed quantified total: unquantified scenarios cannot be persisted", async () => {
    const actor = await newActor();
    const { project, review } = await seedCompactDecision(actor, { code: `DC-${uid()}`, name: "Decision" });
    const d = (await getAlternativeValueOutcomes(project.id, review.id))!;
    expect(d.outcomes.length).toBeGreaterThan(0);
    expect(d.outcomes.every((o) => /^-?\d+\.\d{2}$/.test(o.totalValue))).toBe(true);

    // The command refuses a scenario without a total (validated before any write)…
    const err = await upsertScenario(actor, {
      reviewId: review.id,
      label: "No total",
      kind: "alternative",
    } as never).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe("VO_INVALID_INPUT");
    // …and the column is NOT NULL, so no stored scenario can lack one (no impossible state is constructed).
    const { rows } = await db().execute<{ is_nullable: string }>(
      sql`select is_nullable from information_schema.columns where table_name = 'scenario' and column_name = 'total_value'`,
    );
    expect(rows[0]!.is_nullable).toBe("NO");
  });

  it("Horizon: $15.5m authorised, $14.7m forecast, $15.3m recommendation, $14.9m selected, −$0.4m", async () => {
    const actor = await newActor();
    const { project } = await seedHorizon(actor, { projectCode: `HORIZON-${uid()}` });
    const latest = (await getLatestValueDecision(project.id)).recorded!;
    expect(latest.authorisedValue).toBe("15500000.00");
    expect(latest.currentFormalForecast).toBe("14700000.00");
    const rec = latest.outcomes.find((o) => o.recommended)!;
    const sel = latest.outcomes.find((o) => o.selected)!;
    expect(rec.totalValue).toBe("15300000.00");
    expect(sel.totalValue).toBe("14900000.00");
    expect(rec.id).not.toBe(sel.id);
    expect(latest.differenceFromRecommendation).toBe("-400000.00");
    // VC-002 (−$0.6m → $14.9m proposed) is a Value Change, not an outcome: the only $14.9m is the
    // client-selected option, and the −$0.6m appears nowhere.
    expect(latest.outcomes.filter((o) => o.totalValue === "14900000.00")).toHaveLength(1);
    expect(amounts(latest)).not.toContain("-600000.00");
    expect(render(latest)).not.toContain("VC-002");

    const html = render(latest, "compact");
    for (const t of ["Latest Value Decision", "$15.5m", "$14.7m", "$15.3m", "$14.9m", "-$0.4m", "Point in time"]) {
      expect(html).toContain(t);
    }
  });
});

describe("Alternative Value Outcomes component", () => {
  it("companion table carries the same values and roles as the chart; governed, not working", async () => {
    const actor = await newActor();
    const { project, review } = await seedCompactDecision(actor, { code: `DC-${uid()}`, name: "Decision" });
    const d = (await getAlternativeValueOutcomes(project.id, review.id))!;
    const html = render(d);
    expect(html).toContain("Alternative Value Outcomes");
    expect(html).not.toMatch(/trajector(y|ies)<\/h2>/i);
    expect(html).toContain("Point in time");
    expect(html).not.toContain("violet");
    expect(html).toContain("<table");
    const rowCount = (html.match(/data-testid="outcome-row"/g) ?? []).length;
    expect(rowCount).toBe(4); // each scenario once
    for (const t of [
      "$1.5m",
      "$1.4m",
      "$1.9m",
      "$1.6m",
      "$1.2m",
      "-$0.3m",
      "Authorised reference",
      "Current formal forecast",
    ]) {
      expect(html).toContain(t);
    }
    expect(html).toContain("Scenario · Cardaxia recommendation");
    expect(html).toContain("Scenario · Client selected");
  });

  it("leaves the 4D.5 Value Case Evolution values unchanged", async () => {
    const actor = await newActor();
    const { project } = await seedCompactEvolution(actor, { code: `EV-${uid()}`, name: "Evolution" });
    const e = await getValueCaseEvolution(project.id);
    expect(e.formalPositions.map((p) => [p.currentForecast, p.realisedValue])).toEqual([
      ["1400000.00", "0.00"],
      ["1300000.00", "300000.00"],
      ["1200000.00", "600000.00"],
    ]);
  });
});
