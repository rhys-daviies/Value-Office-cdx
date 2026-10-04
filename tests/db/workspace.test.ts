import { describe, expect, it } from "vitest";

import { createReview, finaliseReview, upsertValuePositions } from "@/server/commands/assurance";
import { createEmergingDriver, setDriverEstimate } from "@/server/commands/drivers";
import { documentMatterEvidence, requestMatterEvidence } from "@/server/commands/matter-evidence";
import {
  assessMatterWorking,
  closeMatter,
  createMatter,
  setMatterRemediation,
  setMatterStage,
} from "@/server/commands/matters";
import { addStakeholder } from "@/server/commands/stakeholders";
import { authoriseInitialVersion, removeValueDriver } from "@/server/commands/value-case";
import {
  authoriseValueChange,
  createValueChange,
  includeDriverInValueChange,
  proposeValueChange,
} from "@/server/commands/value-change";
import { getValuePositionSummary } from "@/server/queries/assurance";
import { getDriverRegister } from "@/server/queries/drivers";
import { getResponseSummary, listValueChanges } from "@/server/queries/response";
import {
  getContinuousAssuranceWorkspace,
  getGovernedCommitment,
  getOverviewValueOfficeState,
} from "@/server/queries/workspace";

import { newActor, proposedV1, uid } from "../support/fixtures";

// Phase 4D.4 operating read models: the working picture and the governed position side by side,
// never merged. Deterministic "today" so attention dates are testable.

const today = new Date().toISOString().slice(0, 10);
const asOf = "2026-09-30";

/** Authorised V1 (VD-01 $4.8m), Review #1 finalised: forecast $4.5m, realised $1.0m, gap $0.3m. */
async function project() {
  const actor = await newActor();
  const ctx = await proposedV1(actor);
  const v1 = await authoriseInitialVersion(actor, {
    versionId: ctx.v1.id,
    authorisedByPersonId: ctx.vco.id,
    authorisedOn: today,
    authorisationEvidenceId: ctx.evidence.id,
  });
  const review = await createReview(actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate: today });
  await upsertValuePositions(actor, {
    reviewId: review.id,
    positions: [
      {
        forecastRationale: "Synthetic test rationale",
        valueDriverId: ctx.driver.id,
        currentForecast: "4500000.00",
        realisedValue: "1000000.00",
      },
    ],
  });
  await finaliseReview(actor, { reviewId: review.id });
  const { person: owner } = await addStakeholder(actor, { projectId: ctx.project.id, name: "Rita Risk" });
  const raise = (title: string, over: Partial<Parameters<typeof createMatter>[1]> = {}) =>
    createMatter(actor, {
      projectId: ctx.project.id,
      code: `VL-${uid().slice(0, 5)}`,
      title,
      driverIds: [ctx.driver.id],
      ...over,
    });
  // A: quantified 300k (100k unrecoverable), owned, assessing, monitor ending soon.
  const a = await raise("Vendor delay", { responseOwnerPersonId: owner.id });
  await setMatterStage(actor, { matterId: a.id, stage: "assessing" });
  await assessMatterWorking(actor, {
    matterId: a.id,
    workingTotalAmount: "300000.00",
    workingUnrecoverableAmount: "100000.00",
    workingUnrecoverableRationale: "One month lost",
  });
  await setMatterRemediation(actor, { matterId: a.id, remediationPlan: "Re-plan", monitorUntil: "2026-10-05" });
  // B: unquantified, no owner, awaiting evidence, decision date passed.
  const b = await raise("Unsized supplier risk", { requiredDecisionDate: "2026-09-01" });
  await setMatterStage(actor, { matterId: b.id, stage: "awaiting_evidence" });
  await documentMatterEvidence(actor, { matterId: b.id, code: `E-${uid()}`, title: "Supplier letter" });
  await requestMatterEvidence(actor, { matterId: b.id, newRequestTitle: "Assurance", description: "Capacity plan" });
  // C: escalated, quantified 200k, owned.
  const c = await raise("Budget freeze", { responseOwnerPersonId: owner.id });
  await setMatterStage(actor, { matterId: c.id, stage: "escalated" });
  await assessMatterWorking(actor, { matterId: c.id, workingTotalAmount: "200000.00" });
  // D: closed — its working 999k must not count.
  const d = await raise("Resolved issue", { responseOwnerPersonId: owner.id });
  await assessMatterWorking(actor, { matterId: d.id, workingTotalAmount: "999000.00" });
  await closeMatter(actor, { matterId: d.id, closureNote: "Resolved" });
  return { actor, ...ctx, v1, review, owner, a, b, c, d };
}

