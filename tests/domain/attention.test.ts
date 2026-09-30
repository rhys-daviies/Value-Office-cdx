import { describe, expect, it } from "vitest";

import { ATTENTION_WINDOW_DAYS, type AttentionInput, daysBetween, deriveMatterAttention } from "@/domain/attention";

// Phase 4D.4: "needs attention" is derived at read time from existing matter fields, deterministically.

const base: AttentionInput = {
  stage: "assessing",
  ownerPersonId: "owner",
  quantified: true,
  requiredDecisionDate: null,
  monitorUntil: null,
};
const kinds = (input: Partial<AttentionInput>, today = "2026-09-30") =>
  deriveMatterAttention({ ...base, ...input }, today).map((a) => a.kind);

describe("attention state", () => {
  it("counts whole UTC calendar days, across month and year ends", () => {
    expect(daysBetween("2026-09-30", "2026-10-01")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2); // DST-independent
    expect(daysBetween("2026-10-01", "2026-09-30")).toBe(-1);
  });

  it("nothing for an owned, quantified matter in an ordinary stage", () => {
    expect(kinds({})).toEqual([]);
  });

  it("flags escalated, awaiting evidence, no owner and unquantified", () => {
    expect(kinds({ stage: "escalated" })).toEqual(["escalated"]);
    expect(kinds({ stage: "awaiting_evidence" })).toEqual(["awaiting_evidence"]);
    expect(kinds({ ownerPersonId: null })).toEqual(["no_owner"]);
    expect(kinds({ quantified: false })).toEqual(["unquantified"]);
    expect(kinds({ stage: null })).toEqual([]); // legacy matters without a stage
  });

  it("decision dates: passed, approaching within the window, or not yet relevant", () => {
    expect(kinds({ requiredDecisionDate: "2026-09-29" })).toEqual(["decision_overdue"]);
    expect(kinds({ requiredDecisionDate: "2026-09-30" })).toEqual(["decision_approaching"]); // due today
    const edge = new Date(Date.UTC(2026, 8, 30 + ATTENTION_WINDOW_DAYS)).toISOString().slice(0, 10);
    const beyond = new Date(Date.UTC(2026, 8, 31 + ATTENTION_WINDOW_DAYS)).toISOString().slice(0, 10);
    expect(kinds({ requiredDecisionDate: edge })).toEqual(["decision_approaching"]);
    expect(kinds({ requiredDecisionDate: beyond })).toEqual([]);
  });

  it("monitor dates: ended, ending, or not yet relevant", () => {
    expect(kinds({ monitorUntil: "2026-09-01" })).toEqual(["monitor_ended"]);
    expect(kinds({ monitorUntil: "2026-10-05" })).toEqual(["monitor_ending"]);
    expect(kinds({ monitorUntil: "2027-06-30" })).toEqual([]);
  });

  it("orders several conditions most pressing first", () => {
    expect(
      kinds({ stage: "escalated", ownerPersonId: null, quantified: false, requiredDecisionDate: "2026-09-01" }),
    ).toEqual(["escalated", "decision_overdue", "no_owner", "unquantified"]);
  });
});
