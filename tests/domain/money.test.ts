import { describe, expect, it } from "vitest";

import { money, sumMoney, toDbMoney, toMillions } from "@/domain/money";
import { HORIZON } from "@/fixtures/horizon";

describe("money", () => {
  it("is exact where floating point is not", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumMoney(["0.10", "0.20"]).equals(money("0.30"))).toBe(true);
  });

  it("sums the Horizon drivers to exactly $15.5m", () => {
    const total = sumMoney(HORIZON.drivers.map((d) => d.financialValue));
    expect(toDbMoney(total)).toBe(HORIZON.authorisedV1Value);
    expect(toMillions(total)).toBe("15.5");
  });

  it("keeps cents exact across many additions", () => {
    const total = sumMoney(Array.from({ length: 1000 }, () => "0.01"));
    expect(toDbMoney(total)).toBe("10.00");
  });

  it.each(["1.005", "1e6", "abc", "", "12,000", "0.1.2"])("rejects invalid amount %j", (bad) => {
    expect(() => money(bad)).toThrow(RangeError);
  });

  it("serialises to fixed 2dp for numeric(18,2)", () => {
    expect(toDbMoney(money("4800000"))).toBe("4800000.00");
    expect(toDbMoney(money("-0.5"))).toBe("-0.50");
  });
});
