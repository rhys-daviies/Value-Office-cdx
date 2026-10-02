import type { ExecutiveOverview } from "@/server/queries/overview";
import { TextLink } from "@/ui/components/layout";
import { formatDate, formatMoneyChange, formatMoneyShort } from "@/ui/format";
import { RECOMMENDATION_LABEL } from "@/ui/outcomes/outcomes";

// Latest value decision (Phase 4D.9I): the latest finalised review's issued Cardaxia recommendation and the management
// decision against it, as text. The selected-vs-recommended difference appears only once a decision exists; the
// option paths themselves stay on the review (Alternative Value Trajectories).

export function LatestValueDecision({ o, base }: { o: ExecutiveOverview; base: string }) {
  const d = o.decision;
  const m = (v: string) => formatMoneyShort(v, o.currency);
  const rec = d?.outcomes.find((x) => x.recommended) ?? null;
  const sel = d?.outcomes.find((x) => x.selected) ?? null;
  const row = (label: string, value: React.ReactNode, testId: string) => (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-slate-100 py-1.5 last:border-0">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="text-right text-sm font-semibold text-slate-900" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
  // Restrained empty state: one line, not an empty dashboard card — and nothing at all before a formal review.
  if (!d && !o.formal) return null;
  if (!d) {
    return (
      <p className="text-sm text-slate-600" data-testid="decision-none">
        <span className="font-semibold text-slate-900">Latest value decision:</span> no Cardaxia recommendation or
        management decision at the latest formal review.
      </p>
    );
  }
  return (
    <section
      aria-labelledby="decision-title"
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      data-testid="latest-value-decision"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="decision-title" className="text-base font-semibold text-slate-900">
          Latest value decision
        </h2>
        <TextLink href={`${base}/assurance/${d.review.id}#decision`}>View Assurance decision →</TextLink>
      </div>
      {
        <>
          <p className="mb-1 text-xs text-slate-500">
            Review #{d.review.sequence} · {formatDate(d.review.date)}
          </p>
          <dl>
            {row(
              RECOMMENDATION_LABEL,
              rec ? `${rec.label} · ${m(rec.totalValue)}` : "Not issued",
              "overview-recommendation",
            )}
            {row(
              "Management selected",
              sel ? `${sel.label} · ${m(sel.totalValue)}` : "Awaiting management decision",
              "overview-decision",
            )}
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
        </>
      }
    </section>
  );
}
