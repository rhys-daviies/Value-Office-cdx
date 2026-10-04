import { describe, expect, it } from "vitest";

import { forecastMovement } from "@/domain/assurance";
import { proposalChecklist, type MobilisationFacts } from "@/domain/mobilisation";
import { definitionRationaleRequired, hasRationale } from "@/domain/value-case";

// Phase 4D.10E: the pure rules the gates mirror (database walk-throughs are in tests/db/governed-movements).

const v = (financialValue: string | null) => ({ financialValue });

describe("Value Case Definition movement", () => {
  it("is the change in a driver's contribution to the total; absent or non-financial contributes nothing", () => {
    expect(definitionRationaleRequired(v("6000000.00"), v("6000000.00"))).toBe(false); // unchanged
    expect(definitionRationaleRequired(v("6000000.00"), v("5200000.00"))).toBe(true); // adjusted
    expect(definitionRationaleRequired(null, v("1000000.00"))).toBe(true); // introduced
    expect(definitionRationaleRequired(null, v("0.00"))).toBe(false); // introduced at $0: nothing committed
    expect(definitionRationaleRequired(null, v(null))).toBe(false); // non-financial outcome
    expect(definitionRationaleRequired(v("1000000.00"), null)).toBe(true); // not carried forward
    expect(definitionRationaleRequired(v(null), null)).toBe(false); // non-financial not carried forward
    expect(definitionRationaleRequired(v("1.00"), v(null))).toBe(true); // became non-financial
    expect(definitionRationaleRequired(v("0.00"), v(null))).toBe(false);
  });
  it("treats blank text as no rationale", () => {
    expect([hasRationale(null), hasRationale("  "), hasRationale("why")]).toEqual([false, false, true]);
  });
});

describe("forecast movement baseline", () => {
  const row = (over: Partial<Parameters<typeof forecastMovement>[0]>) => ({
    financial: true,
    authorisedValue: "1000000.00",
    previousForecast: "1000000.00",
    currentForecast: "1000000.00",
    ...over,
  });
  it("first review: against the authorised value", () => {
    expect(forecastMovement(row({}), "authorised")).toMatchObject({ source: "authorised", moved: false });
    expect(forecastMovement(row({ currentForecast: "900000.00" }), "authorised")).toMatchObject({
      baseline: "1000000.00",
      rationaleRequired: true,
    });
  });
  it("later reviews: against the previous formal forecast, else the authorised value", () => {
    const later = row({ previousForecast: "800000.00", currentForecast: "800000.00" });
    expect(forecastMovement(later, "review")).toMatchObject({ source: "previous_review", moved: false });
    expect(forecastMovement({ ...later, currentForecast: "850000.00" }, "review").rationaleRequired).toBe(true);
    // No prior formal forecast (driver absent, or Not Assessed): the authorised value.
    expect(forecastMovement(row({ previousForecast: null, currentForecast: "1000000.00" }), "review")).toMatchObject({
      source: "authorised",
      moved: false,
    });
  });
  it("is silent for non-financial drivers and positions with no forecast (Not Assessed keeps its own rule)", () => {
    expect(forecastMovement(row({ financial: false, authorisedValue: null }), "authorised")).toMatchObject({
      baseline: null,
      rationaleRequired: false,
    });
    expect(forecastMovement(row({ currentForecast: null }), "authorised").rationaleRequired).toBe(false);
    expect(forecastMovement(row({ currentForecast: "0.00" }), "authorised").rationaleRequired).toBe(true);
  });
});

describe("V1 proposal checklist", () => {
  const facts: MobilisationFacts = {
    everAuthorised: false,
    inForceVersionNumber: null,
    hasValueBasis: true,
    hasValuePeriod: true,
    vcoName: "V",
    kickoffDate: null,
    goLiveDate: null,
    requests: [],
    originalBusinessCase: "recorded",
    v1: { status: "draft", basedOnOriginal: true, driverCount: 2, unqualified: 0, unevidenced: 0 },
  };
  it("blocks proposal while a governed movement lacks its rationale", () => {
    const missing = proposalChecklist(facts, { missingRationale: ["VD-02", "VD-03"] }).find(
      (c) => c.key === "adjustment-rationale",
    )!;
    expect(missing).toMatchObject({ ok: false, blocking: true });
    expect(missing.label).toMatch(/VD-02, VD-03/);
    expect(proposalChecklist(facts).find((c) => c.key === "adjustment-rationale")!.ok).toBe(true);
  });
});
