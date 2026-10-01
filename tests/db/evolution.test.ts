import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { seedCompactEvolution } from "@/fixtures/compact";
import { seedHorizon } from "@/fixtures/horizon";
import { createReview, finaliseReview, upsertValuePositions } from "@/server/commands/assurance";
import { recordEvidence } from "@/server/commands/evidence";
import { addValueDriver, authoriseInitialVersion } from "@/server/commands/value-case";
import {
  authoriseValueChange,
  createValueChange,
  proposeValueChange,
  withdrawValueChange,
} from "@/server/commands/value-change";
import { getValuePositionSummary } from "@/server/queries/assurance";
import { getValueCaseEvolution, type ValueCaseEvolution as Evolution } from "@/server/queries/evolution";
import { listValueChanges } from "@/server/queries/response";
import { getContinuousAssuranceWorkspace } from "@/server/queries/workspace";
import { ValueCaseEvolution } from "@/ui/evolution/evolution";

import { newActor, proposedV1, uid } from "../support/fixtures";

// Phase 4D.5: Value Case Evolution is governed history only — Original Business Case, Authorised
// versions and finalised reviews' formal Current Forecast and Realised Value.

const render = (evolution: Evolution) => renderToStaticMarkup(createElement(ValueCaseEvolution, { evolution }));

/** Every amount string the read model exposes, for exclusion checks. */
function amounts(e: Evolution): string[] {
  return [
    e.originalBusinessCase?.value,
    ...e.authorisedVersions.map((a) => a.authorisedValue),
    ...e.formalPositions.flatMap((p) => [p.againstAuthorisedValue, p.currentForecast, p.realisedValue, p.valueGap]),
    ...e.events.map((x) => (x.kind === "original" ? null : x.inForceValue)),
  ].filter((v): v is string => typeof v === "string");
}

async function evolve() {
  const actor = await newActor();
  const { project } = await seedCompactEvolution(actor, { code: `EV-${uid()}`, name: "Evolution" });
  return { actor, project };
}

