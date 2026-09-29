import { notFound } from "next/navigation";

import { ASSURANCE_TRIGGERS } from "@/domain/statuses";
import {
  finaliseReviewAction,
  linkReviewEvidenceAction,
  saveValuePositionsAction,
  unlinkReviewEvidenceAction,
  updateReviewAction,
} from "@/server/actions/assurance";
import { getAssuranceWorkspace, listReviewEvidenceOptions, type AssuranceWorkspace } from "@/server/queries/assurance";
import { ActionForm, SubmitButton } from "@/ui/components/action-form";
import { EvidenceBadge, NonFinancialBadge, PlainBadge, QualificationBadge } from "@/ui/components/badges";
import { DateField, FormGrid, Hidden, SelectField, TextArea, TextField } from "@/ui/components/fields";
import { Empty, KeyValues, Section, Table, TextLink } from "@/ui/components/layout";
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

export const metadata = { title: "Assurance Review" };

export default async function AssuranceReviewPage({ params }: PageProps<"/projects/[projectId]/assurance/[reviewId]">) {
  const { projectId, reviewId } = await params;
  const { project } = await requireProject(projectId);
  if (!isUuid(reviewId)) notFound();
  const ws = await getAssuranceWorkspace(projectId, reviewId);
  if (!ws) notFound();
  const evidenceOptions = await listReviewEvidenceOptions(projectId);

  const { review, totals } = ws;
  const currency = project.currency;
  const draft = review.status === "draft";
  const base = `/projects/${projectId}`;
  const priorLabel = ws.previous
    ? `Review #${ws.previous.sequence} (${formatDate(ws.previous.reviewDate)})`
    : `Authorised Value V${ws.againstVersion.versionNumber} — first review`;
  const forecast = forecastHeadline(totals, currency);
  const realised = realisedHeadline(totals, currency);
  const financialWithoutForecast = totals.financialDriverCount - totals.forecastAssessed;

  return (
    <>
      <p className="mb-3 text-sm">
        <TextLink href={`${base}/assurance`}>← Value Assurance</TextLink>
      </p>

      {/* ---- Review header ---------------------------------------------------------- */}
      <div
        className={`mb-6 rounded-lg border-2 px-4 py-3 ${draft ? "border-amber-300 bg-amber-50" : "border-emerald-400 bg-emerald-50"}`}
        data-testid="review-state"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Assurance Review #{review.sequence}</h2>
          <ReviewStatusBadge status={review.status} />
        </div>
        <p className="text-sm">
          {draft
            ? "Draft — enter the current Value Position for every driver, then finalise."
            : `Finalised ${formatDateTime(review.finalisedAt)} by ${ws.finalisedBy?.name ?? "—"} — read-only. Corrections require a new review.`}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Review">
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
          {draft && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <ActionForm action={updateReviewAction}>
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
            </div>
          )}
        </Section>

        <Section title="What changed?" description="Since the previous value position.">
          {draft ? (
            <ActionForm action={updateReviewAction} testId="what-changed-form">
              <Hidden name="projectId" value={projectId} />
              <Hidden name="reviewId" value={review.id} />
              <TextArea name="whatChanged" label="Consultant narrative" rows={5} defaultValue={review.whatChanged} />
              <div className="mt-2">
                <SubmitButton variant="secondary">Save</SubmitButton>
              </div>
            </ActionForm>
          ) : (
            <p className="text-sm whitespace-pre-wrap" data-testid="what-changed">
              {review.whatChanged ?? "—"}
            </p>
          )}
          <h3 className="mt-4 mb-2 text-sm font-semibold">Relevant evidence ({ws.evidence.length})</h3>
          {ws.evidence.length === 0 && <p className="text-xs text-slate-500">No evidence linked to this review.</p>}
          <ul className="space-y-1 text-sm">
            {ws.evidence.map((e) => (
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
              <ActionForm action={linkReviewEvidenceAction} resetOnSuccess testId="review-evidence-form">
                <Hidden name="projectId" value={projectId} />
                <Hidden name="reviewId" value={review.id} />
                <div className="flex flex-wrap items-end gap-2">
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
        </Section>
      </div>

      {/* ---- Value Position ------------------------------------------------------------ */}
      <Section
        title="Value Position"
        description={`Per Value Driver. Movement is Current Forecast − ${ws.previous ? `Review #${ws.previous.sequence} forecast` : "Authorised Value (first review)"}; Value Gap is Authorised Value − Current Forecast.`}
      >
        <PositionTable ws={ws} currency={currency} />
        {draft && <PositionEditor ws={ws} projectId={projectId} currency={currency} />}
      </Section>

      {/* ---- Summary ------------------------------------------------------------------- */}
      <Section title="Summary" description="Financial drivers only; non-financial drivers are excluded from totals.">
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
          <Figure label="Realised Value" value={realised.value} note={realised.note} testId="review-realised" />
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
      </Section>

      <Section title="Why it matters" description="The economic significance of this position.">
        {draft ? (
          <ActionForm action={updateReviewAction} testId="why-it-matters-form">
            <Hidden name="projectId" value={projectId} />
            <Hidden name="reviewId" value={review.id} />
            <div className="space-y-3">
              <TextArea name="whyItMatters" label="Why it matters" rows={4} defaultValue={review.whyItMatters} />
              <TextArea name="summary" label="Review summary" rows={3} defaultValue={review.summary} />
              <SubmitButton variant="secondary">Save</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="whitespace-pre-wrap" data-testid="why-it-matters">
              {review.whyItMatters ?? "—"}
            </p>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase">Summary</p>
              <p className="whitespace-pre-wrap" data-testid="review-summary-text">
                {review.summary ?? "—"}
              </p>
            </div>
          </div>
        )}
      </Section>

      {draft && (
        <Section id="finalise" title="Finalise review" tone="muted">
          <ul className="mb-3 space-y-1 text-sm" data-testid="finalise-checklist">
            <li className={ws.missingPositions === 0 ? "text-emerald-800" : "text-red-700"}>
              {ws.missingPositions === 0
                ? "✓ Every Value Driver has a Value Position"
                : `✗ ${ws.missingPositions} Value Driver(s) have no saved position — required`}
            </li>
            <li className={financialWithoutForecast === 0 ? "text-emerald-800" : "text-amber-800"}>
              {financialWithoutForecast === 0
                ? "✓ Every financial driver has a Current Forecast"
                : `⚠ ${financialWithoutForecast} financial driver(s) have no Current Forecast — totals will show as incomplete`}
            </li>
            <li className={review.whatChanged ? "text-emerald-800" : "text-amber-800"}>
              {review.whatChanged ? "✓ What changed recorded" : "⚠ What changed not recorded"}
            </li>
            <li className={review.whyItMatters ? "text-emerald-800" : "text-amber-800"}>
              {review.whyItMatters ? "✓ Why it matters recorded" : "⚠ Why it matters not recorded"}
            </li>
          </ul>
          <p className="mb-3 text-sm text-slate-600">
            Finalising makes this review and its Value Positions permanently read-only. The next review will measure
            movement against this position.
          </p>
          <ActionForm
            action={finaliseReviewAction}
            confirm={`Finalise Assurance Review #${review.sequence}? It becomes permanently read-only; corrections will require a new review.`}
          >
            <Hidden name="projectId" value={projectId} />
            <Hidden name="reviewId" value={review.id} />
            <SubmitButton
              disabled={ws.missingPositions > 0}
              title={ws.missingPositions > 0 ? "Save a position for every driver first" : undefined}
            >
              Finalise review
            </SubmitButton>
          </ActionForm>
        </Section>
      )}
    </>
  );
}

function PositionTable({ ws, currency }: { ws: AssuranceWorkspace; currency: string }) {
  const money = (v: string | null) => (v === null ? "—" : formatMoneyShort(v, currency));
  return (
    <Table>
      <thead>
        <tr>
          <th>Driver</th>
          <th className="text-right">Authorised</th>
          <th className="text-right">
            {ws.previous ? `Review #${ws.previous.sequence} forecast` : "Previous position"}
          </th>
          <th className="text-right">Current Forecast</th>
          <th className="text-right">Movement</th>
          <th className="text-right">Realised</th>
          <th className="text-right">Value Gap</th>
          <th>Qualification</th>
          <th>Evidence</th>
        </tr>
      </thead>
      <tbody>
        {ws.rows.map((r) => (
          <tr key={r.valueDriverId} data-testid="position-row">
            <td>
              <span className="font-mono text-slate-500">{r.code}</span> <span className="font-medium">{r.name}</span>
              {!r.hasPosition && <span className="block text-xs text-red-700">No position saved</span>}
              {r.forecastRationale && (
                <span className="block text-xs text-slate-500">Forecast: {r.forecastRationale}</span>
              )}
              {r.realisedValueRationale && (
                <span className="block text-xs text-slate-500">Realised: {r.realisedValueRationale}</span>
              )}
            </td>
            {r.financial ? (
              <>
                <td className="text-right whitespace-nowrap">{money(r.authorisedValue)}</td>
                <td className="text-right whitespace-nowrap text-slate-500" data-testid="position-previous">
                  {money(r.previousForecast)}
                </td>
                <td className="text-right font-semibold whitespace-nowrap" data-testid="position-forecast">
                  {r.currentForecast === null ? (
                    <span className="font-normal text-amber-700">Not assessed</span>
                  ) : (
                    money(r.currentForecast)
                  )}
                </td>
                <td className="text-right whitespace-nowrap" data-testid="position-movement">
                  {change(r.movement, currency)}
                </td>
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
              <td colSpan={6} className="text-center">
                <NonFinancialBadge /> <span className="text-xs text-slate-500">excluded from financial totals</span>
              </td>
            )}
            <td>
              <QualificationBadge status={r.qualificationStatus} />
            </td>
            <td>
              <EvidenceBadge status={r.evidenceStatus} />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function PositionEditor({ ws, projectId, currency }: { ws: AssuranceWorkspace; projectId: string; currency: string }) {
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
                    label="Forecast rationale"
                    rows={1}
                    defaultValue={r.forecastRationale}
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
