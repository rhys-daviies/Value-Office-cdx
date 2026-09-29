import { describe, expect, it } from "vitest";

import { computeValuePosition } from "@/domain/assurance";
import {
  clientElectedDifference,
  compareScenarios,
  leakageAmounts,
  projectedAuthorisedValue,
  summariseLeakage,
} from "@/domain/response";
import { HORIZON } from "@/fixtures/horizon";

describe("leakage calculations", () => {
  it("derives recoverable = total − unrecoverable exactly", () => {
    expect(leakageAmounts("700000.00", "250000.00")).toEqual({
      total: "700000.00",
      unrecoverable: "250000.00",
      recoverable: "450000.00",
    });
    expect(leakageAmounts("0.30", "0.10").recoverable).toBe("0.20");
  });

  it("summarises assessed items and counts unassessed ones without inventing amounts", () => {
    const s = summariseLeakage([{ amounts: leakageAmounts("100.00", "40.00") }, { amounts: null }]);
    expect(s).toEqual({
      itemCount: 2,
      assessedCount: 1,
      total: "100.00",
      recoverable: "60.00",
      unrecoverable: "40.00",
    });
    expect(summariseLeakage([{ amounts: null }])).toMatchObject({
      total: null,
      recoverable: null,
      unrecoverable: null,
    });
  });
});

describe("scenario comparisons", () => {
  const sc = (kind: "current" | "recommended" | "alternative" | "no_action", totalValue: string) => ({
    id: kind,
    label: kind,
    kind,
    totalValue,
  });

  it("differences against current and recommended; values pass through untouched", () => {
    const rows = compareScenarios([
      sc("current", "14700000.00"),
      sc("recommended", "15300000.00"),
      sc("alternative", "14900000.00"),
    ]);
    expect(rows.map((r) => [r.totalValue, r.vsCurrent, r.vsRecommended])).toEqual([
      ["14700000.00", "0.00", "-600000.00"],
      ["15300000.00", "600000.00", "0.00"],
      ["14900000.00", "200000.00", "-400000.00"],
    ]);
  });

  it("reports no difference where there is no current or recommended option", () => {
    expect(compareScenarios([sc("alternative", "1.00")])[0]).toMatchObject({ vsCurrent: null, vsRecommended: null });
  });

  it("Horizon: client-elected −$0.4m; VC-002 would make V2 $14.9m", () => {
    const s = HORIZON.response.scenarios;
    expect(clientElectedDifference(s.clientSelected, s.recommended)).toBe("-400000.00");
    expect(projectedAuthorisedValue(HORIZON.authorisedV1Value, HORIZON.response.valueChange.statedChange)).toBe(
      "14900000.00",
    );
  });
});

describe("realised value with an unattributed amount", () => {
  it("Horizon: $2.8m total realised with no per-driver attribution", () => {
    const drivers = HORIZON.drivers.map((d) => ({
      valueDriverId: d.code,
      code: d.code,
      name: d.name,
      authorisedValue: d.financialValue,
      qualificationStatus: "unqualified" as const,
      evidenceStatus: "unevidenced" as const,
    }));
    const positions = HORIZON.assurance.forecasts.map((f) => ({
      valueDriverId: f.code,
      currentForecast: f.currentForecast,
      realisedValue: null,
    }));
    const { rows, totals } = computeValuePosition(
      drivers,
      positions,
      { kind: "authorised" },
      { unattributedRealised: "2800000.00" },
    );
    expect(totals).toMatchObject({
      realisedAttributedTotal: null,
      unattributedRealised: "2800000.00",
      realisedTotal: "2800000.00",
      realisedAssessed: 0,
    });
    expect(rows.every((r) => r.realisedValue === null)).toBe(true);
  });
});
