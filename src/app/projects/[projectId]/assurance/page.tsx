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
  GapVsLeakage,
  headline,
  NOT_ASSESSED,
  realisedHeadline,
  RequirementBadge,
  ReviewStatusBadge,
} from "@/ui/assurance/display";
import { listDriverOptions } from "@/server/queries/information-request";
import { listStakeholders } from "@/server/queries/mobilise";
import { getContinuousAssuranceWorkspace } from "@/server/queries/workspace";
import { ContinuousAssurance, parseMatterFilter } from "@/ui/assurance/matters";
import { GovernedPosition, WorkingPicture } from "@/ui/assurance/picture";
import { GovernedTag } from "@/ui/components/badges";
import { formatDate } from "@/ui/format";
import { TRIGGER_LABELS } from "@/ui/labels";
import { requireProject } from "@/ui/require";

export const metadata = { title: "Value Assurance" };

const today = () => new Date().toISOString().slice(0, 10);

export default async function AssurancePage({ params, searchParams }: PageProps<"/projects/[projectId]/assurance">) {
  const { projectId } = await params;
  const query = await searchParams;
  const filter = parseMatterFilter(query.stage);
  const { project } = await requireProject(projectId);
  const [summary, cadence, evidence, workspace, stakeholders, drivers] = await Promise.all([
    getValuePositionSummary(projectId),
    getNextAssuranceRequirement(projectId),
    listReviewEvidenceOptions(projectId),
    getContinuousAssuranceWorkspace(projectId),
    listStakeholders(projectId),
    listDriverOptions(projectId),
  ]);
  const currency = project.currency;
  const base = `/projects/${projectId}`;

  if (!summary.authorised) {
    return (
      <Notice tone="info" title="Value Assurance begins once the Value Case is authorised">
        Record the VCO&apos;s authorisation of V1 in{" "}
        <TextLink href={`${base}/requalification`}>Value Case Definition</TextLink>.
      </Notice>
    );
  }

  const latest = summary.latest;
  const draft = summary.reviews.find((r) => r.review.status === "draft");
  const materialFirst = [...evidence].sort((a, b) => Number(b.isMaterialChange) - Number(a.isMaterialChange));

  return (
    <>
      {/* ---- Current position (governed) --------------------------------------------- */}
      <section aria-labelledby="position-heading" className="mb-6" data-testid="assurance-current">
        <h2 id="position-heading" className="mb-2 text-base font-semibold text-slate-900">
          Current position
        </h2>
        <div className="grid gap-3" data-testid="assurance-headline">
          <GovernedPosition
            authorisedVersion={summary.authorised.versionNumber}
            authorisedTotal={summary.authorisedTotal}
            totals={latest?.totals ?? null}
            reviewSequence={latest?.review.sequence ?? null}
            againstVersion={latest?.againstVersionNumber ?? null}
            currency={currency}
            prefix="assurance"
          />
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <p className="rounded border border-slate-200 bg-white px-3 py-2" data-testid="current-latest">
              <span className="block text-xs text-slate-500">Latest formal position</span>
              {latest ? (
                <TextLink href={`${base}/assurance/${latest.review.id}`}>
                  Review #{latest.review.sequence} · {formatDate(latest.review.reviewDate)}
                </TextLink>
              ) : (
                <span className="text-slate-700">No formal review yet — only the Authorised Value is known</span>
              )}
              {draft && (
                <span className="block text-xs text-slate-500">
                  Review #{draft.review.sequence} is in draft (working, not yet formal)
                </span>
              )}
            </p>
            <p className="rounded border border-slate-200 bg-white px-3 py-2" data-testid="current-next-requirement">
              <span className="block text-xs text-slate-500">Next formal Assurance requirement</span>
              {cadence.next ? (
                <a href="#requirements" className="inline-flex flex-wrap items-center gap-2 text-sky-800 underline">
                  {cadence.next.label} <RequirementBadge status={cadence.next.status} />
                  {cadence.next.date && <span>{formatDate(cadence.next.date)}</span>}
                </a>
              ) : (
                <span className="text-slate-700">None derivable from current data</span>
              )}
            </p>
          </div>
          <GapVsLeakage />
        </div>
      </section>

      {/* ---- Active Assurance (working) ---------------------------------------------- */}
      <h2 className="sr-only">Active Assurance</h2>
      <div className="mb-4">
        <WorkingPicture workspace={workspace} currency={currency} />
      </div>
      <ContinuousAssurance
        projectId={projectId}
        currency={currency}
        workspace={workspace}
        filter={filter}
        stakeholders={stakeholders.map((s) => ({ value: s.personId, label: s.name }))}
        drivers={drivers}
        raiseOpen={query.raise === "1"}
      />

      <section
        id="formal"
        aria-labelledby="formal-heading"
        className="rounded-lg border border-slate-300 bg-slate-50/50 p-4"
        data-testid="formal-assurance"
      >
        <h2 id="formal-heading" className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900">
          Formal Assurance Reviews <GovernedTag>Point in time</GovernedTag>
        </h2>
        <p className="mt-0.5 mb-4 max-w-3xl text-sm text-slate-600">
          Governed snapshots and recommitment points. Open matters are recorded in a review when it is finalised;
          Continuous Assurance stays live between reviews.
        </p>

        <Section
          title="Latest formal position"
          description={
            latest ? (
              <>
                <TextLink href={`${base}/assurance/${latest.review.id}`}>
                  Review #{latest.review.sequence} · {formatDate(latest.review.reviewDate)}
                </TextLink>{" "}
                · {TRIGGER_LABELS[latest.review.trigger]} · measured against Authorised V{latest.againstVersionNumber}
              </>
            ) : (
              "No finalised Assurance Review yet — only the Authorised Value is known."
            )
          }
        >
          <div className="grid gap-3 sm:grid-cols-3" data-testid="formal-latest">
            <Figure
              label="Latest formal Current Forecast"
              value={latest ? forecastHeadline(latest.totals, currency).value : NOT_ASSESSED}
              note={latest ? `As at ${formatDate(latest.review.reviewDate)}` : undefined}
              testId="formal-forecast"
            />
            <Figure
              label="Latest formal Value Gap"
              value={latest ? headline(latest.totals.valueGap, currency, "Incomplete") : NOT_ASSESSED}
              note="Authorised − Current Forecast"
              testId="formal-gap"
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
          {draft && (
            <p className="mt-3 text-sm" data-testid="draft-review">
              <span className="text-slate-500">Draft in progress: </span>
              <TextLink href={`${base}/assurance/${draft.review.id}`}>
                Review #{draft.review.sequence} · {formatDate(draft.review.reviewDate)}
              </TextLink>
            </p>
          )}
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
              <p className="mb-3 text-sm text-slate-600">
                No outstanding requirement can be derived from current data.
              </p>
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
                  <fieldset className="space-y-2" data-testid="create-review-reasoning">
                    <legend className="text-sm font-medium text-slate-700">
                      The review records what changed and why it matters (both can be completed in the review)
                    </legend>
                    <TextArea name="whatChanged" label="What changed?" rows={2} />
                    <TextArea name="whyItMatters" label="Why does it matter?" rows={2} />
                  </fieldset>
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
                      <Link
                        href={`${base}/assurance/${review.id}`}
                        className="font-medium text-sky-800 hover:underline"
                      >
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
      </section>
    </>
  );
}
