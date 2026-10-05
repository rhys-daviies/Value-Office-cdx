import { describe, expect, it } from "vitest";

import { canIssue, recommendationEditable, recommendationState, reviewStepAllowed } from "@/domain/recommendation";

// Phase 4D.10G: the recommendation lifecycle, mirrored by vo_recommendation_review_guard.

describe("recommendation state", () => {
  it("maps stored fields without backfill: historical issued rows (null status) read as issued", () => {
    expect(recommendationState({ issuedAt: null, internalReviewStatus: null })).toBe("draft");
    expect(recommendationState({ issuedAt: new Date(), internalReviewStatus: null })).toBe("issued");
    expect(recommendationState({ issuedAt: new Date(), internalReviewStatus: "ready_to_issue" })).toBe("issued");
    expect(recommendationState({ issuedAt: null, internalReviewStatus: "returned" })).toBe("returned");
  });

  it("transitions, editability and issue", () => {
    const states = ["draft", "in_internal_review", "returned", "ready_to_issue", "issued"] as const;
    const allowed = (step: "submitted" | "returned" | "approved") => states.filter((s) => reviewStepAllowed(s, step));
    expect(allowed("submitted")).toEqual(["draft", "returned"]);
    expect(allowed("returned")).toEqual(["in_internal_review", "ready_to_issue"]);
    expect(allowed("approved")).toEqual(["in_internal_review"]);
    expect(states.filter(recommendationEditable)).toEqual(["draft", "returned"]);
    expect(states.filter(canIssue)).toEqual(["ready_to_issue"]);
  });
});
