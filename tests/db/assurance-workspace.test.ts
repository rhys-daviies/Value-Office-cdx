import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  createReview,
  finaliseReview,
  linkReviewEvidence,
  updateReview,
  upsertValuePositions,
} from "@/server/commands/assurance";
import { updateInformationRequestItem } from "@/server/commands/information-request";
import { assessLeakage } from "@/server/commands/leakage";
import { documentMatterEvidence, requestMatterEvidence } from "@/server/commands/matter-evidence";
import { createMatter, setMatterRemediation, setMatterStage } from "@/server/commands/matters";
import { authoriseInitialVersion } from "@/server/commands/value-case";
import {
  getAssuranceWorkspace,
  getMatterReviewHandoff,
  getNextAssuranceRequirement,
  getValuePositionSummary,
} from "@/server/queries/assurance";
import { getAssuranceMatter, listValueChanges } from "@/server/queries/response";
import { getReviewStory } from "@/server/queries/review-story";
import { getContinuousAssuranceWorkspace } from "@/server/queries/workspace";
import { ReviewStory } from "@/ui/assurance/story";

import { expectDomainError, newActor, proposedV1, uid } from "../support/fixtures";

// Phase 4D.10F: the Assurance operating workspace — the landing read model, review-level reasoning (What changed +
// Why it matters), matter → review handoff, evidence request visibility and the unchanged governed behaviour.

const today = new Date().toISOString().slice(0, 10);
const strip = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

/** Authorised V1 (VD-01 $4.8m), no review yet; one matter with working evidence, a request and a plan. */
async function setup() {
  const actor = await newActor();
  const ctx = await proposedV1(actor);
  await authoriseInitialVersion(actor, {
    versionId: ctx.v1.id,
    authorisedByPersonId: ctx.vco.id,
    authorisedOn: today,
    authorisationEvidenceId: ctx.evidence.id,
  });
  const matter = await createMatter(actor, {
    projectId: ctx.project.id,
    code: "VL-001",
    title: "Supplier capacity unconfirmed",
    driverIds: [ctx.driver.id],
  });
  await setMatterStage(actor, { matterId: matter.id, stage: "awaiting_evidence" });
  const evidence = await documentMatterEvidence(actor, {
    matterId: matter.id,
    code: `E-${uid()}`,
    title: "Supplier status letter",
  });
  const item = await requestMatterEvidence(actor, {
    matterId: matter.id,
    newRequestTitle: "Assurance evidence",
    description: "Supplier capacity plan",
  });
  const item2 = await requestMatterEvidence(actor, {
    matterId: matter.id,
    informationRequestId: item.informationRequestId,
    description: "Revised schedule",
  });
  await setMatterRemediation(actor, { matterId: matter.id, remediationPlan: "Secondary supplier on standby" });
  return { actor, ...ctx, matter, evidence, item, item2 };
}

describe("Assurance landing read model", () => {
  it("authorised position with no formal review; active matters, evidence outstanding and remediation", async () => {
    const x = await setup();
    const summary = await getValuePositionSummary(x.project.id);
    expect(summary.authorisedTotal).toBe("4800000.00");
    expect(summary.latest).toBeNull(); // no formal review yet
    const cadence = await getNextAssuranceRequirement(x.project.id);
    expect(cadence.next).not.toBeNull(); // a review requirement is always presented when derivable

    const ws = await getContinuousAssuranceWorkspace(x.project.id);
    expect(ws.draftReview).toBeNull();
    expect(ws.evidenceOutstanding).toEqual({ items: 2, matters: 1 });
    expect(ws.remediation).toEqual({ planned: 1, unplanned: 0, monitored: 0 });
    const m = ws.matters[0]!;
    expect(m).toMatchObject({
      evidenceCount: 1,
      requestsOutstanding: 2,
      requests: { open: 2, partial: 0, received: 0, unavailable: 0 },
      requestState: { state: "requested", label: "Evidence requested · 2 items outstanding" },
      lastFormalSequence: null,
      assessedInDraft: false,
    });

    // Request status moves with the existing Information Request items (visibility only).
    await updateInformationRequestItem(x.actor, { itemId: x.item.id, status: "partially_received" });
    let w = (await getContinuousAssuranceWorkspace(x.project.id)).matters[0]!;
    expect(w.requestState?.label).toBe("Evidence partially received · 2 items outstanding");
    await updateInformationRequestItem(x.actor, { itemId: x.item.id, status: "received" });
    await updateInformationRequestItem(x.actor, { itemId: x.item2.id, status: "not_available" });
    w = (await getContinuousAssuranceWorkspace(x.project.id)).matters[0]!;
    expect(w.requestState).toMatchObject({ state: "received", label: "Evidence received · 1 item unavailable" });
    expect((await getContinuousAssuranceWorkspace(x.project.id)).evidenceOutstanding).toEqual({ items: 0, matters: 0 });
  });
});