describe("Continuous Assurance workspace", () => {
  it("sums quantified open matters only, counts unquantified separately, never touches the formal position", async () => {
    const ctx = await project();
    const formalBefore = JSON.stringify(await getValuePositionSummary(ctx.project.id));
    const ws = await getContinuousAssuranceWorkspace(ctx.project.id, asOf);

    expect(ws.matters.map((m) => m.entry.leakage.id).sort()).toEqual([ctx.a.id, ctx.b.id, ctx.c.id].sort());
    expect(ws.closedCount).toBe(1);
    expect(ws.working).toEqual({
      openCount: 3,
      quantifiedCount: 2,
      unquantifiedCount: 1,
      total: "500000.00", // 300k + 200k; the closed 999k and the unquantified matter are excluded
      unrecoverable: "100000.00",
      recoverable: "400000.00", // total − unrecoverable
    });
    expect(ws.stageCounts).toMatchObject({ assessing: 1, awaiting_evidence: 1, escalated: 1, identified: 0 });

    const b = ws.matters.find((m) => m.entry.leakage.id === ctx.b.id)!;
    expect(b.attention.map((x) => x.kind)).toEqual([
      "decision_overdue",
      "awaiting_evidence",
      "no_owner",
      "unquantified",
    ]);
    expect(b).toMatchObject({ evidenceCount: 1, requestsOutstanding: 1, requestsTotal: 1, needsAttention: true });
    const a = ws.matters.find((m) => m.entry.leakage.id === ctx.a.id)!;
    expect(a.attention.map((x) => x.kind)).toEqual(["monitor_ending"]);
    const c = ws.matters.find((m) => m.entry.leakage.id === ctx.c.id)!;
    expect(c.attention.map((x) => x.kind)).toEqual(["escalated"]);
    expect(ws.attention).toEqual({
      needsAttention: 3,
      escalated: 1,
      awaitingEvidence: 1,
      noOwner: 1,
      decisionDates: 1,
      monitorDates: 1,
    });

    // Working leakage never reaches the formal position or formal leakage.
    expect(JSON.stringify(await getValuePositionSummary(ctx.project.id))).toBe(formalBefore);
    const formal = await getResponseSummary(ctx.project.id);
    expect(formal.leakage).toMatchObject({ assessedCount: 0, total: null });
  });

  it("an unquantified-only picture reads as not yet quantified, never zero", async () => {
    const actor = await newActor();
    const ctx = await proposedV1(actor);
    await authoriseInitialVersion(actor, {
      versionId: ctx.v1.id,
      authorisedByPersonId: ctx.vco.id,
      authorisedOn: today,
      authorisationEvidenceId: ctx.evidence.id,
    });
    await createMatter(actor, { projectId: ctx.project.id, code: "VL-1", title: "Unsized" });
    const ws = await getContinuousAssuranceWorkspace(ctx.project.id, asOf);
    expect(ws.working).toMatchObject({ openCount: 1, quantifiedCount: 0, unquantifiedCount: 1, total: null });
  });
});

describe("Overview state", () => {
  it("shows the governed position and the working picture separately", async () => {
    const ctx = await project();
    const o = await getOverviewValueOfficeState(ctx.project.id, asOf);
    expect(o.position.authorisedTotal).toBe("4800000.00");
    expect(o.position.latest!.totals).toMatchObject({
      forecastTotal: "4500000.00",
      realisedTotal: "1000000.00",
      valueGap: "300000.00",
    });
    expect(o.workspace.working).toMatchObject({ openCount: 3, total: "500000.00", unquantifiedCount: 1 });
    expect(o.workspace.attention.needsAttention).toBe(3);
    expect(o.lastReview!.review.id).toBe(ctx.review.id);
    expect(o.response.leakage.total).toBeNull(); // formal leakage stays formal
    expect(o.drivers).toEqual({ inValueCase: 1, emerging: 0, outsideCurrent: 0 });
    expect(o.pendingChanges).toEqual([]);
  });
});

