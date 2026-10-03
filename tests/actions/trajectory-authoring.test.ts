import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Server actions run outside a Next request here: stub the framework calls.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));

import { seedCompactTrajectory, seedCompactTrajectoryDraft } from "@/fixtures/compact";
import { IDLE, type ActionState } from "@/server/actions/state";
import {
  removeTrajectoryPointAction,
  saveTrajectoryPointAction,
  setVersionBasisAction,
} from "@/server/actions/trajectory";
import { finaliseReview } from "@/server/commands/assurance";
import { recordEvidence } from "@/server/commands/evidence";
import { issueRecommendation } from "@/server/commands/options";
import { authoriseInitialVersion, proposeVersion } from "@/server/commands/value-case";
import { authoriseValueChange, createValueChange, proposeValueChange } from "@/server/commands/value-change";
import { db, schema } from "@/server/db/client";
import { getAssuranceWorkspace } from "@/server/queries/assurance";
import {
  getReviewTrajectoryAuthoring,
  getValueTrajectory,
  getVersionTrajectoryAuthoring,
} from "@/server/queries/trajectory";
import { VersionTrajectorySection } from "@/ui/trajectory/milestones";

import { newActor, proposedV1, uid } from "../support/fixtures";

// Phase 4D.9D: consultant trajectory authoring — forms → 4D.9C commands, read models, rendered states.

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const ok = (s: ActionState) => expect(s, JSON.stringify(s)).toMatchObject({ status: "ok" });
const err = (s: ActionState, pattern: RegExp) => {
  expect(s.status).toBe("error");
  expect(s.status === "error" ? `${s.message} ${JSON.stringify(s.fieldErrors ?? {})}` : "").toMatch(pattern);
};
const today = new Date().toISOString().slice(0, 10);
const text = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el).replace(/<[^>]+>/g, " ");

beforeAll(() => {
  process.env.VO_DEV_USER_EMAIL = `trajectory-${uid()}@cardaxia.ai`;
});

async function draft() {
  const actor = await newActor();
  const ctx = await seedCompactTrajectoryDraft(actor, { code: `TD-${uid()}`, name: "Trajectory Draft" });
  const base = { projectId: ctx.project.id };
  const point = (fields: Record<string, string>) =>
    saveTrajectoryPointAction(IDLE, form({ ...base, parent: "version", parentId: ctx.v1.id, ...fields }));
  const basis = (kind: string, start = "2026-01-01", end = "2028-12-31") =>
    setVersionBasisAction(
      IDLE,
      form({ ...base, versionId: ctx.v1.id, valueBasisKind: kind, valuePeriodStart: start, valuePeriodEnd: end }),
    );
  return { actor, ...ctx, point, basis };
}

describe("A. Value Basis authoring", () => {
  it("project dates are only a pre-fill; an explicit save establishes the version basis and period", async () => {
    const d = await draft();
    const before = (await getVersionTrajectoryAuthoring(d.project.id, d.v1.id))!;
    expect(before.version).toMatchObject({ valueBasisKind: null, valuePeriodStart: null, valuePeriodEnd: null });
    expect(before.status).toBe("basis_not_classified");
    // Rendering the editor (which pre-fills the project's dates) writes nothing.
    const html = renderToStaticMarkup(
      createElement(VersionTrajectorySection, {
        projectId: d.project.id,
        currency: "USD",
        authoring: before,
        project: d.project,
      }),
    );
    expect(html).toContain('value="2026-01-01"');
    expect(html).toContain("not saved until you save");
    expect((await getVersionTrajectoryAuthoring(d.project.id, d.v1.id))!.version.valuePeriodStart).toBeNull();

    ok(await d.basis("cumulative_benefit"));
    const after = (await getVersionTrajectoryAuthoring(d.project.id, d.v1.id))!;
    expect(after.version).toMatchObject({
      valueBasisKind: "cumulative_benefit",
      valuePeriodStart: "2026-01-01",
      valuePeriodEnd: "2028-12-31",
    });
    expect(after).toMatchObject({ status: "phasing_not_entered", measure: "cumulative" });
    err(await d.basis("cumulative_benefit", "2029-01-01", "2028-12-31"), /end before it starts/);
  });

  it("all four kinds save; NPV and Other show no milestone editor and say why", async () => {
    const d = await draft();
    for (const kind of ["annual_run_rate", "net_present_value", "other", "cumulative_benefit"]) ok(await d.basis(kind));
    for (const [kind, note] of [
      ["net_present_value", "Time-phased trajectory is not available for NPV."],
      ["other", "Time-phased trajectory is not available for this Value Basis."],
    ] as const) {
      ok(await d.basis(kind));
      const a = (await getVersionTrajectoryAuthoring(d.project.id, d.v1.id))!;
      expect(a).toMatchObject({ status: "basis_not_supported", measure: null, reconciliation: null });
      const html = renderToStaticMarkup(
        createElement(VersionTrajectorySection, {
          projectId: d.project.id,
          currency: "USD",
          authoring: a,
          project: d.project,
        }),
      );
      expect(html).toContain('data-testid="trajectory-unavailable"');
      expect(html).not.toContain('data-testid="plan-milestones"');
      expect(html).toContain(note);
      err(await d.point({ asOf: "2028-12-31", value: "30m" }), /trajectory-capable|Value Basis/);
    }
    // The existing workflow still works: an NPV version proposes with no milestones.
    await proposeVersion(d.actor, { versionId: d.v1.id });
  });
});

