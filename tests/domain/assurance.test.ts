import { describe, expect, it } from "vitest";

import { computeValuePosition, type DriverBasis, type PositionValues } from "@/domain/assurance";
import { HORIZON } from "@/fixtures/horizon";

const driver = (id: string, authorisedValue: string | null): DriverBasis => ({
  valueDriverId: id,
  code: id,
  name: id,
  authorisedValue,
  qualificationStatus: "unqualified",
  evidenceStatus: "unevidenced",
});
const pos = (id: string, currentForecast: string | null, realisedValue: string | null = null): PositionValues => ({
  valueDriverId: id,
  currentForecast,
  realisedValue,
});

describe("computeValuePosition", () => {
  it("reproduces Horizon: $15.5m authorised, $14.7m forecast, $0.8m gap", () => {
    const drivers = HORIZON.drivers.map((d) => driver(d.code, d.financialValue));
    const positions = HORIZON.assurance.forecasts.map((f) => pos(f.code, f.currentForecast));
    const { rows, totals } = computeValuePosition(drivers, positions, { kind: "authorised" });
    expect(totals.authorisedTotal).toBe("15500000.00");
    expect(totals.forecastTotal).toBe("14700000.00");
    expect(totals.valueGap).toBe("800000.00");
    expect(totals.movement).toBe("-800000.00"); // first review: forecast − authorised
    expect(rows.find((r) => r.code === "VD-05")!.valueGap).toBe("-300000.00"); // Quality / Rework ahead of plan
    expect(rows.find((r) => r.code === "VD-06")!.movement).toBe("0.00");
    // No per-driver realised values exist for Horizon; nothing is invented.
    expect(totals.realisedTotal).toBeNull();
    expect(totals.realisedAssessed).toBe(0);
  });

  it("first review movement is measured against Authorised Value", () => {
    const { rows } = computeValuePosition([driver("A", "1000000.00")], [pos("A", "900000.00")], { kind: "authorised" });
    expect(rows[0]).toMatchObject({ previousForecast: "1000000.00", movement: "-100000.00", valueGap: "100000.00" });
  });

  it("later review movement is measured against the previous finalised forecast, not V1", () => {
    const { rows, totals } = computeValuePosition([driver("A", "1000000.00")], [pos("A", "950000.00")], {
      kind: "review",
      reviewId: "r1",
      sequence: 1,
      positions: [pos("A", "900000.00")],
    });
    expect(rows[0]).toMatchObject({ previousForecast: "900000.00", movement: "50000.00", valueGap: "50000.00" });
    expect(totals.previousTotal).toBe("900000.00");
    expect(totals.movement).toBe("50000.00");
  });

  it("excludes non-financial drivers from all financial totals", () => {
    const { rows, totals } = computeValuePosition(
      [driver("A", "1000000.00"), driver("NF", null)],
      [pos("A", "800000.00", "100000.00"), pos("NF", null, null)],
      { kind: "authorised" },
    );
    expect(totals.financialDriverCount).toBe(1);
    expect(totals.forecastTotal).toBe("800000.00");
    expect(totals.valueGap).toBe("200000.00");
    expect(rows.find((r) => r.code === "NF")).toMatchObject({ financial: false, valueGap: null, movement: null });
  });

  it("keeps negative and zero forecasts exact", () => {
    const { totals, rows } = computeValuePosition(
      [driver("A", "0.10"), driver("B", "-300000.00")],
      [pos("A", "0.00"), pos("B", "-450000.35")],
      { kind: "authorised" },
    );
    expect(totals.forecastTotal).toBe("-450000.35");
    expect(totals.valueGap).toBe("150000.45");
    expect(rows[1]!.valueGap).toBe("150000.35");
  });

  it("reports totals as incomplete rather than partially summed", () => {
    const { totals } = computeValuePosition(
      [driver("A", "1000000.00"), driver("B", "500000.00")],
      [pos("A", "900000.00", "200000.00")],
      { kind: "authorised" },
    );
    expect(totals.forecastAssessed).toBe(1);
    expect(totals.forecastTotal).toBeNull();
    expect(totals.valueGap).toBeNull();
    expect(totals.movement).toBeNull();
    expect(totals.realisedTotal).toBe("200000.00");
    expect(totals.realisedAssessed).toBe(1);
  });

  it("does not require realised ≤ forecast", () => {
    const { totals } = computeValuePosition([driver("A", "100.00")], [pos("A", "50.00", "80.00")], {
      kind: "authorised",
    });
    expect(totals.realisedTotal).toBe("80.00");
  });
});
