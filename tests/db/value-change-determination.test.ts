import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { seedCompactDecided, seedCompactTrajectory } from "@/fixtures/compact";
import { createReview, finaliseReview } from "@/server/commands/assurance";
import { recordEvidence } from "@/server/commands/evidence";
import { COMMANDS } from "@/server/commands/names";
import {
  approveRecommendation,
  issueRecommendation,
  returnRecommendation,
  submitRecommendation,
} from "@/server/commands/options";
import { updateDriverVersion } from "@/server/commands/value-case";
import {
  authoriseValueChange,
  createValueChange,
  determineValueCaseImpact,
  proposeValueChange,
} from "@/server/commands/value-change";
import { db, schema } from "@/server/db/client";
import { getValuePositionSummary } from "@/server/queries/assurance";
import { getExecutiveOverview } from "@/server/queries/overview";
import { getReviewResponse, listValueChanges } from "@/server/queries/response";

import { asCommand, expectDomainError, newActor, sql, uid } from "../support/fixtures";

// Phase 4D.10H: after a management decision the consultant determines whether the Authorised Value Case must change.
// Neither answer changes it; a proposed change goes through the existing Value Change workflow.

const today = new Date().toISOString().slice(0, 10);

/** Compact: Authorised V1 $1.5m; Review #1 finalised at $1.4m (forecast moved); recommendation issued; decision. */
async function decided() {
  const actor = await newActor();
  const { project } = await seedCompactDecided(actor, { code: `VD-${uid()}`, name: "Determination (SYNTHETIC)" });
  const [review] = await db()
    .select()
    .from(schema.assuranceReview)
    .where(eq(schema.assuranceReview.projectId, project.id));
  const [decision] = await db().select().from(schema.decision).where(eq(schema.decision.assuranceReviewId, review!.id));
  const [vc] = await db().select().from(schema.valueCase).where(eq(schema.valueCase.projectId, project.id));
  return { actor, project, review: review!, decision: decision!, vcoPersonId: vc!.vcoPersonId! };
}

const governance = async (projectId: string) => (await getExecutiveOverview(projectId)).governance;

