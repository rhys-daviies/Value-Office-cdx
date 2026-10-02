import type { ExecutiveOverview } from "@/server/queries/overview";
import { forecastHeadline, headline, realisedHeadline, RequirementBadge } from "@/ui/assurance/display";
import { GovernedTag } from "@/ui/components/badges";
import { TextLink } from "@/ui/components/layout";
import { formatDate, formatMoneyShort } from "@/ui/format";

// Executive Value Position (Phase 4D.9I): the governed headline — Authorised, Realised, Formal Forecast, Value Gap —
// and, as prominently, the date that formal position was established. Existing governed figures only; before a
// finalised review nothing but the commitment is shown.

function Big({ label, value, note, testId }: { label: string; value: string; note?: string; testId: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-0.5 text-3xl font-semibold text-slate-900 tabular-nums" data-testid={testId}>
        {value}
      </dd>
      {note && <dd className="mt-0.5 text-xs text-slate-500">{note}</dd>}
    </div>
  );
}

/** Coverage is said only when it qualifies the figure (some drivers unassessed, or unattributed value included). */
function realisedNote(t: NonNullable<ExecutiveOverview["formal"]>["totals"], currency: string): string | undefined {
  const complete = t.financialDriverCount > 0 && t.realisedAssessed === t.financialDriverCount;
  return complete && t.unattributedRealised === null ? undefined : realisedHeadline(t, currency).note;
}

export function ExecutivePosition({ o, base }: { o: ExecutiveOverview; base: string }) {
  const a = o.authorised!;
  const f = o.formal;
  const m = (v: string | null) => formatMoneyShort(v, o.currency);
  const next = o.nextRequirement && (
    <p className="text-xs text-slate-600" data-testid="overview-next-requirement">
      Next Assurance requirement: {o.nextRequirement.label}
      {o.nextRequirement.date && ` · ${formatDate(o.nextRequirement.date)}`}{" "}
      <RequirementBadge status={o.nextRequirement.status} />
    </p>
  );
  const olderBasis = f !== null && f.againstVersionNumber !== a.versionNumber;
  return (
    <section
      aria-labelledby="position-title"
      className="mb-4 rounded-lg border border-slate-300 bg-white px-5 py-4 shadow-sm"
      data-testid="executive-position"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="position-title" className="flex items-center gap-2 text-base font-semibold text-slate-900">
          Value position <GovernedTag>Governed</GovernedTag>
        </h2>
        {f ? (
          <p className="text-sm text-slate-700" data-testid="overview-formal-position">
            Formal position as at <span className="font-semibold">{formatDate(f.date)}</span> ·{" "}
            <TextLink href={`${base}/assurance/${f.reviewId}`}>Review #{f.sequence}</TextLink>
          </p>
        ) : (
          <p className="text-sm font-medium text-slate-700" data-testid="overview-formal-position">
            No formal Assurance position yet.
          </p>
        )}
      </div>
      <dl className={`grid gap-x-8 gap-y-3 ${f ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-1"}`}>
        <Big
          label="Authorised Value"
          value={m(a.total)}
          note={`Authorised V${a.versionNumber}`}
          testId="overview-authorised-value"
        />
        {f && (
          <>
            <Big
              label="Realised"
              value={realisedHeadline(f.totals, o.currency).value}
              note={realisedNote(f.totals, o.currency)}
              testId="overview-realised"
            />
            <Big
              label="Formal Forecast"
              value={forecastHeadline(f.totals, o.currency).value}
              note={
                f.totals.forecastTotal === null
                  ? forecastHeadline(f.totals, o.currency).note
                  : "At the Value Period end"
              }
              testId="overview-forecast"
            />
            <Big
              label="Value Gap"
              value={headline(f.totals.valueGap, o.currency, "Incomplete")}
              note={
                olderBasis
                  ? `Against Authorised V${f.againstVersionNumber} (${m(f.totals.authorisedTotal)}) — no formal review against V${a.versionNumber} yet`
                  : "Authorised − Formal Forecast"
              }
              testId="overview-gap"
            />
          </>
        )}
      </dl>
      {next && <div className="mt-3 border-t border-slate-100 pt-2">{next}</div>}
    </section>
  );
}