describe("review reasoning, handoff and governed behaviour", () => {
  it("records What changed and Why it matters at creation; both reach the story in order; finalised is immutable", async () => {
    const x = await setup();
    const review = await createReview(x.actor, {
      projectId: x.project.id,
      trigger: "ad_hoc",
      reviewDate: today,
      whatChanged: "Supplier capacity at risk",
      whyItMatters: "VD-01 could fall short by $0.3m",
    });
    expect(review).toMatchObject({
      whatChanged: "Supplier capacity at risk",
      whyItMatters: "VD-01 could fall short by $0.3m",
    });

    // Continuous work becomes formal only through the existing links.
    let ws = await getContinuousAssuranceWorkspace(x.project.id);
    expect(ws.draftReview).toEqual({ id: review.id, sequence: 1 });
    let handoff = await getMatterReviewHandoff(x.project.id, x.matter.id);
    expect(handoff).toMatchObject({ draft: { id: review.id, sequence: 1 }, assessed: false });
    expect(handoff.reliedOn.size).toBe(0);
    await linkReviewEvidence(x.actor, {
      reviewId: review.id,
      evidenceId: x.evidence.id,
      relevanceNote: "Supports Assurance matter VL-001",
    });
    await assessLeakage(x.actor, { leakageId: x.matter.id, reviewId: review.id, totalAmount: "300000.00" });
    handoff = await getMatterReviewHandoff(x.project.id, x.matter.id);
    expect(handoff.assessed).toBe(true);
    expect([...handoff.reliedOn]).toEqual([x.evidence.id]);
    expect((await getContinuousAssuranceWorkspace(x.project.id)).matters[0]!.assessedInDraft).toBe(true);

    // 4D.10E presentation: unchanged vs changed movement, optional related matter.
    await upsertValuePositions(x.actor, {
      reviewId: review.id,
      positions: [{ valueDriverId: x.driver.id, currentForecast: "4800000.00" }],
    });
    let row = (await getAssuranceWorkspace(x.project.id, review.id))!.rows[0]!;
    expect(row.governed).toEqual({
      baseline: "4800000.00",
      source: "authorised",
      moved: false,
      rationaleRequired: false,
    });
    await upsertValuePositions(x.actor, {
      reviewId: review.id,
      positions: [
        {
          valueDriverId: x.driver.id,
          currentForecast: "4500000.00",
          forecastRationale: "Supplier capacity",
          valueLeakageId: x.matter.id,
        },
      ],
    });
    row = (await getAssuranceWorkspace(x.project.id, review.id))!.rows[0]!;
    expect(row.governed).toMatchObject({ baseline: "4800000.00", moved: true, rationaleRequired: true });
    expect(row.valueLeakageId).toBe(x.matter.id);

    const story = (await getReviewStory(x.project.id, review.id))!;
    expect(story.review).toMatchObject({
      whatChanged: "Supplier capacity at risk",
      whyItMatters: "VD-01 could fall short by $0.3m",
    });
    const text = strip(renderToStaticMarkup(createElement(ReviewStory, { story, currency: "USD", base: "/p" })));
    const at = (s: string) => text.indexOf(s);
    expect(at("What changed")).toBeGreaterThan(-1);
    expect(at("What changed")).toBeLessThan(at("Why it matters"));
    expect(at("Why it matters")).toBeLessThan(at("Value position"));
    expect(at("Value position")).toBeLessThan(at("Assurance matters"));
    expect(at("Assurance matters")).toBeLessThan(at("Cardaxia response"));
    expect(at("Management decision")).toBeLessThan(at("Value Case impact"));
    expect(text).toContain("VD-01 could fall short by $0.3m");

    // Finalisation: the formal snapshot is unchanged; Authorised Value is untouched; no Value Change is created.
    await finaliseReview(x.actor, { reviewId: review.id });
    const summary = await getValuePositionSummary(x.project.id);
    expect(summary.authorisedTotal).toBe("4800000.00");
    expect(summary.latest?.totals.forecastTotal).toBe("4500000.00");
    expect(await listValueChanges(x.project.id)).toEqual([]);
    const matter = (await getAssuranceMatter(x.project.id, x.matter.id))!;
    expect(matter.formal).toHaveLength(1);
    expect(matter.formal[0]).toMatchObject({ reviewSequence: 1, snapshotted: true, stage: "awaiting_evidence" });
    await setMatterStage(x.actor, { matterId: x.matter.id, stage: "escalated" });
    expect((await getAssuranceMatter(x.project.id, x.matter.id))!.formal[0]!.stage).toBe("awaiting_evidence");

    ws = await getContinuousAssuranceWorkspace(x.project.id);
    expect(ws.draftReview).toBeNull();
    expect(ws.matters[0]).toMatchObject({ lastFormalSequence: 1, assessedInDraft: false });

    await expectDomainError(
      updateReview(x.actor, { reviewId: review.id, whyItMatters: "rewritten" }),
      "VO_REVIEW_IMMUTABLE",
    );
  });
});