describe("B. plan authoring", () => {
  it("add, edit value and date, note, remove; chronological; draft mismatch shown, not blocked; then locked", async () => {
    const d = await draft();
    ok(await d.basis("cumulative_benefit"));
    ok(await d.point({ asOf: "2028-12-31", value: "28m", note: "Full run-rate" }));
    ok(await d.point({ asOf: "2026-01-01", value: "0" }));
    ok(await d.point({ asOf: "2026-12-31", value: "6m" }));
    err(await d.point({ asOf: "2026-12-31", value: "7m" }), /already a milestone on this date/);
    err(await d.point({ asOf: "2029-06-30", value: "1m" }), /outside the Value Period/);

    let a = (await getVersionTrajectoryAuthoring(d.project.id, d.v1.id))!;
    expect(a.points.map((p) => [p.asOf, p.value, p.note])).toEqual([
      ["2026-01-01", "0.00", null],
      ["2026-12-31", "6000000.00", null],
      ["2028-12-31", "28000000.00", "Full run-rate"],
    ]);
    expect(a.reconciliation).toEqual({
      state: "mismatch",
      terminal: "28000000.00",
      governed: "30000000.00",
      difference: "-2000000.00",
    });
    const html = text(
      createElement(VersionTrajectorySection, {
        projectId: d.project.id,
        currency: "USD",
        authoring: a,
        project: d.project,
      }),
    );
    expect(html).toContain(
      "Terminal milestone $28.0m · Version total $30.0m · -$2.0m difference — must reconcile before proposal",
    );

    // Edit the value in place; move a date (the new date is set first, then the old one removed).
    const end = a.points.find((p) => p.asOf === "2028-12-31")!;
    ok(
      await d.point({
        pointId: end.id,
        previousAsOf: end.asOf,
        asOf: "2028-12-31",
        value: "30m",
        note: "Full run-rate",
      }),
    );
    const dec = a.points.find((p) => p.asOf === "2026-12-31")!;
    ok(await d.point({ pointId: dec.id, previousAsOf: dec.asOf, asOf: "2027-03-31", value: "6m" }));
    a = (await getVersionTrajectoryAuthoring(d.project.id, d.v1.id))!;
    expect(a.points.map((p) => p.asOf)).toEqual(["2026-01-01", "2027-03-31", "2028-12-31"]);
    expect(a.reconciliation).toMatchObject({ state: "reconciled" });
    // A refused date move keeps the original milestone.
    const mar = a.points.find((p) => p.asOf === "2027-03-31")!;
    err(await d.point({ pointId: mar.id, previousAsOf: mar.asOf, asOf: "2030-01-01", value: "6m" }), /outside/);
    expect((await getVersionTrajectoryAuthoring(d.project.id, d.v1.id))!.points).toHaveLength(3);

    ok(
      await removeTrajectoryPointAction(
        IDLE,
        form({ projectId: d.project.id, parent: "version", parentId: d.v1.id, pointId: mar.id }),
      ),
    );
    await proposeVersion(d.actor, { versionId: d.v1.id });
    a = (await getVersionTrajectoryAuthoring(d.project.id, d.v1.id))!;
    expect(a.editable).toBe(false);
    const locked = renderToStaticMarkup(
      createElement(VersionTrajectorySection, {
        projectId: d.project.id,
        currency: "USD",
        authoring: a,
        project: d.project,
      }),
    );
    expect(locked).not.toContain("+ Add milestone");
    expect(locked).not.toContain('data-testid="milestone-remove"');
    expect(locked).not.toContain('data-testid="version-basis-form"');
    err(await d.point({ asOf: "2027-06-30", value: "9m" }), /proposed/);
  });
});

async function review() {
  const actor = await newActor();
  const ctx = await seedCompactTrajectory(actor, { code: `TR-${uid()}`, name: "Trajectory Compact" });
  const forecastTotal = async () => (await getAssuranceWorkspace(ctx.project.id, ctx.review.id))!.totals.forecastTotal;
  const authoring = async () =>
    (await getReviewTrajectoryAuthoring(ctx.project.id, ctx.review.id, await forecastTotal()))!;
  const point = (parent: "review" | "scenario", parentId: string, fields: Record<string, string>) =>
    saveTrajectoryPointAction(IDLE, form({ projectId: ctx.project.id, parent, parentId, ...fields }));
  return { actor, ...ctx, authoring, point };
}

