import type { LeakageAmounts } from "@/domain/response";
import type { ExecutiveOverview } from "@/server/queries/overview";
import { WorkingTag } from "@/ui/components/badges";
import { TextLink } from "@/ui/components/layout";
import { formatMoneyPlain } from "@/ui/format";

// Value requiring attention (Phase 4D.9I): ONE current Assurance matter — chosen by the existing attention conditions
// (most pressing first, then matter code; never by amount) — with its Value Leakage, plus compact counts. Detailed
// work stays in Assurance. Value Leakage is per matter and is never the Value Gap.

function Amounts({ a, currency }: { a: LeakageAmounts; currency: string }) {
  const exact = (v: string) => formatMoneyPlain(v, currency); // exact: Total = Recoverable + Unrecoverable must read true
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm" data-testid="attention-leakage">
      <dt className="text-slate-500">Total Value Leakage</dt>
      <dd className="text-right font-semibold tabular-nums">{exact(a.total)}</dd>
      <dt className="text-slate-500">Recoverable</dt>
      <dd className="text-right tabular-nums">{exact(a.recoverable)}</dd>
      <dt className="text-slate-500">Unrecoverable</dt>
      <dd className="text-right tabular-nums">{exact(a.unrecoverable)}</dd>
    </dl>
  );
}

export function ValueAttention({ o, base }: { o: ExecutiveOverview; base: string }) {
  const t = o.attention;
  const mt = t.matter;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return (
    <section
      aria-labelledby="attention-title"
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      data-testid="overview-attention"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="attention-title" className="text-base font-semibold text-slate-900">
          Value requiring attention
        </h2>
        <TextLink href={`${base}/assurance#continuous`}>Open Assurance →</TextLink>
      </div>
      {t.openCount === 0 ? (
        <p className="text-sm text-slate-600" data-testid="attention-none">
          No active Value Assurance matters requiring attention.
        </p>
      ) : !mt ? (
        <p className="text-sm text-slate-600" data-testid="attention-none">
          {plural(t.openCount, "active Assurance matter")}; none currently needs attention.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <p className="text-lg font-semibold text-slate-900">
              <TextLink href={`${base}/assurance/matters/${mt.id}`}>{mt.title}</TextLink>
            </p>
            <p className="text-sm text-slate-600" data-testid="attention-drivers">
              {mt.code}
              {mt.drivers.map((d) => ` · ${d.code}${d.name ? ` ${d.name}` : ""}`).join("")}
            </p>
            <p className="mt-1 text-sm font-medium text-slate-800" data-testid="attention-conditions">
              {mt.conditions.map((c) => c.label).join(" · ")}
            </p>
            {mt.ownerName && <p className="text-sm text-slate-600">Owner: {mt.ownerName}</p>}
          </div>
          <div className="min-w-0">
            {mt.formal ? (
              <>
                <p className="mb-1 text-xs text-slate-500">Formal · Review #{mt.formal.reviewSequence}</p>
                <Amounts a={mt.formal.amounts} currency={o.currency} />
              </>
            ) : mt.working ? (
              <>
                <p className="mb-1">
                  <WorkingTag />
                </p>
                <Amounts a={mt.working} currency={o.currency} />
              </>
            ) : (
              <p className="text-sm text-slate-600">Value Leakage not yet quantified.</p>
            )}
          </div>
        </div>
      )}
      {t.openCount > 0 && (
        <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-600" data-testid="attention-summary">
          {plural(t.openCount, "active Assurance matter")} · {t.needsAttentionCount} need
          {t.needsAttentionCount === 1 ? "s" : ""} attention · Formal Value Leakage on open matters{" "}
          <span data-testid="overview-leakage-total">
            {t.formalLeakage.total === null ? "Not yet assessed" : formatMoneyPlain(t.formalLeakage.total, o.currency)}
          </span>{" "}
          ({t.formalLeakage.assessedCount} of {t.openLeakageCount} assessed in a finalised review). Value Leakage is per
          matter and is not the Value Gap.
        </p>
      )}
    </section>
  );
}
