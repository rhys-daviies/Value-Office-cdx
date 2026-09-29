import type { PositionTotals } from "@/domain/assurance";
import type { RequirementStatus } from "@/domain/assurance-cadence";

import { PlainBadge } from "../components/badges";
import { formatMoneyChange, formatMoneyShort } from "../format";

export const NOT_ASSESSED = "Not yet assessed";

/** Headline figure, or an honest statement of why it is not available. */
export function headline(value: string | null, currency: string, fallback = NOT_ASSESSED): string {
  return value === null ? fallback : formatMoneyShort(value, currency);
}

export function change(value: string | null, currency: string, fallback = "—"): string {
  return value === null ? fallback : formatMoneyChange(value, currency);
}

/** e.g. "Incomplete — 4 of 6 financial drivers assessed". */
export function coverage(assessed: number, of: number): string {
  return `${assessed} of ${of} financial driver${of === 1 ? "" : "s"} assessed`;
}

export function forecastHeadline(t: PositionTotals, currency: string): { value: string; note: string } {
  if (t.forecastTotal !== null)
    return {
      value: formatMoneyShort(t.forecastTotal, currency),
      note: coverage(t.forecastAssessed, t.financialDriverCount),
    };
  return {
    value: t.forecastAssessed === 0 ? NOT_ASSESSED : "Incomplete",
    note: coverage(t.forecastAssessed, t.financialDriverCount),
  };
}

export function realisedHeadline(t: PositionTotals, currency: string): { value: string; note: string } {
  if (t.realisedTotal === null) return { value: NOT_ASSESSED, note: coverage(0, t.financialDriverCount) };
  return {
    value: formatMoneyShort(t.realisedTotal, currency),
    note: coverage(t.realisedAssessed, t.financialDriverCount),
  };
}

export function RequirementBadge({ status }: { status: RequirementStatus }) {
  const map = {
    due: { tone: "red", label: "Due" },
    in_progress: { tone: "sky", label: "In progress" },
    upcoming: { tone: "amber", label: "Upcoming" },
    satisfied: { tone: "emerald", label: "Done" },
    unknown: { tone: "slate", label: "Not derivable yet" },
  } as const;
  const m = map[status];
  return <PlainBadge tone={m.tone}>{m.label}</PlainBadge>;
}

export function ReviewStatusBadge({ status }: { status: "draft" | "finalised" }) {
  return status === "draft" ? (
    <PlainBadge tone="amber">Draft</PlainBadge>
  ) : (
    <PlainBadge tone="emerald">🔒 Finalised</PlainBadge>
  );
}

export function Figure({
  label,
  value,
  note,
  testId,
  emphasis,
}: {
  label: string;
  value: string;
  note?: string;
  testId: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`rounded-lg border bg-white p-3 ${emphasis ? "border-slate-400" : "border-slate-200"}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p
        className={`mt-1 font-semibold text-slate-900 ${value.length > 12 ? "text-lg" : "text-2xl"}`}
        data-testid={testId}
      >
        {value}
      </p>
      {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
    </div>
  );
}
