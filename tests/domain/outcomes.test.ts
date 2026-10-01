import { describe, expect, it } from "vitest";

import { arrangeOutcomes, differenceFromRecommendation, type OutcomeScenario } from "@/domain/outcomes";

// Phase 4D.6: semantic outcome order (never by value), one mark per scenario, decimal-safe difference.

const s = (id: string, totalValue: string, kind: OutcomeScenario["kind"] = "alternative"): OutcomeScenario => ({
  id,
  label: id,
  kind,
  totalValue,
  narrative: null,
});
const stored = [
  s("current", "14700000.00", "current"),
  s("a", "15300000.00"),
  s("b", "14900000.00"),
  s("c", "14000000.00"),
];

describe("arrangeOutcomes", () => {
  it("orders recommendation, then stored order, then the client-selected outcome", () => {
    const out = arrangeOutcomes(stored, "a", "b");
    expect(out.map((o) => o.id)).toEqual(["a", "current", "c", "b"]);
    expect(out.map((o) => [o.recommended, o.selected])).toEqual([
      [true, false],
      [false, false],
      [false, false],
      [false, true],
    ]);
  });

  it("does not rank by value and is deterministic", () => {
    const out = arrangeOutcomes(stored, "c", null); // the lowest total can be recommended
    expect(out.map((o) => o.id)).toEqual(["c", "current", "a", "b"]);
    expect(arrangeOutcomes(stored, "c", null)).toEqual(out);
  });

  it("shows a scenario that is both recommended and selected once, with both roles", () => {
    const out = arrangeOutcomes(stored, "a", "a");
    expect(out).toHaveLength(4);
    expect(out.filter((o) => o.id === "a")).toEqual([expect.objectContaining({ recommended: true, selected: true })]);
  });

  it("handles a missing recommendation or decision", () => {
    expect(arrangeOutcomes(stored, null, null).map((o) => o.id)).toEqual(["current", "a", "b", "c"]);
    expect(arrangeOutcomes(stored, null, "b").map((o) => o.id)).toEqual(["current", "a", "c", "b"]);
    expect(differenceFromRecommendation(arrangeOutcomes(stored, null, "b"))).toBeNull();
    expect(differenceFromRecommendation(arrangeOutcomes(stored, "a", null))).toBeNull();
  });
});

describe("differenceFromRecommendation", () => {
  it("is selected − recommended, sign preserved, decimal-safe", () => {
    expect(differenceFromRecommendation(arrangeOutcomes(stored, "a", "b"))).toBe("-400000.00");
    expect(differenceFromRecommendation(arrangeOutcomes(stored, "b", "a"))).toBe("400000.00");
    expect(differenceFromRecommendation(arrangeOutcomes(stored, "a", "a"))).toBe("0.00");
    const cents = [s("x", "0.30"), s("y", "0.10")];
    expect(differenceFromRecommendation(arrangeOutcomes(cents, "x", "y"))).toBe("-0.20"); // not -0.19999…
  });
});