describe("Value Change determination", () => {
  it("No Value Change Required: rationale required, once per decision, authorised value unchanged, audited", async () => {
    const x = await decided();
    const before = await getValuePositionSummary(x.project.id);
    let g = await governance(x.project.id);
    expect(g.latestDecision).toMatchObject({ sequence: 1, stage: "awaiting_determination", determination: null });
    expect(g.nextAction?.label).toBe("Determine the Value Case impact of the Review #1 decision");

    await expectDomainError(
      determineValueCaseImpact(x.actor, {
        reviewId: x.review.id,
        determination: "no_value_change_required",
        rationale: " ",
      }),
      "VO_INVALID_INPUT",
    );
    // Without a determination of Value Change Proposed, no Value Change can be prepared from the decision.
    await expectDomainError(
      createValueChange(x.actor, { projectId: x.project.id, code: "VC-001", decisionId: x.decision.id }),
      "VO_DETERMINATION_REQUIRED",
    );

    const d = await determineValueCaseImpact(x.actor, {
      reviewId: x.review.id,
      determination: "no_value_change_required",
      rationale: "Management action protects the authorised commitment",
    });
    expect(d).toMatchObject({ decisionId: x.decision.id, assuranceReviewId: x.review.id, createdBy: x.actor.userId });
    await expectDomainError(
      determineValueCaseImpact(x.actor, {
        reviewId: x.review.id,
        determination: "value_change_proposed",
        rationale: "x",
      }),
      "VO_DETERMINATION_EXISTS",
    );
    await expectDomainError(
      createValueChange(x.actor, { projectId: x.project.id, code: "VC-001", decisionId: x.decision.id }),
      "VO_NO_VALUE_CHANGE_DETERMINED",
    );

    // Nothing governed moved: Authorised Value, version, formal position, decision; no Value Change exists.
    const after = await getValuePositionSummary(x.project.id);
    expect(after.authorised?.id).toBe(before.authorised?.id);
    expect(after.authorisedTotal).toBe("1500000.00");
    expect(JSON.stringify(after.latest)).toBe(JSON.stringify(before.latest));
    expect(await listValueChanges(x.project.id)).toEqual([]);
    const r = await getReviewResponse(x.project.id, x.review.id);
    expect(r.determination).toMatchObject({ determination: "no_value_change_required", actorName: expect.any(String) });
    g = await governance(x.project.id);
    expect(g).toMatchObject({ latestDecision: { stage: "no_value_change" }, nextAction: null });

    // Assurance continues against the existing authorised case.
    const next = await createReview(x.actor, { projectId: x.project.id, trigger: "ad_hoc", reviewDate: today });
    expect(next.againstVersionId).toBe(after.authorised!.id);

    // Audit and immutability.
    const [audit] = await db()
      .select()
      .from(schema.auditEvent)
      .where(and(eq(schema.auditEvent.tableName, "value_change_determination"), eq(schema.auditEvent.rowId, d.id)));
    expect(audit).toMatchObject({ command: COMMANDS.determineValueCaseImpact, actorUserId: x.actor.userId });
    await expectDomainError(
      asCommand(x.actor, COMMANDS.determineValueCaseImpact, (tx) =>
        tx.execute(sql`update value_change_determination set rationale = 'rewritten' where id = ${d.id}`),
      ),
      "VO_DETERMINATION_IMMUTABLE",
    );
    await expectDomainError(
      asCommand(x.actor, COMMANDS.recordDecision, (tx) =>
        tx.insert(schema.valueChangeDetermination).values({
          projectId: x.project.id,
          assuranceReviewId: x.review.id,
          decisionId: x.decision.id,
          determination: "value_change_proposed",
          rationale: "x",
          createdBy: x.actor.userId,
        }),
      ),
      "VO_WRONG_COMMAND",
    );
  });

  it("Value Change Proposed → prepare (draft, not authorised) → propose → authorise → V2 authoritative", async () => {
    const x = await decided();
    await determineValueCaseImpact(x.actor, {
      reviewId: x.review.id,
      determination: "value_change_proposed",
      rationale: "The decision rebases Alpha Savings",
    });
    let g = await governance(x.project.id);
    expect(g.latestDecision?.stage).toBe("proposed_not_prepared");
    expect(g.nextAction?.label).toBe("Prepare the Value Change proposed in Review #1");
    expect((await listValueChanges(x.project.id)).length).toBe(0); // never created automatically

    const { change, version } = await createValueChange(x.actor, {
      projectId: x.project.id,
      code: "VC-001",
      reason: "Rebase Alpha Savings to $0.9m",
      statedChangeAmount: "-100000.00",
      assuranceReviewId: x.review.id,
      decisionId: x.decision.id,
    });
    expect(change).toMatchObject({
      status: "draft",
      decisionId: x.decision.id,
      reason: "Rebase Alpha Savings to $0.9m",
    });
    expect((await getValuePositionSummary(x.project.id)).authorisedTotal).toBe("1500000.00"); // draft changes nothing
    g = await governance(x.project.id);
    expect(g).toMatchObject({
      latestDecision: { stage: "change_in_progress", change: { code: "VC-001", status: "draft" } },
      openChange: { code: "VC-001", status: "draft" },
      nextAction: { label: "Complete and propose VC-001" },
    });

    const [alpha] = await db()
      .select()
      .from(schema.valueDriverVersion)
      .innerJoin(schema.valueDriver, eq(schema.valueDriver.id, schema.valueDriverVersion.valueDriverId))
      .where(and(eq(schema.valueDriverVersion.valueCaseVersionId, version.id), eq(schema.valueDriver.code, "VD-01")));
    await updateDriverVersion(x.actor, {
      driverVersionId: alpha!.value_driver_version.id,
      financialValue: "900000.00",
    });
    await proposeValueChange(x.actor, { changeId: change.id });
    expect((await governance(x.project.id)).nextAction?.label).toBe("Record the VCO's decision on VC-001");
    const ev = await recordEvidence(x.actor, { projectId: x.project.id, code: `E-${uid()}`, title: "VCO approval" });
    await authoriseValueChange(x.actor, {
      changeId: change.id,
      authorisedByPersonId: x.vcoPersonId,
      authorisedOn: today,
      authorisationEvidenceId: ev.id,
    });
    const summary = await getValuePositionSummary(x.project.id);
    expect(summary.authorised).toMatchObject({ versionNumber: 2 });
    expect(summary.authorisedTotal).toBe("1400000.00");
    g = await governance(x.project.id);
    expect(g).toMatchObject({ latestDecision: { stage: "change_authorised" }, openChange: null, nextAction: null });
    const next = await createReview(x.actor, { projectId: x.project.id, trigger: "ad_hoc", reviewDate: today });
    expect(next.againstVersionId).toBe(summary.authorised!.id); // Assurance now references V2
  });

  it("is refused without a management decision; historical decisions without a determination stay valid", async () => {
    const actor = await newActor();
    const x = await seedCompactTrajectory(actor, { code: `VD-${uid()}`, name: "No decision (SYNTHETIC)" });
    await expectDomainError(
      determineValueCaseImpact(actor, {
        reviewId: x.review.id,
        determination: "no_value_change_required",
        rationale: "x",
      }),
      "VO_DECISION_REQUIRED",
    );
    // A decision recorded before determinations existed is not given one, and an existing Value Change citing it
    // (canonical VC-001, prepared through the fixture's determination) is untouched by these rules.
    const y = await decided();
    expect((await getReviewResponse(y.project.id, y.review.id)).determination).toBeNull();
  });
});

