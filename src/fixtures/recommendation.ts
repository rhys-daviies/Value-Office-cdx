import { approveRecommendation, issueRecommendation, submitRecommendation } from "@/server/commands/options";
import type { Actor } from "@/server/commands/run";
import { determineValueCaseImpact } from "@/server/commands/value-change";

/**
 * Phase 4D.10G: issue a saved recommendation through the internal Cardaxia review — submit, mark Ready to Issue, then
 * issue to management. Synthetic fixtures and tests only; the same account acts as author and reviewer (the pilot
 * auth model cannot separate them).
 */
export async function issueAfterInternalReview(actor: Actor, input: { reviewId: string }) {
  await submitRecommendation(actor, { reviewId: input.reviewId });
  await approveRecommendation(actor, { reviewId: input.reviewId });
  return issueRecommendation(actor, input);
}

/**
 * Phase 4D.10H: record that a management decision requires a change to the Authorised Value Case (Value Change
 * Proposed) before a Value Change is prepared from it. Synthetic fixtures and tests only.
 */
export async function proposeValueChangeFromDecision(actor: Actor, input: { reviewId: string }) {
  return determineValueCaseImpact(actor, {
    reviewId: input.reviewId,
    determination: "value_change_proposed",
    rationale: "Synthetic: the management decision requires a change to the Authorised Value Case",
  });
}