describe("driver presentation, pending changes and the governed commitment", () => {
  it("distinguishes Emerging, Outside Current Value Case and pending Value Change context", async () => {
    const ctx = await project();
    // VC-001 replaces VD-01 with VD-02 and is authorised → VD-01 was authorised in V1 but is outside V2.
    const { driver: replacement } = await createEmergingDriver(ctx.actor, {
      projectId: ctx.project.id,
      code: "VD-02",
      name: "Replacement",
    });
    await setDriverEstimate(ctx.actor, { valueDriverId: replacement.id, workingEstimate: "4000000.00" });
    const { change, version: v2 } = await createValueChange(ctx.actor, {
      projectId: ctx.project.id,
      code: "VC-001",
      reason: "Retire VD-01",
    });
    const [vd01InV2] = (await getGovernedCommitmentDrivers(v2.id)).filter((d) => d.valueDriverId === ctx.driver.id);
    await removeValueDriver(ctx.actor, { driverVersionId: vd01InV2!.id });
    await includeDriverInValueChange(ctx.actor, { changeId: change.id, valueDriverId: replacement.id });
    await proposeValueChange(ctx.actor, { changeId: change.id });
    await authoriseValueChange(ctx.actor, {
      changeId: change.id,
      authorisedByPersonId: ctx.vco.id,
      authorisedOn: today,
      authorisationEvidenceId: ctx.evidence.id,
    });
    const { driver: fresh } = await createEmergingDriver(ctx.actor, {
      projectId: ctx.project.id,
      code: "VD-09",
      name: "Automation",
    });
    await setDriverEstimate(ctx.actor, { valueDriverId: fresh.id, workingEstimate: "3000000.00" });
    const { change: vc2 } = await createValueChange(ctx.actor, { projectId: ctx.project.id, code: "VC-002" });
    await includeDriverInValueChange(ctx.actor, { changeId: vc2.id, valueDriverId: fresh.id });

    const reg = await getDriverRegister(ctx.project.id);
    const vd01 = reg.entries.find((e) => e.driver.id === ctx.driver.id)!;
    const vd09 = reg.entries.find((e) => e.driver.id === fresh.id)!;
    expect(vd01).toMatchObject({ status: "emerging", presentation: "outside_current", formerlyIn: 1 });
    expect(vd09).toMatchObject({
      status: "emerging", // inclusion in a draft changes nothing authorised
      presentation: "emerging",
      authorised: null,
      pendingChange: { code: "VC-002", status: "draft" },
    });

    const changes = await listValueChanges(ctx.project.id);
    expect(changes.find((c) => c.change.code === "VC-002")!.addedDrivers).toEqual([
      { code: "VD-09", name: "Automation" },
    ]);

    expect(changes.find((c) => c.change.code === "VC-001")!.addedDrivers).toEqual([
      { code: "VD-02", name: "Replacement" },
    ]);

    // Governed commitment: V2 in force (VD-02 only), no forecast (Review #1 measured V1).
    const commitment = (await getGovernedCommitment(ctx.project.id))!;
    expect(commitment.version.versionNumber).toBe(2);
    expect(commitment.authorisedTotal).toBe("4000000.00");
    expect(commitment.drivers.map((d) => d.driver.code)).toEqual(["VD-02"]);
    expect(commitment.latestReview).toBeNull();
    const o = await getOverviewValueOfficeState(ctx.project.id, asOf);
    expect(o.drivers).toEqual({ inValueCase: 1, emerging: 1, outsideCurrent: 1 });
    expect(o.pendingChanges.map((c) => c.code)).toEqual(["VC-002"]);
    expect(o.position.authorisedTotal).toBe("4000000.00"); // VD-09's $3.0m working estimate is not authorised
  });

  it("the commitment lists authorised drivers with the latest formal forecast when it measured that version", async () => {
    const ctx = await project();
    const commitment = (await getGovernedCommitment(ctx.project.id))!;
    expect(commitment).toMatchObject({
      authorisedTotal: "4800000.00",
      authorisedByName: "Val Owner",
      forecastTotal: "4500000.00",
      latestReview: { id: ctx.review.id, sequence: 1 },
    });
    expect(commitment.drivers.map((d) => [d.driver.code, d.driver.financialValue, d.forecast?.value])).toEqual([
      ["VD-01", "4800000.00", "4500000.00"],
    ]);
  });
});

async function getGovernedCommitmentDrivers(versionId: string) {
  const { db, schema } = await import("@/server/db/client");
  const { eq } = await import("drizzle-orm");
  return db()
    .select()
    .from(schema.valueDriverVersion)
    .where(eq(schema.valueDriverVersion.valueCaseVersionId, versionId));
}