describe("Value Case Evolution read model", () => {
  it("returns the Original Business Case, authorised versions and finalised positions in governed order", async () => {
    const { project } = await evolve();
    const e = await getValueCaseEvolution(project.id);

    expect(e.currency).toBe("USD");
    expect(e.originalBusinessCase).toEqual({
      versionNumber: 0,
      title: "Original Business Case",
      value: "2000000.00",
      date: null, // never invented
    });
    expect(e.authorisedVersions.map((a) => [a.versionNumber, a.status, a.authorisedValue, a.date, a.vcoName])).toEqual([
      [1, "superseded", "1500000.00", "2026-01-15", "Test VCO"],
      [2, "authorised", "1300000.00", "2026-07-15", "Test VCO"],
    ]);
    expect(e.authorisedVersions.map((a) => a.valueChangeCode)).toEqual([null, "VC-001"]);
    expect(
      e.formalPositions.map((p) => [
        p.sequence,
        p.date,
        p.againstVersionNumber,
        p.againstAuthorisedValue,
        p.currentForecast,
        p.realisedValue,
        p.valueGap,
      ]),
    ).toEqual([
      [1, "2026-03-31", 1, "1500000.00", "1400000.00", "0.00", "100000.00"], // actual zero stays zero
      [2, "2026-06-30", 1, "1500000.00", "1300000.00", "300000.00", "200000.00"],
      [3, "2026-09-30", 2, "1300000.00", "1200000.00", "600000.00", "100000.00"],
    ]);
    expect(e.events.map((x) => x.key)).toEqual(["original", "v1", "r1", "r2", "v2", "r3"]);
    // The step line: the Authorised Value in force at each event.
    expect(e.events.map((x) => (x.kind === "original" ? null : x.inForceValue))).toEqual([
      null,
      "1500000.00",
      "1500000.00",
      "1500000.00",
      "1300000.00",
      "1300000.00",
    ]);
    // Decimal strings throughout — never JS numbers.
    expect(amounts(e).every((v) => typeof v === "string" && /^-?\d+\.\d{2}$/.test(v))).toBe(true);
  });

  it("excludes draft reviews, draft/proposed Value Changes, working estimates and working leakage", async () => {
    const { actor, project } = await evolve();
    const governed = [
      "2000000.00",
      "1500000.00",
      "1300000.00",
      "1400000.00",
      "1200000.00",
      "0.00",
      "300000.00",
      "600000.00",
      "100000.00",
      "200000.00", // Review #2 Value Gap (1.5m − 1.3m)
    ].sort();
    const unique = (e: Evolution) => [...new Set(amounts(e))].sort();

    // Working Value Leakage ($0.45m) and the emerging driver ($0.2m estimate; $0.45m in draft V3) exist…
    const ws = await getContinuousAssuranceWorkspace(project.id);
    expect(ws.working.total).toBe("450000.00");
    const before = await getValueCaseEvolution(project.id);
    expect(unique(before)).toEqual(governed);
    expect(before.authorisedVersions.map((a) => a.versionNumber)).toEqual([1, 2]); // draft V3 excluded
    expect(amounts(before)).not.toContain("450000.00");
    expect(amounts(before)).not.toContain("1750000.00"); // what V3 would total

    // A draft review is not a formal position.
    await createReview(actor, { projectId: project.id, trigger: "ad_hoc", reviewDate: "2026-10-01" });
    const withDraft = await getValueCaseEvolution(project.id);
    expect(withDraft.formalPositions.map((p) => p.sequence)).toEqual([1, 2, 3]);

    // A proposed (not yet authorised) Value Change is still not part of the governed evolution.
    const vc2 = (await listValueChanges(project.id)).find((c) => c.change.code === "VC-002")!;
    await proposeValueChange(actor, { changeId: vc2.change.id });
    const proposed = await getValueCaseEvolution(project.id);
    expect(proposed.authorisedVersions.map((a) => a.versionNumber)).toEqual([1, 2]);
    expect(unique(proposed)).toEqual(governed);
  });

  it("keeps a review measured against an older version on that version", async () => {
    const actor = await newActor();
    const ctx = await proposedV1(actor);
    await authoriseInitialVersion(actor, {
      versionId: ctx.v1.id,
      authorisedByPersonId: ctx.vco.id,
      authorisedOn: "2026-01-10",
      authorisationEvidenceId: ctx.evidence.id,
    });
    // Review #1 is finalised against V1. V2 is authorised later, with a recorded authorisation date
    // (2026-02-01) that precedes Review #1's date (2026-03-01).
    const review = await createReview(actor, {
      projectId: ctx.project.id,
      trigger: "ad_hoc",
      reviewDate: "2026-03-01",
    });
    await upsertValuePositions(actor, {
      reviewId: review.id,
      positions: [{ valueDriverId: ctx.driver.id, currentForecast: "4500000.00" }], // realised not recorded
    });
    await finaliseReview(actor, { reviewId: review.id });
    const { change, version: v2 } = await createValueChange(actor, {
      projectId: ctx.project.id,
      code: "VC-001",
      reason: "Add a driver",
    });
    await addValueDriver(actor, { versionId: v2.id, code: "VD-02", name: "Extra", financialValue: "200000.00" });
    await proposeValueChange(actor, { changeId: change.id });
    const ev = await recordEvidence(actor, { projectId: ctx.project.id, code: "E-V2", title: "V2 authorisation" });
    await authoriseValueChange(actor, {
      changeId: change.id,
      authorisedByPersonId: ctx.vco.id,
      authorisedOn: "2026-02-01",
      authorisationEvidenceId: ev.id,
    });

    const e = await getValueCaseEvolution(ctx.project.id);
    expect(e.originalBusinessCase).toBeNull(); // no V0 recorded: nothing invented
    expect(e.events.map((x) => x.key)).toEqual(["v1", "v2", "r1"]); // placed by its date…
    const r1 = e.formalPositions[0]!;
    expect(r1.againstVersionNumber).toBe(1); // …but never reassigned to V2
    expect(r1.againstAuthorisedValue).toBe("4800000.00");
    expect(r1.valueGap).toBe("300000.00");
    expect(r1.realisedValue).toBeNull(); // missing realised is not zero
    const last = e.events.at(-1)!;
    expect(last.kind === "review" && last.inForceValue).toBe("5000000.00"); // V2 in force at that date
    expect(render(e)).toContain("Measured against V1");
    expect(render(e)).toContain("Not recorded");
  });

  it("excludes withdrawn versions and handles a project before V1", async () => {
    const actor = await newActor();
    const ctx = await proposedV1(actor);
    const before = await getValueCaseEvolution(ctx.project.id);
    expect(before.authorisedVersions).toEqual([]); // proposed V1 is not authorised
    expect(before.events).toEqual([]);
    const html = render(before);
    expect(html).toContain('data-testid="evolution-empty"');
    expect(html).not.toContain('data-testid="evolution-chart"');

    await authoriseInitialVersion(actor, {
      versionId: ctx.v1.id,
      authorisedByPersonId: ctx.vco.id,
      authorisedOn: "2026-01-10",
      authorisationEvidenceId: ctx.evidence.id,
    });
    const { change } = await createValueChange(actor, { projectId: ctx.project.id, code: "VC-001", reason: "x" });
    await withdrawValueChange(actor, { changeId: change.id, closureNote: "Not pursued" });
    const v1Only = await getValueCaseEvolution(ctx.project.id);
    expect(v1Only.authorisedVersions.map((a) => [a.versionNumber, a.authorisedValue])).toEqual([[1, "4800000.00"]]);
    expect(v1Only.formalPositions).toEqual([]);
    const v1Html = render(v1Only);
    expect(v1Html).toContain("No formal Assurance positions recorded yet.");
    expect(v1Html).toContain('data-testid="evolution-row-v1"');
    expect(v1Html).toContain("Governed history");
  });

  it("Horizon: $18.0m original, $15.5m authorised, $14.7m forecast, $2.8m realised, $0.8m gap", async () => {
    const actor = await newActor();
    const { project } = await seedHorizon(actor, { projectCode: `HORIZON-${uid()}` });
    const e = await getValueCaseEvolution(project.id);
    expect(e.originalBusinessCase?.value).toBe("18000000.00");
    expect(e.originalBusinessCase?.date).toBeNull();
    expect(e.authorisedVersions.map((a) => [a.versionNumber, a.authorisedValue])).toEqual([[1, "15500000.00"]]);
    expect(e.formalPositions).toHaveLength(1);
    expect(e.formalPositions[0]).toMatchObject({
      againstVersionNumber: 1,
      currentForecast: "14700000.00",
      realisedValue: "2800000.00",
      valueGap: "800000.00",
    });
    // VC-002 is proposed only: its $14.9m V2 is not part of the governed evolution.
    expect(amounts(e)).not.toContain("14900000.00");
    expect((await getValuePositionSummary(project.id)).latest!.totals.valueGap).toBe("800000.00");

    const html = render(e);
    for (const text of ["$18.0m", "$15.5m", "$14.7m", "$2.8m", "$0.8m", "Not dated"]) expect(html).toContain(text);
  });
});

describe("Value Case Evolution component", () => {
  it("renders the legend, a governed tag and a companion table with the same history", async () => {
    const { project } = await evolve();
    const e = await getValueCaseEvolution(project.id);
    const html = render(e);
    for (const label of ["Authorised Value", "Formal Forecast", "Realised Value", "Original Business Case"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Governed history");
    expect(html).not.toContain("violet"); // no working visual language inside the governed chart
    expect(html).toContain("<table");
    for (const key of ["original", "v1", "r1", "r2", "v2", "r3"]) expect(html).toContain(`evolution-row-${key}`);
    for (const text of ["$2.0m", "$1.5m", "$1.4m", "$1.3m", "$1.2m", "$0.3m", "$0.6m", "via VC-001"]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("VC-002");
    expect(html).not.toContain("$1.8m"); // draft V3 total (1.75m)
  });
});
