import type { AlternativeValueOutcomes } from "@/server/queries/outcomes";
import type { ExecutiveOverview } from "@/server/queries/overview";
import { TextLink } from "@/ui/components/layout";
import { formatDate, formatMoneyChange, formatMoneyShort } from "@/ui/format";
import { RECOMMENDATION_LABEL } from "@/ui/outcomes/outcomes";

// Latest recorded value decision (Phase 4D.9I; semantics 4D.9L): the most recent management value decision recorded
// at a finalised Assurance Review, with its source review identified. It may come from an earlier review than the
// latest formal position; it is never attributed to the latest review. A recommendation issued at the latest formal
// position and still awaiting management decision is shown as a recommendation, never as a decision.

export function LatestValueDecision({ o, base }: { o: ExecutiveOverview; base: string }) {
  const { recorded, awaiting } = o.decision;
  const m = (v: string) => formatMoneyShort(v, o.currency);
  const row = (label: string, value: React.ReactNode, testId: string) => (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-slate-100 py-1.5 last:border-0">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="text-right text-sm font-semibold text-slate-900" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
  const source = (d: AlternativeValueOutcomes, testId: string) => (
    <p className="mb-1 text-xs text-slate-500" data-testid={testId}>
      Source: Review #{d.review.sequence} · formal position as at {formatDate(d.review.date)} · against V
      {d.review.againstVersionNumber}
    </p>
  );
  const recommended = (d: AlternativeValueOutcomes) => d.outcomes.find((x) => x.recommended) ?? null;
  // Restrained empty state: one line, not an empty dashboard card — and nothing at all before a formal review.
  if (!o.formal) return null;
  if (!recorded && !awaiting) {
    return (
      <p className="text-sm text-slate-600" data-testid="decision-none">
        <span className="font-semibold text-slate-900">Latest recorded value decision:</span> no management value
        decision recorded at a formal Assurance Review.
      </p>
    );
  }
  if (!recorded && awaiting) {
    const rec = recommended(awaiting);
    return (
      <section
        aria-labelledby="decision-title"
        className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
        data-testid="latest-value-recommendation"
      >
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="decision-title" className="text-base font-semibold text-slate-900">
            Recommendation awaiting management decision
          </h2>
          <TextLink href={`${base}/assurance/${awaiting.review.id}#decision`}>View Assurance review →</TextLink>
        </div>
        {source(awaiting, "awaiting-source")}
        <dl>
          {row(
            RECOMMENDATION_LABEL,
            rec ? `${rec.label} · ${m(rec.totalValue)}` : "Not issued",
            "overview-recommendation",
          )}
          {row("Management selected", "Awaiting management decision", "overview-decision")}
        </dl>
        <p className="mt-2 text-xs text-slate-500">No management value decision has been recorded yet.</p>
      </section>
    );
  }
  const d = recorded!;
  const rec = recommended(d);
  const sel = d.outcomes.find((x) => x.selected) ?? null;
  const awaitingRec = awaiting ? recommended(awaiting) : null;
  return (
    <section
      aria-labelledby="decision-title"
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      data-testid="latest-value-decision"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="decision-title" className="text-base font-semibold text-slate-900">
          Latest recorded value decision
        </h2>
        <TextLink href={`${base}/assurance/${d.review.id}#decision`}>View Assurance decision →</TextLink>
      </div>
      {source(d, "decision-source")}
      <dl>
        {row(
          RECOMMENDATION_LABEL,
          rec ? `${rec.label} · ${m(rec.totalValue)}` : "Not issued",
          "overview-recommendation",
        )}
        {row("Management selected", sel ? `${sel.label} · ${m(sel.totalValue)}` : "—", "overview-decision")}
        {d.differenceFromRecommendation !== null &&
          row(
            "Difference",
            formatMoneyChange(d.differenceFromRecommendation, o.currency),
            "overview-decision-difference",
          )}
        {d.decision &&
          row(
            "Decision",
            `${formatDate(d.decision.decidedOn)}${d.decision.deciderName ? ` · ${d.decision.deciderName}` : ""}`,
            "overview-decision-meta",
          )}
      </dl>
      {d.review.sequence !== o.formal.sequence && (
        <p className="mt-2 text-xs text-slate-500" data-testid="decision-not-latest">
          Recorded at Review #{d.review.sequence}. The latest formal position (Review #{o.formal.sequence} ·{" "}
          {formatDate(o.formal.date)}){" "}
          {awaiting && awaitingRec
            ? `has an issued Cardaxia recommendation (${awaitingRec.label} · ${m(awaitingRec.totalValue)}) awaiting management decision.`
            : "records no Cardaxia recommendation or management decision."}
        </p>
      )}
    </section>
  );
}