describe("review finalisation vs recommendation state", () => {
  /** Draft review with complete positions, options and a saved recommendation (Trajectory Compact). */
  async function draftWithRecommendation() {
    const actor = await newActor();
    const x = await seedCompactTrajectory(actor, { code: `FR-${uid()}`, name: "Finalise (SYNTHETIC)" });
    return { actor, reviewId: x.review.id };
  }

  it("draft and returned finalise as before; in review and ready to issue are refused; issued finalises", async () => {
    let x = await draftWithRecommendation();
    await finaliseReview(x.actor, { reviewId: x.reviewId }); // draft recommendation: existing behaviour

    x = await draftWithRecommendation();
    await submitRecommendation(x.actor, { reviewId: x.reviewId });
    await expectDomainError(finaliseReview(x.actor, { reviewId: x.reviewId }), "VO_RECOMMENDATION_REVIEW_INCOMPLETE");
    await approveRecommendation(x.actor, { reviewId: x.reviewId });
    await expectDomainError(finaliseReview(x.actor, { reviewId: x.reviewId }), "VO_RECOMMENDATION_REVIEW_INCOMPLETE");
    await issueRecommendation(x.actor, { reviewId: x.reviewId });
    await finaliseReview(x.actor, { reviewId: x.reviewId }); // issued

    x = await draftWithRecommendation();
    await submitRecommendation(x.actor, { reviewId: x.reviewId });
    await returnRecommendation(x.actor, { reviewId: x.reviewId, feedback: "Revise" });
    await finaliseReview(x.actor, { reviewId: x.reviewId }); // returned: existing behaviour
    // …after which the returned recommendation can no longer progress (the review is finalised).
    await expectDomainError(submitRecommendation(x.actor, { reviewId: x.reviewId }), "VO_REVIEW_IMMUTABLE");
  });

  it("a review with no recommendation finalises as before", async () => {
    const x = await decided();
    // Review #1 of the decided fixture already finalised with an issued recommendation; open #2 with no recommendation.
    const actor = x.actor;
    const r2 = await createReview(actor, { projectId: x.project.id, trigger: "ad_hoc", reviewDate: today });
    const ws = await db()
      .select()
      .from(schema.recommendation)
      .where(eq(schema.recommendation.assuranceReviewId, r2.id));
    expect(ws).toHaveLength(0);
    // Positions are required by the existing gates; the recommendation rule adds nothing here.
    await expectDomainError(finaliseReview(actor, { reviewId: r2.id }), "VO_POSITIONS_INCOMPLETE");
  });
});
