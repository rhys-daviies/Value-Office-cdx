import { describe, expect, it } from "vitest";

import { additionalItems, remainingSuggestions, selectedSuggestions } from "@/domain/day-one-requests";
import { deriveMobilisationStatus, type MobilisationFacts } from "@/domain/mobilisation";

// Phase 4D.10C: Mobilisation guidance derived from facts (the database walk-through is in tests/db).

const fresh: MobilisationFacts = {
  everAuthorised: false,
  inForceVersionNumber: null,
  hasValueBasis: false,
  hasValuePeriod: false,
  vcoName: null,
  kickoffDate: null,
  goLiveDate: null,
  requests: [],
  originalBusinessCase: null,
  v1: null,
};
const ready: MobilisationFacts = {
  ...fresh,
  hasValueBasis: true,
  hasValuePeriod: true,
  vcoName: "Val Owner",
  requests: [{ reference: "IR-01", status: "issued", items: 3, outstanding: 1 }],
  originalBusinessCase: "recorded",
  v1: { status: "draft", driverCount: 2, unqualified: 1, unevidenced: 2 },
};
const next = (f: MobilisationFacts) => deriveMobilisationStatus(f).next?.label ?? null;

describe("Mobilisation next action", () => {
  it("follows the journey: Value Basis → VCO → Day-1 request → Original Business Case → V1", () => {
    expect(next(fresh)).toBe("Define the Value Basis");
    expect(next({ ...ready, vcoName: null })).toBe("Nominate the Value Case Owner");
    expect(next({ ...ready, requests: [] })).toBe("Create the Day-1 Information Request");
    expect(next({ ...ready, requests: [{ reference: "IR-02", status: "draft", items: 0, outstanding: 0 }] })).toBe(
      "Issue IR-02",
    );
    expect(next({ ...ready, originalBusinessCase: null })).toBe("Capture the Original Business Case");
    expect(next({ ...ready, originalBusinessCase: "draft" })).toBe("Finish and record the Original Business Case");
    expect(next({ ...ready, v1: null })).toMatch(/^Start Value Case Definition/);
    expect(next({ ...ready, v1: { ...ready.v1!, driverCount: 0 } })).toBe("Add Value Drivers to the draft V1");
    expect(next(ready)).toBe("Complete Value Case Definition and propose V1");
  });

  it("once V1 is proposed, only its authorisation (or the VCO it needs) is next", () => {
    const proposed = { ...ready, requests: [], originalBusinessCase: null, v1: { ...ready.v1!, status: "proposed" } };
    expect(next(proposed)).toBe("Record the VCO's authorisation of the proposed Value Case");
    expect(next({ ...proposed, vcoName: null })).toBe("Nominate the Value Case Owner");
  });

  it("never pushes key dates as the next action, but lists them as recommended", () => {
    const s = deriveMobilisationStatus(ready);
    expect(s.outstanding.map((i) => [i.key, i.requirement])).toEqual(
      expect.arrayContaining([
        ["kickoff", "recommended"],
        ["go-live", "recommended"],
      ]),
    );
    expect(next({ ...ready, v1: { ...ready.v1!, status: "proposed" }, vcoName: "V" })).not.toMatch(/date/);
  });

  it("separates what the domain requires from recommended information", () => {
    const s = deriveMobilisationStatus(fresh);
    const by = (r: string) => s.outstanding.filter((i) => i.requirement === r).map((i) => i.key);
    expect(by("required")).toEqual(["value-basis", "vco", "v1-draft", "v1-drivers", "v1-proposed", "v1-authorised"]);
    expect(by("recommended")).toEqual(["kickoff", "go-live", "information-request", "original-business-case"]);
  });

  it("ends the checklist for good once any version has been authorised (V1 superseded by V2)", () => {
    for (const status of ["authorised", "superseded"]) {
      const s = deriveMobilisationStatus({
        ...fresh,
        everAuthorised: true,
        inForceVersionNumber: 2,
        v1: { status, driverCount: 1, unqualified: 0, unevidenced: 0 },
      });
      expect(s).toMatchObject({ stage: "authorised", inForceVersionNumber: 2, outstanding: [], next: null });
    }
  });
});

describe("Day-1 suggestions", () => {
  it("selects known suggestions in list order, skipping unknown keys and items already requested", () => {
    expect(selectedSuggestions(["baseline-evidence", "business-case", "nope"])).toEqual([
      "Existing Business Case",
      "Baseline performance evidence",
    ]);
    expect(selectedSuggestions(["business-case"], ["  existing   business case "])).toEqual([]);
    expect(remainingSuggestions(["Existing Business Case"]).map((s) => s.key)).not.toContain("business-case");
  });
  it("splits custom items per line, dropping blanks and repeats", () => {
    expect(additionalItems("A\n\n a \nB", ["b"])).toEqual(["A"]);
    expect(additionalItems(undefined)).toEqual([]);
  });
});
