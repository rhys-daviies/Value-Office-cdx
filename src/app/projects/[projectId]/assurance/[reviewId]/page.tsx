import { notFound } from "next/navigation";

import { ASSURANCE_TRIGGERS } from "@/domain/statuses";
import {
  finaliseReviewAction,
  linkReviewEvidenceAction,
  saveValuePositionsAction,
  unlinkReviewEvidenceAction,
  updateReviewAction,
} from "@/server/actions/assurance";
import { RECOMMENDATION_STATE_LABELS } from "@/domain/recommendation";
import { hasRationale } from "@/domain/value-case";
import {
  getAssuranceWorkspace,
  listMatterOptions,
  listReviewEvidenceOptions,
  type AssuranceWorkspace,
} from "@/server/queries/assurance";
import { listOpenMatterEvidence } from "@/server/queries/evidence";
import { listDriverOptions } from "@/server/queries/information-request";
import { listStakeholders } from "@/server/queries/mobilise";
import { getReviewResponse } from "@/server/queries/response";
import { getReviewStory } from "@/server/queries/review-story";
import { getContinuousAssuranceWorkspace } from "@/server/queries/workspace";
import { getAlternativeValueTrajectories, getReviewTrajectoryAuthoring } from "@/server/queries/trajectory";
import {
  DecisionSection,
  LeakageSection,
  OptionsSection,
  RecommendationSection,
  ValueCaseImpactSection,
} from "@/ui/assurance/response";
import { ReviewStory } from "@/ui/assurance/story";
import { ActionForm, SubmitButton } from "@/ui/components/action-form";
import { EvidenceBadge, NonFinancialBadge, PlainBadge, QualificationBadge } from "@/ui/components/badges";
import {
  Checkbox,
  DateField,
  FormGrid,
  Hidden,
  MoneyField,
  SelectField,
  TextArea,
  TextField,
} from "@/ui/components/fields";
import { Empty, KeyValues, Section, Table, TextLink } from "@/ui/components/layout";
import { reportPreviewHref } from "@/ui/reports/routes";
import {
  change,
  Figure,
  forecastHeadline,
  headline,
  realisedHeadline,
  ReviewStatusBadge,
} from "@/ui/assurance/display";
import { formatDate, formatDateTime, formatMoneyShort, moneyInputValue } from "@/ui/format";
import { TRIGGER_LABELS } from "@/ui/labels";
import { isUuid, requireProject } from "@/ui/require";
import { DraftTrajectoryPreview, ReviewOptionsVisual } from "@/ui/trajectory/alternatives";
import { ForecastTrajectorySection, OptionPathsSection } from "@/ui/trajectory/milestones";

export const metadata = { title: "Assurance Review" };