describe("C/D. forecast and option-path authoring", () => {
  it("canonical example reads back exactly; forecast edits show reconciliation; dates after the review date", async () => {
    const r = await review();
    let a = await r.authoring();
    expect(a).toMatchObject({
      reviewDate: "2026-09-30",
      measure: "cumulative",
      governing: { versionNumber: 1, valuePeriodEnd: "2028-12-31" },
      forecast: { total: "26000000.00", editable: true, reconciliation: { state: "reconciled" } },
    });
    expect(a.forecast.points.map((p) => [p.asOf, p.value])).toEqual([
      ["2027-12-31", "16000000.00"],
      ["2028-12-31", "26000000.00"],
    ]);
    expect(
      a.options.map((o) => [o.label, o.totalValue, o.points.map((p) => p.value), o.reconciliation?.state]),
    ).toEqual([
      ["Act now", "29000000.00", ["18000000.00", "29000000.00"], "reconciled"],
      ["Delay 3 months", "27000000.00", ["5000000.00", "16500000.00", "27000000.00"], "reconciled"],
      ["No action", "23000000.00", ["5000000.00", "15000000.00", "23000000.00"], "reconciled"],
    ]);

    err(await r.point("review", r.review.id, { asOf: "2026-09-30", value: "1m" }), /after the review date/);
    const end = a.forecast.points.at(-1)!;
    ok(await r.point("review", r.review.id, { pointId: end.id, previousAsOf: end.asOf, asOf: end.asOf, value: "25m" }));
    a = await r.authoring();
    expect(a.forecast.reconciliation).toMatchObject({ state: "mismatch", difference: "-1000000.00" });
    ok(await r.point("review", r.review.id, { pointId: end.id, previousAsOf: end.asOf, asOf: end.asOf, value: "26m" }));

    // Options carry separate paths.
    const none = a.options.find((o) => o.label === "No action")!;
    ok(await r.point("scenario", none.scenarioId, { asOf: "2027-06-30", value: "12m" }));
    a = await r.authoring();
    expect(a.options.find((o) => o.label === "No action")!.points).toHaveLength(4); // 3 canonical (incl. the 30 Dec 2026 pivot) + 1
    expect(a.options.find((o) => o.label === "Act now")!.points).toHaveLength(2);
  });

  it("recommendation issue freezes option paths; finalisation freezes the forecast", async () => {
    const r = await review();
    await issueRecommendation(r.actor, { reviewId: r.review.id });
    let a = await r.authoring();
    expect(a.recommendationIssued).toBe(true);
    expect(a.options.every((o) => !o.editable)).toBe(true);
    expect(a.forecast.editable).toBe(true);
    err(await r.point("scenario", a.options[0]!.scenarioId, { asOf: "2027-06-30", value: "1m" }), /frozen/);

    await finaliseReview(r.actor, { reviewId: r.review.id });
    a = await r.authoring();
    expect(a).toMatchObject({ finalised: true, forecast: { editable: false } });
    err(await r.point("review", r.review.id, { asOf: "2027-06-30", value: "1m" }), /finalised/);
  });
});

