import { describe, expect, it } from "vitest";

import { type GovernanceFacts, postAuthorisationNextAction, valueCaseImpactStage } from "@/domain/value-case-impact";

// Phase 4D.10H: Value Case impact stage and the single post-authorisation next action (derived, never stored).

describe("Value Case impact stage", () => {
  it("follows decision → determination → resulting Value Change", () => {
    const st = (
      decided: boolean,
      determination: "no_value_change_required" | "value_change_proposed" | null,
      change: string | null,
    ) => valueCaseImpactStage({ decided, determination, change: change ? { status: change as "draft" } : null });
    expect(st(false, null, null)).toBe("no_decision");
    expect(st(true, null, null)).toBe("awaiting_determination");
    expect(st(true, "no_value_change_required", null)).toBe("no_value_change");
    expect(st(true, "value_change_proposed", null)).toBe("proposed_not_prepared");
    expect(st(true, "value_change_proposed", "draft")).toBe("change_in_progress");
    expect(st(true, "value_change_proposed", "proposed")).toBe("change_in_progress");
    expect(st(true, "value_change_proposed", "authorised")).toBe("change_authorised");
    expect(st(true, "value_change_proposed", "withdrawn")).toBe("change_closed");
    expect(st(true, null, "authorised")).toBe("change_authorised"); // historical: Value Change prepared before 4D.10H
  });
});

describe("post-authorisation next action", () => {
  const none: GovernanceFacts = {
    openChange: null,
    awaitingDetermination: null,
    proposedNotPrepared: null,
    draftReview: null,
    awaitingDecision: null,
  };
  const next = (f: Partial<GovernanceFacts>) => postAuthorisationNextAction({ ...none, ...f }, "/p")?.label ?? null;
  const draft = (
    recommendation: GovernanceFacts["draftReview"] extends infer D
      ? D extends { recommendation: infer R }
        ? R
        : never
      : never,
  ) => ({
    draftReview: { id: "r", sequence: 2, recommendation },
  });

  it("nothing pending → none", () => expect(next({})).toBeNull());
  it("draft review states", () => {
    expect(next(draft(null))).toBe("Continue draft Assurance Review #2");
    expect(next(draft("draft"))).toBe("Continue draft Assurance Review #2");
    expect(next(draft("returned"))).toBe("Continue draft Assurance Review #2");
    expect(next(draft("in_internal_review"))).toBe("Complete the internal recommendation review (Review #2)");
    expect(next(draft("ready_to_issue"))).toBe("Issue the recommendation to management (Review #2)");
    expect(next({ ...draft("issued"), awaitingDecision: { reviewId: "r", sequence: 2 } })).toBe(
      "Record the management decision (Review #2)",
    );
  });
  it("governance loop first, in order", () => {
    const loop = {
      ...draft("in_internal_review"),
      awaitingDecision: { reviewId: "a", sequence: 1 },
      proposedNotPrepared: { reviewId: "p", sequence: 1 },
      awaitingDetermination: { reviewId: "d", sequence: 1 },
      openChange: { id: "c", code: "VC-001", status: "proposed" as const },
    };
    expect(next(loop)).toBe("Record the VCO's decision on VC-001");
    expect(next({ ...loop, openChange: null })).toBe("Determine the Value Case impact of the Review #1 decision");
    expect(next({ ...loop, openChange: null, awaitingDetermination: null })).toBe(
      "Prepare the Value Change proposed in Review #1",
    );
    expect(postAuthorisationNextAction({ ...none, ...loop, openChange: null }, "/p")?.href).toBe(
      "/p/assurance/d#value-change",
    );
  });
});
