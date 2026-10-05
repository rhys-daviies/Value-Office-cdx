import type { RecommendationReviewEventKind, RecommendationReviewStatus } from "./statuses";

// Phase 4D.10G: Cardaxia's recommendation lifecycle with an internal Cardaxia quality review before issue.
//
//   draft → in internal review → ready to issue → issued → (management decision)
//                     ↓    ↑ (resubmit)      ↓
//                    returned  ←─────────────┘  (return for revision, feedback required)
//
// Stored as recommendation.internal_review_status (null = draft) plus issued_at. A recommendation issued before this
// workflow existed has a null status and reads as issued. The reviewer is internal Cardaxia, never the client VCO.
// Mirrored by vo_recommendation_review_guard.

export type RecommendationState = "draft" | RecommendationReviewStatus | "issued";
export type RecommendationReviewStep = RecommendationReviewEventKind;

export function recommendationState(r: {
  issuedAt: Date | string | null;
  internalReviewStatus: RecommendationReviewStatus | null;
}): RecommendationState {
  if (r.issuedAt) return "issued";
  return r.internalReviewStatus ?? "draft";
}

export const RECOMMENDATION_STATE_LABELS: Record<RecommendationState, string> = {
  draft: "Draft",
  in_internal_review: "In Internal Cardaxia Review",
  returned: "Returned for revision",
  ready_to_issue: "Ready to Issue",
  issued: "Issued to management",
};

/** Narrative, recommended option, options and option paths can change. */
export function recommendationEditable(state: RecommendationState): boolean {
  return state === "draft" || state === "returned";
}

export function reviewStepAllowed(state: RecommendationState, step: RecommendationReviewStep): boolean {
  switch (step) {
    case "submitted":
      return state === "draft" || state === "returned";
    case "returned":
      return state === "in_internal_review" || state === "ready_to_issue";
    case "approved":
      return state === "in_internal_review";
  }
}

export function canIssue(state: RecommendationState): boolean {
  return state === "ready_to_issue";
}
