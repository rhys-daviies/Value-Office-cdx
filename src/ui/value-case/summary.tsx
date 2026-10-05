import type { ValueCaseSummary as Summary } from "@/server/queries/value-case-summary";
import { GovernedTag } from "@/ui/components/badges";
import { TextLink } from "@/ui/components/layout";
import { formatDate, formatMoneyAdaptiveChange, formatMoneyShort } from "@/ui/format";

// Compact Value Case governance summary for Overview (Phase 4D.9H). Text only: the full Value Case Evolution and the
// Value Change history live on the Value Case page.

export function ValueCaseSummary({ summary: s, base }: { summary: Summary; base: string }) {
  const m = (v: string | null) => formatMoneyShort(v, s.currency);
  const item = (label: string, value: React.ReactNode, note: React.ReactNode, testId: string) => (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-base font-semibold text-slate-900" data-testid={testId}>
        {value}
      </dd>
      {note && <dd className="text-xs text-slate-500">{note}</dd>}
    </div>
  );
  return (
    <section
      id="value-case-summary"
      aria-labelledby="value-case-summary-title"
      className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      data-testid="value-case-summary"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="value-case-summary-title" className="flex items-center gap-2 text-base font-semibold text-slate-900">
          Value Case <GovernedTag>Governed commitment</GovernedTag>
        </h2>
        <TextLink href={`${base}/value-case#evolution`}>View Value Case history →</TextLink>
      </div>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
        {item(
          "Current Authorised Value",
          s.current ? m(s.current.authorisedValue) : "Not yet authorised",
          s.current
            ? `V${s.current.versionNumber}${s.current.authorisedOn ? ` · authorised ${formatDate(s.current.authorisedOn)}` : ""}`
            : "The commitment begins when the VCO authorises V1",
          "summary-current",
        )}
        {item(
          "Original Business Case",
          !s.originalBusinessCase
            ? "Not recorded"
            : s.originalBusinessCase.value === null
              ? "Value not stated"
              : m(s.originalBusinessCase.value),
          s.originalBusinessCase ? "Recorded starting point" : null,
          "summary-original",
        )}
        {item(
          "Authorised Value Changes",
          String(s.authorisedChangeCount),
          s.latestAuthorisedChange
            ? `Latest ${s.latestAuthorisedChange.code} → V${s.latestAuthorisedChange.versionNumber}${
                s.latestAuthorisedChange.authorisedOn ? ` · ${formatDate(s.latestAuthorisedChange.authorisedOn)}` : ""
              }`
            : "None",
          "summary-changes",
        )}
        {item(
          "Pending Value Change",
          s.pending.length === 0 ? "None" : s.pending.map((p) => `${p.code} → V${p.toVersionNumber}`).join(", "),
          s.pending.length === 0
            ? null
            : s.pending.map((p) => (
                <span key={p.id} className="block" data-testid="summary-pending">
                  {p.reconciled === false ? (
                    // Existing invariant surfaced: both figures shown as recorded; neither is adjusted.
                    <>
                      Stated change {formatMoneyAdaptiveChange(p.statedChange, s.currency)} · Current draft movement{" "}
                      {formatMoneyAdaptiveChange(p.proposedChange, s.currency)} ·{" "}
                      <span className="font-medium text-slate-700" data-testid="summary-pending-unreconciled">
                        Does not reconcile
                      </span>
                    </>
                  ) : (
                    <>Proposed change {formatMoneyAdaptiveChange(p.proposedChange, s.currency)}</>
                  )}{" "}
                  · {p.status === "draft" ? "Draft" : "Proposed"} — not in force ·{" "}
                  <TextLink href={`${base}/changes/${p.id}`}>Open {p.code}</TextLink>
                </span>
              )),
          "summary-pending-codes",
        )}
      </dl>
    </section>
  );
}
