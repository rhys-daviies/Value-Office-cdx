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

const INPUT_MULTIPLIERS: Record<string, string> = { k: "1000", m: "1000000", bn: "1000000000", b: "1000000000" };

/**
 * Parses consultant-typed amounts: "4800000", "4,800,000.00", "$4.8m", "-250k", "(1.2m)".
 * Returns a canonical 2dp decimal string, or throws RangeError if the amount is
 * ambiguous or finer than cents after scaling.
 */
export function parseMoneyInput(raw: string): string {
  let s = raw.trim().toLowerCase().replace(/[\s,]/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  s = s.replace(/^[a-z]{0,3}\$|^[£€¥]/, ""); // leading symbol, e.g. $, NZ$, US$, £
  const match = /^(\d+(?:\.\d+)?)(k|m|bn|b)?$/.exec(s);
  if (!match) throw new RangeError(`"${raw}" is not an amount (examples: 4800000, 4,800,000.00, 4.8m, -250k)`);
  let value = new MoneyDecimal(match[1]!);
  if (match[2]) value = value.times(INPUT_MULTIPLIERS[match[2]]!);
  if (!value.times(100).isInteger()) throw new RangeError(`"${raw}" has more precision than cents`);
  if (negative) value = value.negated();
  return toDbMoney(value);
}
