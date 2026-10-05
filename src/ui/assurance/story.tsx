import { RECOMMENDATION_STATE_LABELS } from "@/domain/recommendation";
import { DETERMINATION_LABELS } from "@/domain/value-case-impact";
import type { ReviewStory as Story, StoryMatter } from "@/server/queries/review-story";
import { GovernedTag, WorkingTag } from "@/ui/components/badges";
import { TextLink } from "@/ui/components/layout";
import { formatDate, formatMoneyChange, formatMoneyPlain, formatMoneyShort } from "@/ui/format";
import { ASSURANCE_STAGE_LABELS, TRIGGER_LABELS } from "@/ui/labels";
import { RECOMMENDATION_LABEL, SELECTED_LABEL } from "@/ui/outcomes/outcomes";

// Review story (Phase 4D.9G; reordered in 4D.10F): a compact, ordered management narrative around one Assurance
// Review — context → what changed → why it matters → formal value position → Assurance matters → Cardaxia's response →
// the management decision → Value Case impact. In-app only; issued report renderers are unaffected. Text only (no colour
// coding); each step links to the section holding the detail. Built from the explicit relationships in getReviewStory.

const VALUE_CHANGE_STATUS: Record<string, string> = {
  draft: "draft",
  proposed: "proposed",
  authorised: "authorised",
  rejected: "rejected",
  withdrawn: "withdrawn",
};

function Step({
  n,
  title,
  children,
  testId,
  wide = false,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  testId: string;
  /** Spans both columns in the two-column (laptop) layout so the last step is not orphaned. */
  wide?: boolean;
}) {
  return (
    <li
      className={`min-w-0 rounded border border-slate-200 bg-white px-3 py-2 ${wide ? "md:col-span-2" : ""}`}
      data-testid={testId}
    >
      <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
        <span className="sr-only">Step {n}: </span>
        {title}
      </h3>
      <div className="space-y-1 text-sm text-slate-800">{children}</div>
    </li>
  );
}

