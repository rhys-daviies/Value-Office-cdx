import { describe, expect, it } from "vitest";

import { VALUE_BASIS_KINDS } from "@/domain/statuses";
import { realisedComparable, trajectoryMeasure, trajectoryStatus } from "@/domain/trajectory";

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
