import Decimal from "decimal.js";

// Presentation-edge formatting. Amounts arrive as decimal strings and are never
// converted to JS numbers.

const symbolCache = new Map<string, string>();

/** Display symbol for an ISO currency (USD → $, NZD → NZ$, GBP → £). */
export function currencySymbol(currency: string): string {
  let symbol = symbolCache.get(currency);
  if (!symbol) {
    try {
      symbol =
        new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "symbol" })
          .formatToParts(0)
          .find((p) => p.type === "currency")?.value ?? `${currency} `;
    } catch {
      symbol = `${currency} `;
    }
    symbolCache.set(currency, symbol);
  }
  return symbol;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Full amount: $4,800,000.00 (negative: -$250,000.00). */
export function formatMoney(value: string | null | undefined, currency: string): string {
  if (value === null || value === undefined) return "—";
  const d = new Decimal(value);
  const [int, frac] = d.abs().toFixed(2).split(".");
  return `${d.isNegative() ? "-" : ""}${currencySymbol(currency)}${groupThousands(int!)}.${frac}`;
}

/** Report table amount: $4,800,000 (cents only when present: $1,250.50). */
export function formatMoneyPlain(value: string | null | undefined, currency: string): string {
  if (value === null || value === undefined) return "—";
  const d = new Decimal(value);
  const [int, frac] = d.abs().toFixed(2).split(".");
  const cents = frac === "00" ? "" : `.${frac}`;
  return `${d.isNegative() ? "-" : ""}${currencySymbol(currency)}${groupThousands(int!)}${cents}`;
}

/** Signed report table amount: +$200,000 / -$600,000. */
export function formatMoneyPlainChange(value: string | null | undefined, currency: string): string {
  if (value === null || value === undefined) return "—";
  const d = new Decimal(value);
  return `${d.isPositive() && !d.isZero() ? "+" : ""}${formatMoneyPlain(value, currency)}`;
}

/** Headline amount in millions: $15.5m, -$0.4m. Falls back to thousands below $100k. */
export function formatMoneyShort(value: string | null | undefined, currency: string): string {
  if (value === null || value === undefined) return "—";
  const d = new Decimal(value);
  const sign = d.isNegative() ? "-" : "";
  const abs = d.abs();
  let body: string;
  if (abs.isZero()) {
    body = "0";
  } else if (abs.gte(100_000)) {
    const [int, frac] = abs.dividedBy(1_000_000).toFixed(1).split(".");
    body = `${groupThousands(int!)}.${frac}m`;
  } else {
    body = `${abs.dividedBy(1_000).toFixed(1)}k`;
  }
  return `${sign}${currencySymbol(currency)}${body}`;
}

/** Signed change: +$0.4m / -$2.5m. */
export function formatMoneyChange(value: string | null | undefined, currency: string): string {
  if (value === null || value === undefined) return "—";
  const d = new Decimal(value);
  return d.isZero()
    ? formatMoneyShort("0", currency)
    : `${d.isPositive() ? "+" : ""}${formatMoneyShort(value, currency)}`;
}

/**
 * Governance / Value Change amount (Phase 4D.9J): precise enough that a smaller change is never rounded into a
 * different-looking figure. $1m and above in millions with one or two decimals ($30.0m, $2.5m, $1.25m); $1k–$1m in
 * thousands ($450k, $12.3k); below $1k exactly. Unlike formatMoneyShort, $450,000 reads $450k, never $0.5m.
 */
export function formatMoneyAdaptive(value: string | null | undefined, currency: string): string {
  if (value === null || value === undefined) return "—";
  const d = new Decimal(value);
  const sign = d.isNegative() ? "-" : "";
  const abs = d.abs();
  const trim = (x: Decimal, max: number, min: number) => {
    const [int, frac = ""] = x.toFixed(max).split(".");
    const kept = frac.replace(/0+$/, "").padEnd(min, "0");
    return `${groupThousands(int!)}${kept ? `.${kept}` : ""}`;
  };
  let body: string;
  if (abs.isZero()) body = "0";
  else if (abs.gte(1_000_000)) body = `${trim(abs.dividedBy(1_000_000), 2, 1)}m`;
  else if (abs.gte(1_000)) body = `${trim(abs.dividedBy(1_000), 1, 0)}k`;
  else body = trim(abs, 2, 0);
  return `${sign}${currencySymbol(currency)}${body}`;
}

/** Signed governance change: +$450k / -$1.25m / $0. */
export function formatMoneyAdaptiveChange(value: string | null | undefined, currency: string): string {
  if (value === null || value === undefined) return "—";
  const d = new Decimal(value);
  return d.isZero()
    ? formatMoneyAdaptive("0", currency)
    : `${d.isPositive() ? "+" : ""}${formatMoneyAdaptive(value, currency)}`;
}

/** Metric values are numeric(20,6); trim trailing zeros but keep one decimal where given. */
export function formatMetric(value: string | null | undefined, unit?: string | null): string {
  if (value === null || value === undefined) return "—";
  const trimmed = new Decimal(value).toString();
  if (!unit) return trimmed;
  if (unit === "%") return `${trimmed}%`;
  if (unit === "$") return `$${trimmed}`;
  return `${trimmed} ${unit}`;
}

/** Money value as an editable input string (plain digits, 2dp). */
export function moneyInputValue(value: string | null | undefined): string {
  return value === null || value === undefined ? "" : new Decimal(value).toFixed(2);
}

/** Metric value as an editable input string (trailing zeros trimmed). */
export function metricInputValue(value: string | null | undefined): string {
  return value === null || value === undefined ? "" : new Decimal(value).toString();
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** ISO date string (YYYY-MM-DD) → 29 Sept 2026. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return dateFmt.format(new Date(`${value}T00:00:00Z`));
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return dateTimeFmt.format(typeof value === "string" ? new Date(value) : value);
}

export function formatPeriod(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return "—";
  return `${formatDate(start)} – ${formatDate(end)}`;
}
