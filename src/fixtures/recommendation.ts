import { approveRecommendation, issueRecommendation, submitRecommendation } from "@/server/commands/options";
import type { Actor } from "@/server/commands/run";

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
