import { describe, expect, it } from "vitest";

import { moneyChange, summariseDrivers, versionAuthority, type DriverForSummary } from "@/domain/value-case";
import { nextStep } from "@/server/queries/projects";

const d = (over: Partial<DriverForSummary>): DriverForSummary => ({
  financialValue: "1000000.00",
  qualificationStatus: "unqualified",
  evidenceStatus: "unevidenced",
  avoPersonId: null,
  evidenceLinkCount: 0,
  ...over,
});

describe("summariseDrivers", () => {
  it("excludes non-financial drivers from the total and counts them", () => {
    const s = summariseDrivers([
      d({ financialValue: "4800000.00" }),
      d({ financialValue: null }),
      d({ financialValue: "-300000.00" }),
    ]);
    expect(s.financialTotal).toBe("4500000.00");
    expect(s.financialCount).toBe(2);
    expect(s.nonFinancialCount).toBe(1);
    expect(s.driverCount).toBe(3);
  });

  it("counts statuses and gaps without scoring", () => {
    const s = summariseDrivers([
      d({ qualificationStatus: "qualified", evidenceStatus: "evidenced", avoPersonId: "x", evidenceLinkCount: 2 }),
      d({ qualificationStatus: "partially_qualified", evidenceStatus: "partially_evidenced" }),
      d({}),
    ]);
    expect(s.qualification).toEqual({ unqualified: 1, partially_qualified: 1, qualified: 1 });
    expect(s.evidence).toEqual({ unevidenced: 1, partially_evidenced: 1, evidenced: 1 });
    expect(s.withoutAvo).toBe(2);
    expect(s.withoutEvidenceLinks).toBe(2);
    expect(Object.keys(s)).not.toContain("score");
  });

  it("totals an empty version to zero", () => {
    expect(summariseDrivers([]).financialTotal).toBe("0.00");
  });
});

describe("moneyChange / versionAuthority", () => {
  it("computes exact differences and needs both sides", () => {
    expect(moneyChange("18000000.00", "15500000.00")).toBe("-2500000.00");
    expect(moneyChange(null, "1.00")).toBeNull();
  });

  it("names the four authority states distinctly, without forecast language", () => {
    const labels = [
      versionAuthority("inherited_business_case", "recorded", 0),
      versionAuthority("value_case", "draft", 1),
      versionAuthority("value_case", "proposed", 1),
      versionAuthority("value_case", "authorised", 1),
    ];
    expect(labels).toEqual([
      "Inherited Business Case",
      "Draft Re-Qualified Value Case",
      "Proposed Value Case — awaiting VCO authorisation",
      "Authorised Value Case V1",
    ]);
    expect(labels.join(" ")).not.toMatch(/forecast/i);
  });
});

describe("nextStep guidance", () => {
  const base = {
    hasValueBasis: true,
    hasVco: true,
    hasInformationRequest: true,
    inheritedStatus: "recorded",
    requalifiedStatus: "draft",
    requalifiedDriverCount: 2,
  };
  it("follows the journey order", () => {
    expect(nextStep({ ...base, hasValueBasis: false })?.label).toMatch(/Value Basis/);
    expect(nextStep({ ...base, hasVco: false })?.label).toMatch(/Value Case Owner/);
    expect(nextStep({ ...base, inheritedStatus: null })?.label).toMatch(/inherited Business Case/);
    expect(nextStep({ ...base, requalifiedStatus: null })?.label).toMatch(/draft Re-Qualified/);
    expect(nextStep({ ...base, requalifiedStatus: "proposed" })?.label).toMatch(/authorisation/);
    expect(nextStep({ ...base, requalifiedStatus: "authorised" })).toBeNull();
  });
});
