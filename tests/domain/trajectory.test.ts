import { describe, expect, it } from "vitest";

import { VALUE_BASIS_KINDS } from "@/domain/statuses";
import {
  comparePhasing,
  realisedComparable,
  sortMilestones,
  terminalReconciliation,
  trajectoryMeasure,
  trajectoryStatus,
} from "@/domain/trajectory";

// Phase 4D.9C: pure Value Trajectory classification (contract: docs/architecture.md).

const v = (kind: (typeof VALUE_BASIS_KINDS)[number] | null, start: string | null, end: string | null) => ({
  valueBasisKind: kind,
  valuePeriodStart: start,
  valuePeriodEnd: end,
});

describe("Value Trajectory domain", () => {
  it("only cumulative benefit and annual run-rate support a trajectory, each with its own measure", () => {
    expect(VALUE_BASIS_KINDS.map((k) => trajectoryMeasure(k))).toEqual(["cumulative", "run_rate", null, null]);
    expect(trajectoryMeasure(null)).toBeNull();
  });

  it("status gives the most fundamental missing piece; every state is valid, none is an error", () => {
    expect(trajectoryStatus(null, 0)).toBe("no_authorised_version");
    expect(trajectoryStatus(v(null, "2026-01-01", "2028-12-31"), 3)).toBe("basis_not_classified");
    expect(trajectoryStatus(v("net_present_value", "2026-01-01", "2028-12-31"), 0)).toBe("basis_not_supported");
    expect(trajectoryStatus(v("other", null, null), 0)).toBe("basis_not_supported");
    expect(trajectoryStatus(v("cumulative_benefit", "2026-01-01", null), 0)).toBe("period_not_set");
    expect(trajectoryStatus(v("annual_run_rate", "2026-01-01", "2028-12-31"), 0)).toBe("phasing_not_entered");
    expect(trajectoryStatus(v("cumulative_benefit", "2026-01-01", "2028-12-31"), 2)).toBe("ready");
  });

  it("cumulative realised is comparable only on a cumulative basis of the same kind — never as a run-rate", () => {
    expect(realisedComparable("cumulative_benefit", "cumulative_benefit")).toBe(true);
    expect(realisedComparable("cumulative_benefit", null)).toBe(false); // unclassified legacy review basis
    expect(realisedComparable("annual_run_rate", "annual_run_rate")).toBe(false);
    expect(realisedComparable("net_present_value", "net_present_value")).toBe(false);
  });
});

describe("authoring helpers (4D.9D)", () => {
  const pts = [
    { asOf: "2028-12-31", value: "28000000.00" },
    { asOf: "2026-01-01", value: "0.00" },
    { asOf: "2026-12-31", value: "6000000.00" },
  ];

  it("sorts milestones chronologically regardless of entry order", () => {
    expect(sortMilestones(pts).map((p) => p.asOf)).toEqual(["2026-01-01", "2026-12-31", "2028-12-31"]);
  });

  it("reports every reconciliation state exactly, without changing either amount", () => {
    expect(terminalReconciliation([], "2028-12-31", "30000000.00")).toEqual({ state: "no_points" });
    expect(terminalReconciliation(pts.slice(1), "2028-12-31", "30000000.00")).toEqual({
      state: "no_terminal",
      periodEnd: "2028-12-31",
    });
    expect(terminalReconciliation(pts, "2028-12-31", "30000000.00")).toEqual({
      state: "mismatch",
      terminal: "28000000.00",
      governed: "30000000.00",
      difference: "-2000000.00",
    });
    expect(terminalReconciliation(pts, "2028-12-31", "28000000")).toMatchObject({ state: "reconciled" });
    expect(terminalReconciliation(pts, "2028-12-31", null)).toEqual({
      state: "governed_missing",
      terminal: "28000000.00",
    });
    // Cent-exact: no float tolerance.
    expect(terminalReconciliation(pts, "2028-12-31", "27999999.99")).toMatchObject({
      state: "mismatch",
      difference: "0.01",
    });
  });

  it("compares a re-phased draft with the plan it was copied from (equality only)", () => {
    const v1 = [
      { asOf: "2027-06-30", value: "10000000.00" },
      { asOf: "2027-12-31", value: "20000000.00" },
      { asOf: "2028-06-30", value: "30000000.00" },
    ];
    const v2 = [
      { asOf: "2027-06-30", value: "7000000.00" },
      { asOf: "2027-09-30", value: "12000000.00" },
      { asOf: "2028-06-30", value: "30000000.00" },
    ];
    const c = comparePhasing(v2, v1);
    expect([...c.changes.entries()]).toEqual([
      ["2027-06-30", "changed"],
      ["2027-09-30", "added"],
      ["2028-06-30", "unchanged"],
    ]);
    expect(c.removed).toEqual([{ asOf: "2027-12-31", value: "20000000.00" }]);
    expect(c.anyChange).toBe(true);
    expect(comparePhasing(v1, v1).anyChange).toBe(false);
  });
});