export default async function AssuranceReviewPage({ params }: PageProps<"/projects/[projectId]/assurance/[reviewId]">) {
  const { projectId, reviewId } = await params;
  const { project } = await requireProject(projectId);
  if (!isUuid(reviewId)) notFound();
  const ws = await getAssuranceWorkspace(projectId, reviewId);
  if (!ws) notFound();
  const [evidenceOptions, matterEvidence, matters] = await Promise.all([
    listReviewEvidenceOptions(projectId),
    listOpenMatterEvidence(projectId),
    listMatterOptions(projectId),
  ]);

  const { review, totals } = ws;
  const currency = project.currency;
  const draft = review.status === "draft";
  const base = `/projects/${projectId}`;
  const priorLabel = ws.previous
    ? `Review #${ws.previous.sequence} (${formatDate(ws.previous.reviewDate)})`
    : `Authorised Value V${ws.againstVersion.versionNumber} — first review`;
  const forecast = forecastHeadline(totals, currency);
  const realised = realisedHeadline(totals, currency);
  const blankForecasts = totals.forecastBlockers.filter((b) => !b.notAssessed);
  const notAssessed = totals.forecastBlockers.filter((b) => b.notAssessed);
  // 4D.10E: forecast movements that still need their governed "why" (mirrors the finalisation gate).
  const unexplained = ws.rows.filter((r) => r.governed.rationaleRequired && !hasRationale(r.forecastRationale));
  const response = await getReviewResponse(projectId, review.id);
  const trajectory = await getReviewTrajectoryAuthoring(projectId, review.id, ws.totals.forecastTotal);
  const [stakeholders, driverOptions, alternatives, story] = await Promise.all([
    listStakeholders(projectId),
    listDriverOptions(projectId),
    getAlternativeValueTrajectories(projectId, review.id),
    getReviewStory(projectId, review.id),
  ]);
  const outcomes = alternatives?.outcomes ?? null;

  const draftMatters = draft ? await getContinuousAssuranceWorkspace(projectId) : null;
  const living = new Map(draftMatters?.matters.map((m) => [m.entry.leakage.id, m]) ?? []);
  const openMatters = response.leakage.filter((l) => l.leakage.status === "open");
  const responseProps = { projectId, currency, review, response };
  // 4D.10H: a governed recommendation process in progress must complete before the review is finalised.
  const recInReview =
    response.recommendation?.state === "in_internal_review" || response.recommendation?.state === "ready_to_issue";
  const steps: { id: string; label: string; state?: string; done?: boolean }[] = [
    { id: "context", label: "Review context" },
    {
      id: "reasoning",
      label: "What changed · Why it matters",
      done: Boolean(review.whatChanged && review.whyItMatters),
      state: review.whatChanged && review.whyItMatters ? "recorded" : "to record",
    },
    {
      id: "leakage",
      label: "Risks / Value Leakage",
      done: openMatters.length === 0 || openMatters.every((l) => l.thisReview),
      state: `${openMatters.filter((l) => l.thisReview).length} of ${openMatters.length} open assessed`,
    },
    {
      id: "position",
      label: "Forecast Value Position",
      done: ws.missingPositions === 0 && blankForecasts.length === 0 && unexplained.length === 0,
      state:
        ws.missingPositions > 0
          ? `${ws.missingPositions} position(s) missing`
          : unexplained.length > 0
            ? `${unexplained.length} movement(s) to explain`
            : "complete",
    },
    { id: "options", label: "Management options", state: `${response.scenarios.length} option(s)` },
    {
      id: "recommendation",
      label: "Recommendation",
      done: Boolean(response.recommendation?.issuedAt),
      state: response.recommendation ? RECOMMENDATION_STATE_LABELS[response.recommendation.state] : "none",
    },
    {
      id: "decision",
      label: "Decision",
      done: Boolean(response.decision),
      state: response.decision ? "recorded" : "none",
    },
    {
      id: "value-change",
      label: "Value Case impact",
      state: response.changes.length ? response.changes.map((c) => c.code).join(", ") : "no Value Change",
    },
  ];

  return (
    <>
      <p className="mb-3 text-sm">
        <TextLink href={`${base}/assurance`}>← Value Assurance</TextLink>
        {" · "}
        <TextLink href={reportPreviewHref(projectId, "assurance", review.id)}>Value Assurance Report</TextLink>
      </p>

      {/* ---- Review header ---------------------------------------------------------- */}
      <div
        className={`mb-4 rounded-lg border-2 px-4 py-3 ${draft ? "border-amber-300 bg-amber-50" : "border-emerald-400 bg-emerald-50"}`}
        data-testid="review-state"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Assurance Review #{review.sequence}</h2>
          <ReviewStatusBadge status={review.status} />
        </div>
        <p className="text-sm">
          {draft
            ? "Draft — work through the review from context to Value Case impact, then finalise."
            : `Finalised ${formatDateTime(review.finalisedAt)} by ${ws.finalisedBy?.name ?? "—"} — read-only. Corrections require a new review.`}
        </p>
      </div>

      {story && <ReviewStory story={story} currency={currency} base={base} />}

      <nav aria-label="Review sections" className="mb-6" data-testid="review-steps">
        <ol className="flex flex-wrap gap-1 text-xs">
          {steps.map((st, i) => (
            <li key={st.id}>
              <a
                href={`#${st.id}`}
                className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-slate-700 hover:border-slate-500"
                data-testid={`review-step-${st.id}`}
              >
                <span className="font-semibold text-slate-400">{String.fromCharCode(65 + i)}</span>
                {st.label}
                {st.state && (
                  <span className={st.done ? "text-emerald-700" : "text-slate-400"}>
                    {st.done ? "✓" : "·"} {st.state}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {/* ---- A. Review context / current value position ------------------------------ */}
      <Section
        id="context"
        title="Review context"
        testId="review-context"
        description="The Authorised Value Case this review measures against and the formal position it moves from."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <KeyValues
              items={[
                ["Review date", formatDate(review.reviewDate)],
                ["Trigger", TRIGGER_LABELS[review.trigger]],
                [
                  "Trigger evidence",
                  ws.triggerEvidence ? (
                    <TextLink href={`${base}/evidence/${ws.triggerEvidence.id}`}>
                      {ws.triggerEvidence.code} {ws.triggerEvidence.title}
                    </TextLink>
                  ) : (
                    "—"
                  ),
                ],
                [
                  "Against",
                  <TextLink key="v" href={`${base}/value-case/v/${ws.againstVersion.versionNumber}`}>
                    Authorised V{ws.againstVersion.versionNumber}
                  </TextLink>,
                ],
                [
                  "Previous position",
                  <span key="p" data-testid="previous-position">
                    {priorLabel}
                  </span>,
                ],
                ["Opened by", `${ws.createdByName ?? "—"} · ${formatDateTime(review.createdAt)}`],
              ]}
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="context-position">
              <Figure
                label={`Authorised Value (V${ws.againstVersion.versionNumber})`}
                value={formatMoneyShort(totals.authorisedTotal, currency)}
                testId="context-authorised"
              />
              <Figure
                label={ws.previous ? `Review #${ws.previous.sequence} formal forecast` : "Previous formal forecast"}
                testId="context-previous"
                value={ws.previous ? headline(totals.previousTotal, currency, "Incomplete") : "None (first review)"}
                note={ws.previous ? formatDate(ws.previous.reviewDate) : "Movement is measured from Authorised Value"}
              />
            </div>
          </div>
          {draft && (
            <ActionForm action={updateReviewAction} testId="review-details-form">
              <Hidden name="projectId" value={projectId} />
              <Hidden name="reviewId" value={review.id} />
              <FormGrid>
                <DateField name="reviewDate" label="Review date" required defaultValue={review.reviewDate} />
                <SelectField
                  name="trigger"
                  label="Trigger"
                  required
                  defaultValue={review.trigger}
                  options={ASSURANCE_TRIGGERS.map((t) => ({ value: t, label: TRIGGER_LABELS[t] }))}
                />
              </FormGrid>
              <div className="mt-3">
                <SelectField
                  name="triggerEvidenceId"
                  label="Trigger evidence"
                  defaultValue={review.triggerEvidenceId}
                  placeholder="— None —"
                  options={evidenceOptions.map((e) => ({
                    value: e.id,
                    label: `${e.code} ${e.title}${e.isMaterialChange ? " · material change" : ""}`,
                  }))}
                />
              </div>
              <div className="mt-3">
                <SubmitButton variant="secondary">Save review details</SubmitButton>
              </div>
            </ActionForm>
          )}
        </div>
      </Section>

      {/* ---- B + C. What changed? Why does it matter? ------------------------------------ */}
      <Section
        id="reasoning"
        title="What changed and why it matters"
        testId="review-reasoning"
        description="Review-level reasoning about the Value Case. Driver movements are explained in the Forecast Value Position; matters carry their own descriptions."
      >
        {draft ? (
          <ActionForm action={updateReviewAction} testId="reasoning-form">
            <Hidden name="projectId" value={projectId} />
            <Hidden name="reviewId" value={review.id} />
            <div className="grid gap-3 lg:grid-cols-2">
              <TextArea
                name="whatChanged"
                label="What changed?"
                rows={4}
                defaultValue={review.whatChanged}
                hint="Since the previous value position."
              />
              <TextArea
                name="whyItMatters"
                label="Why does it matter?"
                rows={4}
                defaultValue={review.whyItMatters}
                hint="The economic significance for the Authorised Value Case."
              />
            </div>
            <div className="mt-3">
              <TextArea
                name="summary"
                label="Review summary (optional — often written last)"
                rows={2}
                defaultValue={review.summary}
              />
            </div>
            <div className="mt-2">
              <SubmitButton variant="secondary">Save</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase">What changed?</p>
                <p className="whitespace-pre-wrap" data-testid="what-changed">
                  {review.whatChanged ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase">Why does it matter?</p>
                <p className="whitespace-pre-wrap" data-testid="why-it-matters">
                  {review.whyItMatters ?? "—"}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase">Summary</p>
              <p className="whitespace-pre-wrap" data-testid="review-summary-text">
                {review.summary ?? "—"}
              </p>
            </div>
          </div>
        )}
      </Section>

      {/* ---- D. Risks / Value Leakage / Evidence / Remediation --------------------------- */}
      <LeakageSection
        {...responseProps}
        stakeholders={stakeholders.map((p) => ({ value: p.personId, label: p.name }))}
        drivers={driverOptions}
        living={living}
        reviewEvidence={
          <ReviewEvidence
            projectId={projectId}
            base={base}
            reviewId={review.id}
            draft={draft}
            evidence={ws.evidence}
            evidenceOptions={evidenceOptions}
            candidates={matterEvidence.filter((c) => !ws.evidence.some((e) => e.evidenceId === c.evidenceId))}
          />
        }
      />

      {/* ---- E. Forecast Value Position --------------------------------------------------- */}
      <Section
        id="position"
        title="Forecast Value Position"
        testId="forecast-position"
        description={`Per Value Driver: formal baseline → Current Forecast → movement → why it changed. Movement is Current Forecast − ${ws.previous ? `Review #${ws.previous.sequence} forecast` : "Authorised Value (first review)"}; Value Gap is Authorised Value − Current Forecast.`}
      >
        <PositionTable ws={ws} currency={currency} matters={matters} draft={draft} base={base} />
        {draft && <PositionEditor ws={ws} projectId={projectId} currency={currency} matters={matters} />}

        <h3 className="mt-6 mb-2 text-sm font-semibold">Position summary</h3>
        <p className="mb-2 text-xs text-slate-500">
          Financial drivers only; non-financial drivers are excluded from totals.
        </p>
        <div className="grid gap-3 sm:grid-cols-5" data-testid="review-summary">
          <Figure
            label={`Authorised (V${ws.againstVersion.versionNumber})`}
            value={formatMoneyShort(totals.authorisedTotal, currency)}
            testId="review-authorised"
          />
          <Figure
            label="Current Forecast"
            value={forecast.value}
            note={forecast.note}
            testId="review-forecast"
            emphasis
          />
          <Figure label="Realised Value (total)" value={realised.value} note={realised.note} testId="review-realised" />
          <Figure label="Value Gap" value={headline(totals.valueGap, currency, "Incomplete")} testId="review-gap" />
          <Figure
            label="Movement"
            value={change(totals.movement, currency, "Incomplete")}
            note={
              ws.previous
                ? `vs Review #${ws.previous.sequence} (${headline(totals.previousTotal, currency, "—")})`
                : "vs Authorised Value"
            }
            testId="review-movement"
          />
        </div>
        {totals.forecastBlockers.length > 0 && (
          <div
            className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900"
            data-testid="forecast-blockers"
          >
            Project Current Forecast and Value Gap are incomplete because of:{" "}
            {totals.forecastBlockers
              .map((b) => `${b.code} ${b.name} (${b.notAssessed ? "Not Assessed" : "blank"})`)
              .join(", ")}
          </div>
        )}

        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3" data-testid="realised-breakdown">
          <div className="rounded border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Attributed Realised Value</p>
            <p className="text-lg font-semibold" data-testid="realised-attributed">
              {totals.realisedAttributedTotal === null
                ? "None attributed"
                : formatMoneyShort(totals.realisedAttributedTotal, currency)}
            </p>
            <p className="text-xs text-slate-500">
              Sum of per-driver realised values ({totals.realisedAssessed} of {totals.financialDriverCount} drivers)
            </p>
          </div>
          <div className="rounded border border-violet-200 bg-violet-50 p-3">
            <p className="text-xs text-violet-800">Unattributed Realised Value</p>
            <p className="text-lg font-semibold text-violet-900" data-testid="realised-unattributed">
              {totals.unattributedRealised === null ? "None" : formatMoneyShort(totals.unattributedRealised, currency)}
            </p>
            <p className="text-xs text-violet-800">Known at project level; not yet attributed to any Value Driver</p>
            {review.unattributedRealisedRationale && !draft && (
              <p className="mt-1 text-xs text-violet-900" data-testid="unattributed-rationale">
                {review.unattributedRealisedRationale}
              </p>
            )}
          </div>
          <div className="rounded border border-slate-300 p-3">
            <p className="text-xs text-slate-500">Total Realised Value</p>
            <p className="text-lg font-semibold" data-testid="realised-total">
              {realised.value}
            </p>
            <p className="text-xs text-slate-500">Attributed + unattributed</p>
          </div>
        </div>
        {draft && (
          <div className="mt-3">
            <ActionForm action={updateReviewAction} testId="unattributed-form">
              <Hidden name="projectId" value={projectId} />
              <Hidden name="reviewId" value={review.id} />
              <FormGrid>
                <MoneyField
                  name="unattributedRealisedValue"
                  label="Unattributed realised value"
                  currency={currency}
                  defaultValue={moneyInputValue(review.unattributedRealisedValue)}
                  hint="Only for realised value known at project level that cannot yet be responsibly attributed to drivers. Leave blank if none."
                />
                <TextArea
                  name="unattributedRealisedRationale"
                  label="Why it remains unattributed"
                  rows={2}
                  defaultValue={review.unattributedRealisedRationale}
                />
              </FormGrid>
              <div className="mt-2">
                <SubmitButton variant="secondary">Save unattributed realised value</SubmitButton>
              </div>
            </ActionForm>
          </div>
        )}
      </Section>

      {/* ---- Formal forecast milestones (Phase 4D.9D) ------------------------------------ */}
      {trajectory && (
        <Section
          id="forecast-trajectory"
          title="Formal forecast milestones"
          description="Optional dated milestones from this review to the Value Period end, ending at the formal forecast."
        >
          <ForecastTrajectorySection
            projectId={projectId}
            reviewId={review.id}
            currency={currency}
            authoring={trajectory}
          />
        </Section>
      )}

      {/* ---- F–I. Options → Recommendation → Decision → Value Case impact ------------------ */}
      <OptionsSection
        {...responseProps}
        currentForecastTotal={totals.forecastTotal}
        optionPaths={
          trajectory && (
            <>
              <OptionPathsSection projectId={projectId} currency={currency} authoring={trajectory} />
              {draft && alternatives && <DraftTrajectoryPreview data={alternatives} />}
            </>
          )
        }
      />
      <RecommendationSection {...responseProps} />
      <DecisionSection
        {...responseProps}
        stakeholders={stakeholders.map((p) => ({ value: p.personId, label: p.name }))}
        evidence={evidenceOptions.map((e) => ({ value: e.id, label: `${e.code} ${e.title}` }))}
        outcomes={
          outcomes && outcomes.review.finalised && outcomes.outcomes.length > 0 ? (
            <ReviewOptionsVisual data={alternatives!} />
          ) : undefined
        }
      />
      <ValueCaseImpactSection
        {...responseProps}
        authorised={{
          versionNumber: ws.againstVersion.versionNumber,
          total: totals.authorisedTotal,
          forecastTotal: totals.forecastTotal,
          valueGap: totals.valueGap,
        }}
      />

      {draft && (
        <Section id="finalise" title="Finalise review" tone="muted">
          <ul className="mb-3 space-y-1 text-sm" data-testid="finalise-checklist">
            <li className={ws.missingPositions === 0 ? "text-emerald-800" : "text-red-700"}>
              {ws.missingPositions === 0
                ? "✓ Every Value Driver has a Value Position"
                : `✗ ${ws.missingPositions} Value Driver(s) have no saved position — required`}
            </li>
            <li className={blankForecasts.length === 0 ? "text-emerald-800" : "text-red-700"}>
              {blankForecasts.length === 0
                ? "✓ Every financial driver has a Current Forecast or an explicit Not Assessed"
                : `✗ ${blankForecasts.map((b) => b.code).join(", ")}: no Current Forecast — enter one or mark Not Assessed with a rationale (required)`}
            </li>
            {notAssessed.length > 0 && (
              <li className="text-amber-800">
                ⚠ Not Assessed: {notAssessed.map((b) => b.code).join(", ")} — project forecast and Value Gap will show
                as Incomplete
              </li>
            )}
            <li className={unexplained.length === 0 ? "text-emerald-800" : "text-red-700"} data-testid="finalise-why">
              {unexplained.length === 0
                ? "✓ Every forecast movement has a reason"
                : `✗ ${unexplained.map((r) => r.code).join(", ")}: forecast moved from its formal baseline — record why (required)`}
            </li>
            <li className={review.whatChanged ? "text-emerald-800" : "text-amber-800"}>
              {review.whatChanged ? "✓ What changed recorded" : "⚠ What changed not recorded"}
            </li>
            <li className={review.whyItMatters ? "text-emerald-800" : "text-amber-800"}>
              {review.whyItMatters ? "✓ Why it matters recorded" : "⚠ Why it matters not recorded"}
            </li>
            {recInReview && (
              <li className="text-red-700" data-testid="finalise-recommendation">
                ✗ The recommendation is {RECOMMENDATION_STATE_LABELS[response.recommendation!.state]} — issue it, or
                return it for revision, before finalising (required)
              </li>
            )}
            {draftMatters && draftMatters.evidenceOutstanding.items > 0 && (
              <li className="text-amber-800" data-testid="finalise-evidence-outstanding">
                ⚠ {draftMatters.evidenceOutstanding.items} evidence request item(s) outstanding on open matters — not
                blocking
              </li>
            )}
          </ul>
          <p className="mb-3 text-sm text-slate-600">
            Finalising makes this review and its Value Positions permanently read-only and records every open Assurance
            matter as it stands. The next review will measure movement against this position.
          </p>
          <ActionForm
            action={finaliseReviewAction}
            confirm={`Finalise Assurance Review #${review.sequence}? It becomes permanently read-only; corrections will require a new review.`}
          >
            <Hidden name="projectId" value={projectId} />
            <Hidden name="reviewId" value={review.id} />
            <SubmitButton
              disabled={ws.missingPositions > 0 || blankForecasts.length > 0 || unexplained.length > 0 || recInReview}
              title={
                recInReview
                  ? "Complete the internal recommendation review first"
                  : ws.missingPositions > 0
                    ? "Save a position for every driver first"
                    : blankForecasts.length > 0
                      ? "Every financial driver needs a forecast or an explicit Not Assessed"
                      : unexplained.length > 0
                        ? "Record why each moved forecast changed"
                        : undefined
              }
            >
              Finalise review
            </SubmitButton>
          </ActionForm>
        </Section>
      )}
    </>
  );
}

type MatterOption = { id: string; code: string; title: string; status: string };

function PositionTable({
  ws,
  currency,
  matters,
  draft,
  base,
}: {
  ws: AssuranceWorkspace;
  currency: string;
  matters: MatterOption[];
  draft: boolean;
  base: string;
}) {
  const money = (v: string | null) => (v === null ? "—" : formatMoneyShort(v, currency));
  return (
    <Table>
      <thead>
        <tr>
          <th>Driver</th>
          <th className="text-right">Authorised</th>
          <th className="text-right">Formal baseline</th>
          <th className="text-right">Current Forecast</th>
          <th className="text-right">Movement</th>
          <th>Why it changed · related matter</th>
          <th className="text-right">Realised</th>
          <th className="text-right">Value Gap</th>
          <th>Qualification</th>
          <th>Evidence</th>
        </tr>
      </thead>
      <tbody>
        {ws.rows.map((r) => {
          const matter = r.valueLeakageId ? matters.find((m) => m.id === r.valueLeakageId) : undefined;
          return (
            <tr key={r.valueDriverId} data-testid="position-row">
              <td>
                <span className="font-mono text-slate-500">{r.code}</span> <span className="font-medium">{r.name}</span>
                {!r.hasPosition && <span className="block text-xs text-red-700">No position saved</span>}
              </td>
              {r.financial ? (
                <>
                  <td className="text-right whitespace-nowrap">{money(r.authorisedValue)}</td>
                  <td className="text-right whitespace-nowrap text-slate-500" data-testid="position-baseline">
                    {money(r.governed.baseline)}
                    <span className="block text-[11px]" data-testid="position-baseline-source">
                      {r.governed.source === "previous_review" ? `Review #${ws.previous!.sequence}` : "authorised"}
                    </span>
                  </td>
                  <td className="text-right font-semibold whitespace-nowrap" data-testid="position-forecast">
                    {r.currentForecast === null ? (
                      <span className="font-normal text-amber-700">
                        {r.forecastNotAssessed ? "Not Assessed (explicit)" : "Blank"}
                      </span>
                    ) : (
                      money(r.currentForecast)
                    )}
                  </td>
                  <td className="text-right whitespace-nowrap" data-testid="position-movement">
                    {change(r.movement, currency)}
                  </td>
                </>
              ) : (
                <td colSpan={4} className="text-center">
                  <NonFinancialBadge /> <span className="text-xs text-slate-500">excluded from financial totals</span>
                </td>
              )}
              <td className="max-w-72 text-xs">
                {r.forecastRationale && (
                  <span className="block text-slate-700" data-testid="position-why">
                    {r.governed.moved
                      ? "Why it moved"
                      : r.forecastNotAssessed
                        ? "Not Assessed"
                        : r.financial
                          ? "Forecast"
                          : "Outlook"}
                    : {r.forecastRationale}
                  </span>
                )}
                {draft && r.governed.rationaleRequired && !hasRationale(r.forecastRationale) && (
                  <span className="block text-red-700" data-testid="position-why-missing">
                    Forecast moved — a reason is required at finalisation
                  </span>
                )}
                {r.financial && !r.governed.moved && !r.forecastRationale && r.currentForecast !== null && (
                  <span className="block text-slate-400" data-testid="position-unchanged">
                    Unchanged from baseline
                  </span>
                )}
                {matter && (
                  <span className="block text-slate-500" data-testid="position-matter">
                    Related matter:{" "}
                    <TextLink href={`${base}/assurance/matters/${matter.id}`}>
                      {matter.code} {matter.title}
                    </TextLink>
                  </span>
                )}
                {r.realisedValueRationale && (
                  <span className="block text-slate-500">Realised: {r.realisedValueRationale}</span>
                )}
              </td>
              {r.financial ? (
                <>
                  <td className="text-right whitespace-nowrap" data-testid="position-realised">
                    {r.realisedValue === null ? (
                      <span className="text-slate-400">Not assessed</span>
                    ) : (
                      money(r.realisedValue)
                    )}
                  </td>
                  <td className="text-right whitespace-nowrap" data-testid="position-gap">
                    {money(r.valueGap)}
                  </td>
                </>
              ) : (
                <td colSpan={2} />
              )}
              <td>
                <QualificationBadge status={r.qualificationStatus} />
              </td>
              <td>
                <EvidenceBadge status={r.evidenceStatus} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

/** Evidence this review formally relies on, and open-matter evidence that can be relied on deliberately. */
function ReviewEvidence({
  projectId,
  base,
  reviewId,
  draft,
  evidence,
  evidenceOptions,
  candidates,
}: {
  projectId: string;
  base: string;
  reviewId: string;
  draft: boolean;
  evidence: AssuranceWorkspace["evidence"];
  evidenceOptions: Awaited<ReturnType<typeof listReviewEvidenceOptions>>;
  candidates: Awaited<ReturnType<typeof listOpenMatterEvidence>>;
}) {
  return (
    <div className="mt-5 border-t border-slate-200 pt-4" id="review-evidence" data-testid="review-evidence">
      <h3 className="mb-2 text-sm font-semibold">Evidence relied on in this review ({evidence.length})</h3>
      {evidence.length === 0 && <p className="text-xs text-slate-500">No evidence linked to this review.</p>}
      <ul className="space-y-1 text-sm">
        {evidence.map((e) => (
          <li key={e.linkId} className="flex items-start justify-between gap-2">
            <span>
              <TextLink href={`${base}/evidence/${e.evidenceId}`}>
                {e.code} {e.title}
              </TextLink>
              {e.isMaterialChange && (
                <>
                  {" "}
                  <PlainBadge tone="red">Material change</PlainBadge>
                </>
              )}
              {e.relevanceNote && <span className="block text-xs text-slate-500">{e.relevanceNote}</span>}
            </span>
            {draft && (
              <ActionForm action={unlinkReviewEvidenceAction} showSuccess={false}>
                <Hidden name="projectId" value={projectId} />
                <Hidden name="evidenceLinkId" value={e.linkId} />
                <SubmitButton variant="danger">Unlink</SubmitButton>
              </ActionForm>
            )}
          </li>
        ))}
      </ul>
      {draft && (
        <div className="mt-3">
          <MatterEvidenceCandidates projectId={projectId} reviewId={reviewId} candidates={candidates} />
          <ActionForm action={linkReviewEvidenceAction} resetOnSuccess testId="review-evidence-form">
            <Hidden name="projectId" value={projectId} />
            <Hidden name="reviewId" value={reviewId} />
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-60 flex-1">
                <SelectField
                  name="evidenceId"
                  label="Link evidence"
                  required
                  placeholder="— Choose evidence —"
                  options={evidenceOptions.map((e) => ({ value: e.id, label: `${e.code} ${e.title}` }))}
                />
              </div>
              <div className="min-w-48 flex-1">
                <TextField name="relevanceNote" label="Relevance" />
              </div>
              <SubmitButton variant="secondary">Link</SubmitButton>
            </div>
          </ActionForm>
          <p className="mt-1 text-xs text-slate-500">
            New evidence is recorded in the <TextLink href={`${base}/evidence`}>Evidence register</TextLink>.
          </p>
        </div>
      )}
    </div>
  );
}

function PositionEditor({
  ws,
  projectId,
  currency,
  matters,
}: {
  ws: AssuranceWorkspace;
  projectId: string;
  currency: string;
  matters: MatterOption[];
}) {
  if (ws.rows.length === 0) return <Empty>The authorised version has no Value Drivers.</Empty>;
  return (
    <div className="mt-5 border-t border-slate-200 pt-4">
      <h3 className="mb-1 text-sm font-semibold">Enter positions</h3>
      <p className="mb-3 text-xs text-slate-500">
        Amounts in {currency} on the project&apos;s Value Basis (4.8m, 4,800,000, negative allowed). Leave blank for
        &quot;not assessed&quot;. Realised Value is cumulative to the review date.
      </p>
      <ActionForm action={saveValuePositionsAction} testId="positions-form">
        <Hidden name="projectId" value={projectId} />
        <Hidden name="reviewId" value={ws.review.id} />
        <Hidden name="driverIds" value={ws.rows.map((r) => r.valueDriverId).join(",")} />
        <div className="space-y-3">
          {ws.rows.map((r) => (
            <fieldset
              key={r.valueDriverId}
              className="rounded border border-slate-200 p-3"
              data-testid={`position-editor-${r.code}`}
            >
              <legend className="px-1 text-sm font-semibold">
                <span className="font-mono text-slate-500">{r.code}</span> {r.name}{" "}
                {r.financial ? (
                  <span className="font-normal text-slate-500">
                    · Authorised {formatMoneyShort(r.authorisedValue, currency)}
                    {ws.previous &&
                      ` · Review #${ws.previous.sequence}: ${r.previousForecast === null ? "not assessed" : formatMoneyShort(r.previousForecast, currency)}`}
                  </span>
                ) : (
                  <NonFinancialBadge />
                )}
              </legend>
              {r.financial ? (
                <FormGrid cols={4}>
                  <TextField
                    name={`forecast__${r.valueDriverId}`}
                    label="Current Forecast"
                    inputMode="decimal"
                    defaultValue={moneyInputValue(r.currentForecast)}
                    placeholder={r.previousForecast ? moneyInputValue(r.previousForecast) : undefined}
                  />
                  <TextArea
                    name={`forecastRationale__${r.valueDriverId}`}
                    label="Why the forecast changed (or why Not Assessed)"
                    rows={1}
                    defaultValue={r.forecastRationale}
                    hint={`Required at finalisation when the forecast differs from its formal baseline: ${
                      r.governed.baseline === null ? "—" : formatMoneyShort(r.governed.baseline, currency)
                    } (${r.governed.source === "previous_review" ? `Review #${ws.previous!.sequence} forecast` : "authorised value"}).`}
                  />
                  <TextField
                    name={`realised__${r.valueDriverId}`}
                    label="Realised Value (cumulative)"
                    inputMode="decimal"
                    defaultValue={moneyInputValue(r.realisedValue)}
                  />
                  <TextArea
                    name={`realisedRationale__${r.valueDriverId}`}
                    label="Realised rationale / sufficiency"
                    rows={1}
                    defaultValue={r.realisedValueRationale}
                  />
                  <div className="sm:col-span-2">
                    <SelectField
                      name={`matter__${r.valueDriverId}`}
                      label="Related Assurance matter (optional)"
                      defaultValue={r.valueLeakageId}
                      placeholder="— None —"
                      options={matters.map((m) => ({
                        value: m.id,
                        label: `${m.code} ${m.title}${m.status === "open" ? "" : " (closed)"}`,
                      }))}
                      hint="If an Assurance matter explains the movement. Value Leakage need not reconcile to the Value Gap."
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <Checkbox
                      name={`notAssessed__${r.valueDriverId}`}
                      label="Not assessed — no forecast possible yet"
                      defaultChecked={r.forecastNotAssessed}
                      hint="Use when a forecast genuinely cannot be assessed yet — leave the forecast blank and give the reason in Forecast rationale. The project forecast will show as Incomplete."
                    />
                  </div>
                </FormGrid>
              ) : (
                <FormGrid>
                  <TextArea
                    name={`forecastRationale__${r.valueDriverId}`}
                    label="Outcome outlook"
                    rows={2}
                    defaultValue={r.forecastRationale}
                  />
                  <TextArea
                    name={`realisedRationale__${r.valueDriverId}`}
                    label="Realised outcome notes"
                    rows={2}
                    defaultValue={r.realisedValueRationale}
                  />
                </FormGrid>
              )}
            </fieldset>
          ))}
          <SubmitButton>Save Value Positions</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}

/**
 * Phase 4D.2: evidence attached to open Assurance matters is working evidence. It becomes review
 * evidence only when the consultant deliberately links it here (the existing formal link); once the
 * review is finalised, the usual formal locking applies.
 */
function MatterEvidenceCandidates({
  projectId,
  reviewId,
  candidates,
}: {
  projectId: string;
  reviewId: string;
  candidates: Awaited<ReturnType<typeof listOpenMatterEvidence>>;
}) {
  const byEvidence = new Map<string, { evidenceId: string; code: string; title: string; matters: string[] }>();
  for (const c of candidates) {
    const e = byEvidence.get(c.evidenceId) ?? { evidenceId: c.evidenceId, code: c.code, title: c.title, matters: [] };
    e.matters.push(c.matterCode);
    byEvidence.set(c.evidenceId, e);
  }
  if (byEvidence.size === 0) return null;
  return (
    <div
      className="rounded border border-dashed border-violet-300 bg-violet-50 p-3"
      data-testid="matter-evidence-candidates"
    >
      <h4 className="text-sm font-semibold text-violet-900">Matter evidence — not relied on by this review</h4>
      <p className="mb-2 text-xs text-violet-800">
        Working evidence linked to open Assurance matters. It is not review evidence unless you link it deliberately.
      </p>
      <ul className="space-y-1 text-sm">
        {[...byEvidence.values()].map((c) => (
          <li
            key={c.evidenceId}
            className="flex items-center justify-between gap-2"
            data-testid="matter-evidence-candidate"
          >
            <span>
              <TextLink href={`/projects/${projectId}/evidence/${c.evidenceId}`}>
                {c.code} {c.title}
              </TextLink>{" "}
              <span className="text-xs text-violet-700">· matter {c.matters.join(", ")}</span>
            </span>
            <ActionForm action={linkReviewEvidenceAction} showSuccess={false}>
              <Hidden name="projectId" value={projectId} />
              <Hidden name="reviewId" value={reviewId} />
              <Hidden name="evidenceId" value={c.evidenceId} />
              <Hidden name="relevanceNote" value={`Supports Assurance matter ${c.matters.join(", ")}`} />
              <SubmitButton variant="secondary">Rely on in this review</SubmitButton>
            </ActionForm>
          </li>
        ))}
      </ul>
    </div>
  );
}