describe("E. Value Change re-phasing", () => {
  it("copied plan shown against V1; re-phase; V1 unchanged; kind fixed; period may change; $0 change operable", async () => {
    const r = await review();
    await issueRecommendation(r.actor, { reviewId: r.review.id });
    await finaliseReview(r.actor, { reviewId: r.review.id });
    const v1Before = (await getVersionTrajectoryAuthoring(r.project.id, r.v1.id))!.points;
    const { change, version: v2 } = await createValueChange(r.actor, {
      projectId: r.project.id,
      code: "VC-001",
      reason: "Re-phase",
      statedChangeAmount: "0.00",
    });
    let a = (await getVersionTrajectoryAuthoring(r.project.id, v2.id))!;
    expect(a).toMatchObject({ editable: true, inheritedKind: "cumulative_benefit", previous: { versionNumber: 1 } });
    expect(a.points.map((p) => [p.asOf, p.value])).toEqual(v1Before.map((p) => [p.asOf, p.value]));

    // Re-phase: Dec 2026 $6m → $4m, add Jun 2027 $9m, drop Dec 2027.
    const pt = (asOf: string) => a.points.find((p) => p.asOf === asOf)!;
    const v2form = (fields: Record<string, string>) =>
      saveTrajectoryPointAction(IDLE, form({ projectId: r.project.id, parent: "version", parentId: v2.id, ...fields }));
    ok(await v2form({ pointId: pt("2026-12-31").id, previousAsOf: "2026-12-31", asOf: "2026-12-31", value: "4m" }));
    ok(await v2form({ asOf: "2027-06-30", value: "9m" }));
    ok(
      await removeTrajectoryPointAction(
        IDLE,
        form({ projectId: r.project.id, parent: "version", parentId: v2.id, pointId: pt("2027-12-31").id }),
      ),
    );
    a = (await getVersionTrajectoryAuthoring(r.project.id, v2.id))!;
    const html = text(
      createElement(VersionTrajectorySection, {
        projectId: r.project.id,
        currency: "USD",
        authoring: a,
        project: r.project,
      }),
    );
    expect(html).toContain("Copied from Authorised V1; edits here re-phase the proposed V2 — V1 is unchanged.");
    expect(html).toContain("re-phased");
    expect(html).toContain("new");
    expect(html).toContain("as authorised");
    expect(html).toContain("Removed from V1: 31 Dec 2027 $18.0m");
    expect(html).toContain("Fixed by V1");

    // Kind is fixed (no select offered; a crafted submission is refused); the period may change.
    err(
      await setVersionBasisAction(
        IDLE,
        form({
          projectId: r.project.id,
          versionId: v2.id,
          valueBasisKind: "net_present_value",
          valuePeriodStart: "2026-01-01",
          valuePeriodEnd: "2028-12-31",
        }),
      ),
      /classified as cumulative_benefit/,
    );
    ok(
      await setVersionBasisAction(
        IDLE,
        form({
          projectId: r.project.id,
          versionId: v2.id,
          valueBasisKind: "cumulative_benefit",
          valuePeriodStart: "2026-01-01",
          valuePeriodEnd: "2029-06-30",
        }),
      ),
    );
    expect(
      text(
        createElement(VersionTrajectorySection, {
          projectId: r.project.id,
          currency: "USD",
          authoring: (await getVersionTrajectoryAuthoring(r.project.id, v2.id))!,
          project: r.project,
        }),
      ),
    ).toContain("Value Period changed from V1");
    ok(
      await setVersionBasisAction(
        IDLE,
        form({
          projectId: r.project.id,
          versionId: v2.id,
          valueBasisKind: "cumulative_benefit",
          valuePeriodStart: "2026-01-01",
          valuePeriodEnd: "2028-12-31",
        }),
      ),
    );

    await proposeValueChange(r.actor, { changeId: change.id });
    const ev = await recordEvidence(r.actor, { projectId: r.project.id, code: "E-VC1", title: "VCO approval" });
    await authoriseValueChange(r.actor, {
      changeId: change.id,
      authorisedByPersonId: r.vco.id,
      authorisedOn: today,
      authorisationEvidenceId: ev.id,
    });
    expect((await getVersionTrajectoryAuthoring(r.project.id, r.v1.id))!.points).toEqual(v1Before);
    expect((await getValueTrajectory(r.project.id)).plans.map((p) => p.versionNumber)).toEqual([2, 1]);
  });
});

describe("G/H. run-rate and legacy", () => {
  it("annual run-rate: plan authoring works and the note says realised is not plotted against it", async () => {
    const d = await draft();
    ok(await d.basis("annual_run_rate"));
    ok(await d.point({ asOf: "2028-12-31", value: "30m" }));
    const a = (await getVersionTrajectoryAuthoring(d.project.id, d.v1.id))!;
    expect(a).toMatchObject({ measure: "run_rate", reconciliation: { state: "reconciled" } });
    const html = text(
      createElement(VersionTrajectorySection, {
        projectId: d.project.id,
        currency: "USD",
        authoring: a,
        project: d.project,
      }),
    );
    expect(html).toContain("Annualised run-rate at each milestone");
    expect(html).toContain("Realised value is cumulative, so it is not plotted against a run-rate.");
  });

  it("legacy authorised V1 without basis or period reads safely and is not editable", async () => {
    const actor = await newActor();
    const legacy = await proposedV1(actor);
    await authoriseInitialVersion(actor, {
      versionId: legacy.v1.id,
      authorisedByPersonId: legacy.vco.id,
      authorisedOn: today,
      authorisationEvidenceId: legacy.evidence.id,
    });
    const a = (await getVersionTrajectoryAuthoring(legacy.project.id, legacy.v1.id))!;
    expect(a).toMatchObject({ status: "basis_not_classified", editable: false, measure: null, points: [] });
    const [project] = await db().select().from(schema.project).where(eq(schema.project.id, legacy.project.id));
    const html = text(
      createElement(VersionTrajectorySection, {
        projectId: legacy.project.id,
        currency: "USD",
        authoring: a,
        project: project!,
      }),
    );
    expect(html).toContain("Value Basis not classified");
    expect(html).not.toContain("+ Add milestone");
  });
});
