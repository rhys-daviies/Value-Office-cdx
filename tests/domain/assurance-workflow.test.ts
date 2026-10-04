import { describe, expect, it } from "vitest";

import {
  evidenceRequestState,
  matterWorkflow,
  NO_REQUESTS,
  type MatterWorkflowInput,
} from "@/domain/assurance-workflow";

// Phase 4D.10F: read-time lenses on an Assurance matter. Visibility only — nothing here sets a stage or blocks a review.

describe("evidence request state", () => {
  it("is null when nothing was requested", () => {
    expect(evidenceRequestState(NO_REQUESTS)).toBeNull();
  });
  it("requested → partially received → received / unavailable", () => {
    expect(evidenceRequestState({ ...NO_REQUESTS, open: 2 })).toEqual({
      state: "requested",
      label: "Evidence requested · 2 items outstanding",
      outstanding: 2,
    });
    expect(evidenceRequestState({ ...NO_REQUESTS, open: 1, partial: 1 })).toEqual({
      state: "partial",
      label: "Evidence partially received · 2 items outstanding",
      outstanding: 2,
    });
    expect(evidenceRequestState({ ...NO_REQUESTS, open: 1, received: 1 })?.label).toBe(
      "Evidence partially received · 1 item outstanding",
    );
    expect(evidenceRequestState({ ...NO_REQUESTS, received: 2 })).toEqual({
      state: "received",
      label: "Evidence received",
      outstanding: 0,
    });
    expect(evidenceRequestState({ ...NO_REQUESTS, received: 1, unavailable: 1 })?.label).toBe(
      "Evidence received · 1 item unavailable",
    );
    expect(evidenceRequestState({ ...NO_REQUESTS, unavailable: 2 })).toEqual({
      state: "unavailable",
      label: "Evidence unavailable",
      outstanding: 0,
    });
  });
});

describe("matter workflow", () => {
  const base: MatterWorkflowInput = {
    status: "open",
    stage: "identified",
    evidenceLinked: 0,
    requests: NO_REQUESTS,
    quantified: false,
    remediationPlan: null,
    monitorUntil: null,
    formalReviews: 0,
    draftReviewSequence: null,
  };
  const done = (m: MatterWorkflowInput) => matterWorkflow(m).map((s) => [s.key, s.done]);

  it("a newly raised matter has only the risk identified", () => {
    expect(done(base)).toEqual([
      ["identified", true],
      ["evidence", false],
      ["leakage", false],
      ["remediation", false],
      ["monitoring", false],
      ["formal", false],
    ]);
    expect(matterWorkflow(base).at(-1)!.detail).toBe("Recorded when the next formal review is finalised");
  });

  it("outstanding requests do not complete the evidence step; linked evidence does", () => {
    const requested = matterWorkflow({ ...base, requests: { ...NO_REQUESTS, open: 1 } });
    expect(requested[1]).toMatchObject({ done: false, detail: "Evidence requested · 1 item outstanding" });
    expect(matterWorkflow({ ...base, evidenceLinked: 2 })[1]).toMatchObject({ done: true, detail: "2 supporting" });
  });

  it("each step reads only its own field; a draft review shows the handoff", () => {
    const steps = matterWorkflow({
      ...base,
      stage: "monitoring",
      quantified: true,
      remediationPlan: "Re-plan",
      monitorUntil: "2027-06-30",
      formalReviews: 1,
      draftReviewSequence: 2,
    });
    expect(steps.map((s) => s.done)).toEqual([true, false, true, true, true, true]);
    expect(steps[4]).toMatchObject({ detail: "Monitor until", date: "2027-06-30" });
    expect(steps[5]!.detail).toBe("To be recorded in Review #2 (draft)");
    // A closed matter is not recorded by the open review.
    expect(matterWorkflow({ ...base, status: "closed", formalReviews: 1, draftReviewSequence: 2 })[5]!.detail).toBe(
      "Recorded in 1 finalised review",
    );
  });
});
