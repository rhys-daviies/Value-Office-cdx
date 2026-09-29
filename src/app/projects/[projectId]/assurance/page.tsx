import Link from "next/link";

import { ASSURANCE_TRIGGERS } from "@/domain/statuses";
import { createReviewAction } from "@/server/actions/assurance";
import {
  getNextAssuranceRequirement,
  getValuePositionSummary,
  listReviewEvidenceOptions,
} from "@/server/queries/assurance";
import { ActionForm, SubmitButton } from "@/ui/components/action-form";
import { DateField, FormGrid, Hidden, SelectField, TextArea } from "@/ui/components/fields";
import { Empty, Notice, Section, Table, TextLink } from "@/ui/components/layout";
import {
  change,
  Figure,
  forecastHeadline,
  headline,
  NOT_ASSESSED,
  realisedHeadline,
  RequirementBadge,
  ReviewStatusBadge,
} from "@/ui/assurance/display";
import { formatDate, formatMoneyShort } from "@/ui/format";
import { TRIGGER_LABELS } from "@/ui/labels";
import { requireProject } from "@/ui/require";

export const metadata = { title: "Value Assurance" };

const today = () => new Date().toISOString().slice(0, 10);

export default async function AssurancePage({ params }: PageProps<"/projects/[projectId]/assurance">) {
  const { projectId } = await params;
  const { project } = await requireProject(projectId);
  const [summary, cadence, evidence] = await Promise.all([
    getValuePositionSummary(projectId),
    getNextAssuranceRequirement(projectId),
    listReviewEvidenceOptions(projectId),
  ]);
  const currency = project.currency;
  const base = `/projects/${projectId}`;

  if (!summary.authorised) {
    return (
      <Notice tone="info" title="Value Assurance begins once the Value Case is authorised">
        Record the VCO&apos;s authorisation of V1 in{" "}
        <TextLink href={`${base}/requalification`}>Re-Qualification</TextLink>.
      </Notice>
    );
  }

  const latest = summary.latest;
  const draft = summary.reviews.find((r) => r.review.status === "draft");
  const forecast = latest
    ? forecastHeadline(latest.totals, currency)
    : { value: NOT_ASSESSED, note: "No finalised review yet" };
  const realised = latest
    ? realisedHeadline(latest.totals, currency)
    : { value: NOT_ASSESSED, note: "No finalised review yet" };
  const materialFirst = [...evidence].sort((a, b) => Number(b.isMaterialChange) - Number(a.isMaterialChange));

  return (
    <>
      <p className="mb-4 max-w-3xl text-sm text-slate-600">
        What has changed since the previous value position, why does it matter economically, and where does the project
        now stand? Forecasts and realised values are recorded in dated reviews — the Authorised Value Case is never
        altered.
      </p>

      <Section
        title="Value position"
        description={
          latest ? (
            <>
              Latest finalised position:{" "}
              <TextLink href={`${base}/assurance/${latest.review.id}`}>
                Review #{latest.review.sequence} · {formatDate(latest.review.reviewDate)}
              </TextLink>{" "}
              · measured against Authorised V{latest.againstVersionNumber}
            </>
          ) : (
            "No finalised Assurance Review yet — only the Authorised Value is known."
          )
        }
      >
        <div className="grid gap-3 sm:grid-cols-5" data-testid="assurance-headline">
          <Figure
            label={`Authorised Value (V${summary.authorised.versionNumber})`}
            value={formatMoneyShort(summary.authorisedTotal, currency)}
            testId="assurance-authorised"
          />
          <Figure
            label="Current Forecast"
            value={forecast.value}
            note={forecast.note}
            testId="assurance-forecast"
            emphasis
          />
          <Figure label="Realised Value" value={realised.value} note={realised.note} testId="assurance-realised" />
          <Figure
            label="Value Gap"
            value={latest ? headline(latest.totals.valueGap, currency, "Incomplete") : NOT_ASSESSED}
            note="Authorised − Current Forecast"
            testId="assurance-gap"
          />
          <Figure
            label="Movement since previous position"
            value={latest ? change(latest.totals.movement, currency, "Incomplete") : NOT_ASSESSED}
            note={
              latest
                ? latest.review.previousReviewId
                  ? "vs previous finalised review"
                  : "vs Authorised Value (first review)"
                : undefined
            }
            testId="assurance-movement"
          />
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          id="requirements"
          title="Next assurance requirement"
          description="Derived from key dates, review history and material-change evidence. Nothing is scheduled automatically."
        >
          {cadence.next ? (
            <div
              className="mb-3 rounded border border-slate-300 bg-slate-50 p-3 text-sm"
              data-testid="next-requirement"
            >
              <p className="flex items-center gap-2 font-semibold">
                {cadence.next.label} <RequirementBadge status={cadence.next.status} />
                {cadence.next.date && <span className="font-normal">{formatDate(cadence.next.date)}</span>}
              </p>
              <p className="text-xs text-slate-500">{cadence.next.basis}</p>
            </div>
          ) : (
            <p className="mb-3 text-sm text-slate-600">No outstanding requirement can be derived from current data.</p>
          )}
          <Table>
            <tbody>
              {cadence.requirements.map((r) => (
                <tr key={r.trigger} data-testid={`requirement-${r.trigger}`}>
                  <td className="font-medium">{r.label}</td>
                  <td>
                    <RequirementBadge status={r.status} />
                  </td>
                  <td className="whitespace-nowrap">{formatDate(r.date)}</td>
                  <td className="text-xs text-slate-500">
                    {r.basis}
                    {r.evidence && (
                      <span className="mt-1 block">
                        {r.evidence.map((e) => (
                          <Link key={e.id} href={`${base}/evidence/${e.id}`} className="mr-2 text-sky-800 underline">
                            {e.code} {e.title}
                          </Link>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>

        <Section title="Create Assurance Review">
          {draft ? (
            <Notice tone="warning" title={`Review #${draft.review.sequence} is still a draft`}>
              Finalise it before opening another.{" "}
              <TextLink href={`${base}/assurance/${draft.review.id}`}>Open draft review</TextLink>
            </Notice>
          ) : (
            <ActionForm action={createReviewAction} testId="create-review-form">
              <Hidden name="projectId" value={projectId} />
              <div className="space-y-3">
                <FormGrid>
                  <SelectField
                    name="trigger"
                    label="Why is this review happening?"
                    required
                    defaultValue={cadence.next?.status === "due" ? cadence.next.trigger : "ad_hoc"}
                    options={ASSURANCE_TRIGGERS.map((t) => ({ value: t, label: TRIGGER_LABELS[t] }))}
                  />
                  <DateField name="reviewDate" label="Review date" required defaultValue={today()} />
                </FormGrid>
                <SelectField
                  name="triggerEvidenceId"
                  label="Triggering evidence (optional)"
                  placeholder="— None —"
                  options={materialFirst.map((e) => ({
                    value: e.id,
                    label: `${e.code} ${e.title}${e.isMaterialChange ? " · material change" : ""}`,
                  }))}
                />
                <TextArea name="whatChanged" label="What changed? (can be completed in the review)" rows={2} />
                <p className="text-xs text-slate-500">
                  Measured against Authorised V{summary.authorised.versionNumber}
                  {latest
                    ? `; movement compared with Review #${latest.review.sequence}`
                    : "; first review — movement compared with Authorised Value"}
                  .
                </p>
                <SubmitButton>Open review</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Section>
      </div>

      <Section title="Review history">
        {summary.reviews.length === 0 ? (
          <Empty>No Assurance Reviews yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Review</th>
                <th>Date</th>
                <th>Trigger</th>
                <th>Against</th>
                <th className="text-right">Forecast</th>
                <th className="text-right">Realised</th>
                <th className="text-right">Value Gap</th>
                <th className="text-right">Movement</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {[...summary.reviews].reverse().map(({ review, againstVersionNumber, totals }) => (
                <tr key={review.id} data-testid="review-row">
                  <td>
                    <Link href={`${base}/assurance/${review.id}`} className="font-medium text-sky-800 hover:underline">
                      #{review.sequence}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap">{formatDate(review.reviewDate)}</td>
                  <td>{TRIGGER_LABELS[review.trigger]}</td>
                  <td>V{againstVersionNumber}</td>
                  <td className="text-right whitespace-nowrap">{forecastHeadline(totals, currency).value}</td>
                  <td className="text-right whitespace-nowrap">{realisedHeadline(totals, currency).value}</td>
                  <td className="text-right whitespace-nowrap">{headline(totals.valueGap, currency, "—")}</td>
                  <td className="text-right whitespace-nowrap">{change(totals.movement, currency)}</td>
                  <td>
                    <ReviewStatusBadge status={review.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </>
  );
}
