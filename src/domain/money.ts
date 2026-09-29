import Decimal from "decimal.js";

// All monetary arithmetic uses exact decimals. Never use JS numbers for money.
// Database representation: numeric(18,2), exchanged as strings.

const MoneyDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export type Money = Decimal;

export const MONEY_SCALE = 2;
const MONEY_PATTERN = /^-?\d{1,16}(\.\d{1,2})?$/;

/** Parse a money amount from a decimal string. Rejects floats-as-numbers and >2dp. */
export function money(value: string): Money {
  const trimmed = value.trim();
  if (!MONEY_PATTERN.test(trimmed)) {
    throw new RangeError(`Invalid money amount "${value}": expected a decimal string with at most 2dp`);
  }
  return new MoneyDecimal(trimmed);
}

export function sumMoney(values: readonly (Money | string)[]): Money {
  return values.reduce<Money>((acc, v) => acc.plus(typeof v === "string" ? money(v) : v), new MoneyDecimal(0));
}

/** Canonical string for storage (fixed 2dp). */
export function toDbMoney(value: Money): string {
  return value.toFixed(MONEY_SCALE);
}

/** Millions with one decimal, e.g. 15500000.00 -> "15.5". Display only. */
export function toMillions(value: Money, dp = 1): string {
  return value.dividedBy(1_000_000).toFixed(dp);
}