function MatterLines({
  m,
  currency,
  governed,
  base,
}: {
  m: StoryMatter;
  currency: string;
  governed: boolean;
  base: string;
}) {
  const money = (v: string | null) => formatMoneyShort(v, currency);
  // Exact amounts: the identity Total = Recoverable + Unrecoverable must read true (no rounding).
  const exact = (v: string) => formatMoneyPlain(v, currency);
  return (
    <div data-testid="story-matter-value">
      <p className="font-medium">
        <TextLink href={`${base}/assurance/matters/${m.id}`}>
          {m.code} {m.title}
        </TextLink>
      </p>
      <p className="text-xs text-slate-500">
        {[
          m.status === "closed" ? "Resolved" : "Open",
          m.stage && ASSURANCE_STAGE_LABELS[m.stage],
          m.ownerName && `Owner ${m.ownerName}`,
          m.raisedInThisReview && "raised in this review",
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {m.drivers.length === 0 ? (
        <p className="text-xs text-slate-500">No Value Driver linked.</p>
      ) : (
        m.drivers.map((d) => (
          <p key={d.code} className="text-xs text-slate-700" data-testid="story-driver">
            {d.code} {d.name ?? ""}
            {d.currentForecast !== null
              ? `: forecast ${money(d.previousForecast)} → ${money(d.currentForecast)}${
                  d.movement !== null ? ` (${formatMoneyChange(d.movement, currency)})` : ""
                }`
              : ": no forecast in this review"}
          </p>
        ))
      )}
      <p className="text-xs text-slate-700" data-testid="story-leakage">
        {m.leakage
          ? `${governed ? "" : "Draft assessment · "}Total Value Leakage ${exact(m.leakage.total)} = Recoverable ${exact(m.leakage.recoverable)} + Unrecoverable ${exact(m.leakage.unrecoverable)}`
          : governed
            ? "Value Leakage not yet quantified in this review"
            : "Not yet assessed in this draft review"}
      </p>
    </div>
  );
}

export function ReviewStory({ story: s, currency, base }: { story: Story; currency: string; base: string }) {
  const money = (v: string | null) => formatMoneyShort(v, currency);
  const g = s.governed;
  return (
    <section
      aria-labelledby="story-title"
      className={`mb-6 rounded-lg p-4 ${g ? "border border-slate-200 bg-slate-50" : "border-2 border-dashed border-violet-300 bg-violet-50/30"}`}
      data-testid="review-story"
      data-governed={g ? "true" : "false"}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="story-title" className="text-base font-semibold text-slate-900">
          {g ? "Why the value position moved" : "Working Assurance context"}
        </h2>
        {g ? (
          <GovernedTag>Formal record · Review #{s.review.sequence}</GovernedTag>
        ) : (
          <WorkingTag>Working · not formally reviewed</WorkingTag>
        )}
      </div>
      <p className="mb-2 text-xs text-slate-600" data-testid="story-context">
        Review #{s.review.sequence} · {formatDate(s.review.date)} · {TRIGGER_LABELS[s.review.trigger]} · against
        Authorised V{s.review.againstVersionNumber}
      </p>
      <ol className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <Step n={1} title="What changed" testId="story-what-changed">
          {s.review.whatChanged ? (
            <p className="line-clamp-4">{s.review.whatChanged}</p>
          ) : (
            <p className="text-xs text-slate-500">Not recorded.</p>
          )}
          {s.evidence.length > 0 && (
            <p className="text-xs text-slate-600" data-testid="story-evidence">
              Evidence: {s.evidence.map((e) => `${e.code} ${e.title}${e.trigger ? " (trigger)" : ""}`).join("; ")}
            </p>
          )}
        </Step>

        <Step n={2} title="Why it matters" testId="story-why-it-matters">
          {s.review.whyItMatters ? (
            <p className="line-clamp-4">{s.review.whyItMatters}</p>
          ) : (
            <p className="text-xs text-slate-500">Not recorded.</p>
          )}
        </Step>

        <Step n={3} title={g ? "Formal value position" : "Value position"} testId="story-value-position">
          {g ? (
            <p className="text-xs text-slate-700" data-testid="story-position">
              Formal position as at {formatDate(s.review.date)} against V{s.review.againstVersionNumber}: forecast{" "}
              {s.position.forecastTotal === null ? "incomplete" : money(s.position.forecastTotal)} · Value Gap{" "}
              {s.position.valueGap === null ? "—" : money(s.position.valueGap)} · realised{" "}
              {s.position.realisedTotal === null
                ? "not recorded"
                : `${money(s.position.realisedTotal)}${s.position.realisedComplete ? "" : " (partial)"}`}
            </p>
          ) : (
            <p className="text-xs text-slate-700" data-testid="story-position">
              Not yet a formal position — finalising the review records it. Authorised{" "}
              {money(s.position.authorisedTotal)}.
            </p>
          )}
          <p className="text-xs">
            <TextLink href="#position">Forecast Value Position →</TextLink>
          </p>
        </Step>

        <Step n={4} title="Assurance matters" testId="story-value-affected">
          {s.matters.length === 0 ? (
            <p className="text-xs text-slate-500" data-testid="story-no-matters">
              {g ? "No Assurance matter recorded in this review." : "No open Assurance matter."}
            </p>
          ) : (
            <ul className="space-y-1" data-testid="story-matters">
              {s.matters.map((m) => (
                <li key={m.id} data-testid="story-matter">
                  <MatterLines m={m} currency={currency} governed={g} base={base} />
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-500">Value Leakage is assessed per matter; it is not the Value Gap.</p>
        </Step>

        <Step n={5} title="Cardaxia response" testId="story-response">
          {s.recommendation ? (
            <>
              <p>
                {s.recommendation.issued
                  ? RECOMMENDATION_LABEL
                  : s.recommendation.state === "draft"
                    ? "Draft recommendation (not issued)"
                    : `Recommendation · ${RECOMMENDATION_STATE_LABELS[s.recommendation.state]} (not issued)`}
                : <span className="font-medium">{s.recommendation.label}</span>
              </p>
              <p className="text-xs text-slate-700">
                Stored option total {money(s.recommendation.totalValue)} ·{" "}
                {s.recommendation.milestones ? "path entered" : "phasing not entered"}
              </p>
            </>
          ) : (
            <p className="text-xs text-slate-500">No recommendation saved.</p>
          )}
          <p className="text-xs">
            <TextLink href="#options">Options assessed →</TextLink>
          </p>
        </Step>

        <Step n={6} title="Management decision" testId="story-decision">
          {s.decision ? (
            <>
              <p>
                {SELECTED_LABEL}: <span className="font-medium">{s.decision.label}</span>
              </p>
              <p className="text-xs text-slate-700">
                Stored option total {money(s.decision.totalValue)}
                {s.decision.differenceFromRecommendation !== null &&
                  ` · ${formatMoneyChange(s.decision.differenceFromRecommendation, currency)} vs recommendation`}
              </p>
              <p className="text-xs text-slate-600">
                {s.decision.deciderName}, {formatDate(s.decision.decidedOn)}
              </p>
              <p className="text-xs text-slate-600" data-testid="story-rationale">
                {s.decision.rationale ?? "No rationale recorded."}
              </p>
              {s.decision.economicConsequence && (
                <p className="text-xs text-slate-600">Consequence: {s.decision.economicConsequence}</p>
              )}
            </>
          ) : (
            <p className="text-xs text-slate-500" data-testid="story-no-decision">
              No client decision recorded.
            </p>
          )}
        </Step>

        <Step n={7} title="Value Case impact" testId="story-governance" wide>
          {s.determination && (
            <p className="text-xs" data-testid="story-determination">
              <span className="font-medium">{DETERMINATION_LABELS[s.determination.determination]}</span>:{" "}
              {s.determination.rationale}
            </p>
          )}
          {s.valueChanges.length > 0 ? (
            <ul className="space-y-0.5" data-testid="story-value-changes">
              {s.valueChanges.map((c) => (
                <li key={c.id} className="text-xs" data-testid="story-value-change">
                  <TextLink href={`${base}/changes/${c.id}`}>{c.code}</TextLink> · V{c.fromVersionNumber} → V
                  {c.toVersionNumber} · {VALUE_CHANGE_STATUS[c.status] ?? c.status}
                  {c.authorisedOn && ` ${formatDate(c.authorisedOn)}`}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500" data-testid="story-no-value-change">
              No Value Change linked to this review. Forecast movement does not change the Authorised Value Case.
            </p>
          )}
        </Step>
      </ol>
    </section>
  );
}
