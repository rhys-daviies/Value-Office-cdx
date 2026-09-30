import type { DriverEntry } from "@/server/queries/drivers";

import { PlainBadge } from "../components/badges";
import { formatMoneyShort } from "../format";

// Visual language for the three driver readings (Phase 4D.3). Working figures are violet, dashed and
// always tagged "working · not authorised"; authorised figures are solid; forecasts name their review.

export const WORKING_DRIVER_LABEL = "Working Value Driver — changes here do not alter an authorised Value Case.";

export function LivingStatusBadge({ entry }: { entry: Pick<DriverEntry, "status" | "authorised" | "formerlyIn"> }) {
  if (entry.status === "in_value_case") {
    return <PlainBadge tone="emerald">In Value Case V{entry.authorised!.versionNumber}</PlainBadge>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <PlainBadge tone="violet">Emerging</PlainBadge>
      {entry.formerlyIn !== null && <span className="text-xs text-slate-500">(was in V{entry.formerlyIn})</span>}
    </span>
  );
}

export function WorkingEstimate({ value, currency }: { value: string | null | undefined; currency: string }) {
  if (value == null) {
    return (
      <span className="text-amber-700 italic" data-testid="working-estimate">
        Not yet quantified
      </span>
    );
  }
  return (
    <span
      className="inline-flex flex-wrap items-baseline gap-1 border-b border-dashed border-violet-400 text-violet-900"
      data-testid="working-estimate"
      title="Working estimate — not authorised, not forecast, not in any total"
    >
      {formatMoneyShort(value, currency)}
      <span className="text-[10px] font-semibold tracking-wide text-violet-700 uppercase">
        working · not authorised
      </span>
    </span>
  );
}

export function AuthorisedValue({ entry, currency }: { entry: DriverEntry; currency: string }) {
  if (!entry.authorised)
    return (
      <span className="text-slate-400" data-testid="authorised-value">
        —
      </span>
    );
  return (
    <span className="font-semibold text-slate-900" data-testid="authorised-value">
      {entry.authorised.financialValue === null
        ? "Non-financial"
        : formatMoneyShort(entry.authorised.financialValue, currency)}
      <span className="ml-1 text-xs font-normal text-slate-500">V{entry.authorised.versionNumber}</span>
    </span>
  );
}

export function CurrentForecast({ entry, currency }: { entry: DriverEntry; currency: string }) {
  if (!entry.authorised) return <span className="text-slate-400">Not in current Value Case</span>;
  const f = entry.forecast;
  if (!f) return <span className="text-slate-400">—</span>;
  if (!f.financial) return <span className="text-slate-500">Non-financial</span>;
  if (f.notAssessed) return <span className="text-amber-700">Not assessed (Review #{f.reviewSequence})</span>;
  if (f.currentForecast === null) return <span className="text-slate-400">— (Review #{f.reviewSequence})</span>;
  return (
    <span>
      {formatMoneyShort(f.currentForecast, currency)}
      <span className="ml-1 text-xs text-slate-500">Review #{f.reviewSequence}</span>
    </span>
  );
}
