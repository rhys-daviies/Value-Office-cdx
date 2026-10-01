import Decimal from "decimal.js";

// Report chart scales (Phase 4D.7). Pure and deterministic: coordinates are derived with Decimal and
// emitted as fixed-precision strings, so identical input always yields identical SVG.

/** A round tick step for a span divided into roughly `parts`. */
function niceStep(span: Decimal, parts: number): Decimal {
  const rough = span.dividedBy(parts);
  const magnitude = new Decimal(10).pow(rough.log(10).floor());
  return [1, 2, 2.5, 5, 10].map((f) => magnitude.times(f)).find((s) => s.gte(rough)) ?? magnitude.times(10);
}

/** Zero-inclusive ticks covering every value (missing values ignored, never treated as zero). */
export function zeroBasedTicks(values: readonly (string | null)[], parts = 4): Decimal[] {
  const present = values.filter((v): v is string => v !== null).map((v) => new Decimal(v));
  const max = Decimal.max(0, ...present);
  const min = Decimal.min(0, ...present);
  if (max.equals(min)) return [new Decimal(0), new Decimal(1)];
  const step = niceStep(max.minus(min), parts);
  const ticks: Decimal[] = [];
  for (let t = min.dividedBy(step).floor().times(step); ; t = t.plus(step)) {
    ticks.push(t);
    if (t.gte(max)) break;
  }
  return ticks;
}

/** Linear map from [d0, d1] to [r0, r1], as a fixed-precision coordinate string. */
export function linear(d0: Decimal, d1: Decimal, r0: number, r1: number) {
  const span = d1.minus(d0);
  return (v: string | Decimal): string => {
    const t = span.isZero() ? new Decimal(0) : new Decimal(v).minus(d0).dividedBy(span);
    return t
      .times(r1 - r0)
      .plus(r0)
      .toFixed(1);
  };
}

/** Evenly spaced slot centres across [r0, r1] (one slot sits in the middle). */
export function slots(count: number, r0: number, r1: number): string[] {
  if (count <= 1) return [new Decimal(r0 + r1).dividedBy(2).toFixed(1)];
  const step = new Decimal(r1 - r0).dividedBy(count - 1);
  return Array.from({ length: count }, (_, i) => step.times(i).plus(r0).toFixed(1));
}

/** Shorten a label for the chart; the full text is always in the companion table. */
export function clip(label: string, max: number): string {
  const chars = Array.from(label);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : label;
}

/** Offset a coordinate string by a fixed amount (Decimal, fixed precision). */
export function off(coord: string, delta: number): string {
  return new Decimal(coord).plus(delta).toFixed(1);
}
