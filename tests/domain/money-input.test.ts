import { describe, expect, it } from "vitest";

import { parseMoneyInput } from "@/domain/money";
import { formatMetric, formatMoney, formatMoneyChange, formatMoneyShort } from "@/ui/format";

describe("parseMoneyInput", () => {
  it.each([
    ["4800000", "4800000.00"],
    ["4,800,000.00", "4800000.00"],
    ["4.8m", "4800000.00"],
    ["$4.8m", "4800000.00"],
    ["NZ$ 18m", "18000000.00"],
    ["-250k", "-250000.00"],
    ["(1.2m)", "-1200000.00"],
    ["0.4M", "400000.00"],
    ["1.5bn", "1500000000.00"],
    ["0", "0.00"],
    ["12.34", "12.34"],
  ])("%j → %s", (input, expected) => {
    expect(parseMoneyInput(input)).toBe(expected);
  });

  it.each(["", "abc", "4.8x", "1.005", "1.2345678k", "--5", "4.8.1m"])("rejects %j", (bad) => {
    expect(() => parseMoneyInput(bad)).toThrow(RangeError);
  });

  it("scales exactly without floating point drift", () => {
    expect(parseMoneyInput("0.1m")).toBe("100000.00");
    expect(parseMoneyInput("2.3m")).toBe("2300000.00"); // 2.3 * 1e6 is 2299999.9999999995 in floats
  });
});

describe("presentation formatting", () => {
  it("formats headline millions and full amounts", () => {
    expect(formatMoneyShort("15500000.00", "USD")).toBe("$15.5m");
    expect(formatMoneyShort("18000000.00", "NZD")).toBe("NZ$18.0m");
    expect(formatMoneyShort("-300000.00", "USD")).toBe("-$0.3m");
    expect(formatMoneyShort("45000.00", "USD")).toBe("$45.0k");
    expect(formatMoneyShort(null, "USD")).toBe("—");
    expect(formatMoney("4800000.00", "USD")).toBe("$4,800,000.00");
    expect(formatMoney("-1234.5", "GBP")).toBe("-£1,234.50");
  });

  it("signs changes", () => {
    expect(formatMoneyChange("-2500000.00", "USD")).toBe("-$2.5m");
    expect(formatMoneyChange("400000.00", "USD")).toBe("+$0.4m");
    expect(formatMoneyChange("0.00", "USD")).toBe("$0");
  });

  it("formats metrics with units", () => {
    expect(formatMetric("10.200000", "%")).toBe("10.2%");
    expect(formatMetric("142.000000", "$")).toBe("$142");
    expect(formatMetric("184.000000", null)).toBe("184");
  });
});
