import { RECOMMENDATION_STATE_LABELS } from "@/domain/recommendation";
import { DETERMINATION_LABELS, type ValueCaseImpactStage } from "@/domain/value-case-impact";
import type { ExecutiveOverview } from "@/server/queries/overview";
import { TextLink } from "@/ui/components/layout";

// Governance at a glance (Phase 4D.10H): the draft review and its recommendation, the latest management decision and
// its Value Case impact, any open Value Change — and the one next governed action. Orientation only; the detail and
// every action live in Assurance and the Value Change.

const IMPACT: Record<ValueCaseImpactStage, string> = {
  no_decision: "—",
  awaiting_determination: "To be determined",
  no_value_change: DETERMINATION_LABELS.no_value_change_required,
  proposed_not_prepared: `${DETERMINATION_LABELS.value_change_proposed} · not yet prepared`,
  change_in_progress: "Value Change in progress",
  change_authorised: "Value Change authorised",
  change_closed: "Value Change closed without authorisation",
};

export function ExecutiveGovernance({ o, base }: { o: ExecutiveOverview; base: string }) {
  const g = o.governance;
  const rows: [string, React.ReactNode, string][] = [
    [
      "Formal review in progress",
      g.draftReview ? (
        <TextLink href={`${base}/assurance/${g.draftReview.id}`}>Review #{g.draftReview.sequence} (draft)</TextLink>
      ) : (
        "None"
      ),
      "gov-draft-review",
    ],
    [
      "Recommendation",
      g.draftReview?.recommendation
        ? RECOMMENDATION_STATE_LABELS[g.draftReview.recommendation]
        : g.awaitingDecision
          ? `Issued (Review #${g.awaitingDecision.sequence})`
          : "None in progress",
      "gov-recommendation",
    ],
    [
      "Management decision",
      g.awaitingDecision
        ? `Awaiting decision (Review #${g.awaitingDecision.sequence})`
        : g.latestDecision
          ? `Recorded (Review #${g.latestDecision.sequence})`
          : "None recorded",
      "gov-decision",
    ],
    ["Value Case impact", g.latestDecision ? IMPACT[g.latestDecision.stage] : "—", "gov-impact"],
    [
      "Value Change",
      g.openChange ? (
        <TextLink href={`${base}/changes/${g.openChange.id}`}>
          {g.openChange.code} ({g.openChange.status})
        </TextLink>
      ) : (
        "None open"
      ),
      "gov-change",
    ],
  ];
  return (
    <section
      aria-labelledby="governance-title"
      className="mb-6 rounded-lg border border-slate-200 bg-white px-5 py-3 shadow-sm"
      data-testid="overview-governance"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="governance-title" className="text-base font-semibold text-slate-900">
          Governance
        </h2>
        {g.nextAction ? (
          <a
            href={g.nextAction.href}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
            data-testid="overview-next-action"
          >
            Next: {g.nextAction.label} →
          </a>
        ) : (
          <span className="text-sm text-slate-500" data-testid="overview-next-action-none">
            No governed action pending
          </span>
        )}
      </div>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-5">
        {rows.map(([label, value, testId]) => (
          <div key={testId} className="min-w-0">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="text-slate-900" data-testid={testId}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
