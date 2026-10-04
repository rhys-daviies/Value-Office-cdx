import { SCENARIO_KINDS } from "@/domain/statuses";
import {
  assessLeakageAction,
  createLeakageAction,
  issueRecommendationAction,
  recordDecisionAction,
  removeScenarioAction,
  saveRecommendationAction,
  updateLeakageAction,
  upsertScenarioAction,
} from "@/server/actions/response";
import { createValueChangeAction } from "@/server/actions/value-change";
import { listValueChanges, nextChangeCode, type ReviewResponse as Response } from "@/server/queries/response";
import type { WorkspaceMatter } from "@/server/queries/workspace";

import { ActionForm, SubmitButton } from "../components/action-form";
import { PlainBadge } from "../components/badges";
import { DateField, FormGrid, Hidden, MoneyField, SelectField, TextArea, TextField } from "../components/fields";
import { Empty, Expander, KeyValues, Notice, Section, Table, TextLink } from "../components/layout";
import { formatDate, formatDateTime, formatMoneyChange, formatMoneyShort, moneyInputValue } from "../format";
import { ASSURANCE_STAGE_LABELS, scenarioKindLabel } from "../labels";
import { GapVsLeakage } from "./display";

type Option = { value: string; label: string };
type Driver = { driverId: string; code: string; name: string };

const money = (v: string | null, c: string) => (v === null ? "—" : formatMoneyShort(v, c));
const delta = (v: string | null, c: string) => (v === null ? "—" : formatMoneyChange(v, c));

function DriverChecklist({ drivers, selected }: { drivers: Driver[]; selected?: string[] }) {
  return (
    <fieldset className="text-sm">
      <legend className="font-medium text-slate-700">Affected Value Drivers</legend>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {drivers.map((d) => (
          <label key={d.driverId} className="inline-flex items-center gap-1">
            <input
              type="checkbox"
              name="driverIds"
              value={d.driverId}
              defaultChecked={selected?.includes(d.driverId)}
            />
            <span className="font-mono text-xs text-slate-500">{d.code}</span> {d.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

type Base = {
  projectId: string;
  currency: string;
  review: { id: string; sequence: number; status: "draft" | "finalised" };
  response: Response;
};

function state({ review, response }: Base) {
  const draft = review.status === "draft";
  const issued = Boolean(response.recommendation?.issuedAt);
  return { draft, issued, optionsEditable: draft && !issued };
}

/** D. Risks / Value Leakage: the review's Assurance matters with their evidence and remediation (Phase 4D.10F). */
export function LeakageSection({
  projectId,
  currency,
  review,
  response,
  stakeholders,
  drivers,
  living,
  reviewEvidence,
}: Base & {
  stakeholders: Option[];
  drivers: Driver[];
  /** Draft reviews: the living matter's evidence and request status from Continuous Assurance. */
  living?: Map<string, WorkspaceMatter>;
  /** The review's own formal evidence, shown with the matters it supports. */
  reviewEvidence?: React.ReactNode;
}) {
  const { draft } = state({ projectId, currency, review, response });
  const { leakage, leakageBasis, leakageSummary } = response;
  const base = `/projects/${projectId}`;
  return (
    <>
      <Section
        id="leakage"
        title="Risks / Value Leakage"
        testId="review-matters"
        description="The Assurance matters this review considers: the risk, its evidence, the Value Leakage assessed in this review and the remediation being managed. Recoverable = Total − Unrecoverable; value is treated as recoverable until evidence shows it is lost."
      >
        <GapVsLeakage className="mb-3" />
        <div className="mb-4 grid gap-3 text-sm sm:grid-cols-4" data-testid="leakage-summary">
          <Stat
            label="Open items"
            value={String(leakage.filter((l) => l.leakage.status === "open").length)}
            note={`${leakageSummary.assessedCount} assessed in this review`}
          />
          <Stat label="Total VL" value={money(leakageSummary.total, currency)} testId="leakage-total" />
          <Stat
            label="Recoverable VL"
            value={money(leakageSummary.recoverable, currency)}
            testId="leakage-recoverable"
          />
          <Stat
            label="Unrecoverable VL"
            value={money(leakageSummary.unrecoverable, currency)}
            testId="leakage-unrecoverable"
          />
        </div>

        {leakageBasis === "snapshot" && (
          <Notice tone="locked" title="As recorded at finalisation">
            These Assurance matters are shown as this review&apos;s snapshot recorded them. Later changes to the living
            matters appear only in Continuous Assurance and in later reviews.
          </Notice>
        )}
        {leakage.length === 0 && <Empty>No Value Leakage identified.</Empty>}
        <div className="space-y-2">
          {leakage.map((l) => {
            const a = l.thisReview;
            return (
              <Expander
                key={l.leakage.id}
                id={`matter-${l.leakage.code}`}
                testId={`leakage-${l.leakage.code}`}
                summary={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span className="font-mono text-slate-500">{l.leakage.code}</span>
                    <span className="font-semibold">{l.leakage.title}</span>
                    <PlainBadge tone={l.leakage.status === "open" ? "amber" : "slate"}>{l.leakage.status}</PlainBadge>
                    {l.leakage.status === "open" && l.leakage.stage && (
                      <PlainBadge tone="sky">{ASSURANCE_STAGE_LABELS[l.leakage.stage]}</PlainBadge>
                    )}
                    {a?.amounts ? (
                      <span className="text-xs font-normal" data-testid="leakage-amounts">
                        Total {money(a.amounts.total, currency)} · Recoverable {money(a.amounts.recoverable, currency)}{" "}
                        · Unrecoverable {money(a.amounts.unrecoverable, currency)}
                      </span>
                    ) : (
                      <span className="text-xs font-normal text-amber-700" data-testid="leakage-amounts">
                        Not yet quantified in this review
                      </span>
                    )}
                    <span className="text-xs font-normal text-slate-500">
                      Risk / Leakage Owner {l.ownerName ?? "—"} ·{" "}
                      {l.drivers.length ? l.drivers.map((d) => d.code).join(", ") : "no drivers linked"}
                    </span>
                  </span>
                }
              >
                <MatterResponse
                  entry={l}
                  living={draft ? living?.get(l.leakage.id) : undefined}
                  currency={currency}
                  reviewSequence={review.sequence}
                />
                <KeyValues
                  items={[
                    [
                      "Description",
                      <span key="d" className="whitespace-pre-wrap" data-testid="leakage-description">
                        {l.leakage.description ?? "—"}
                      </span>,
                    ],
                    ["Risk / Leakage Owner", l.ownerName ?? "—"],
                    ["Affected drivers", l.drivers.map((d) => d.code).join(", ") || "—"],
                    ["Required decision date", formatDate(l.leakage.requiredDecisionDate)],
                    ["Consultant assessment", l.leakage.consultantAssessment ?? "—"],
                    [
                      "Identified in",
                      l.identifiedInSequence !== null
                        ? `Review #${l.identifiedInSequence}`
                        : `Continuous Assurance, ${formatDate(l.leakage.identifiedOn)}`,
                    ],
                    [
                      "Assurance matter",
                      <TextLink key="m" href={`${base}/assurance/matters/${l.leakage.id}`}>
                        Open {l.leakage.code} in Continuous Assurance
                      </TextLink>,
                    ],
                    [
                      "Unrecoverable rationale",
                      a?.unrecoverableRationale
                        ? `${a.unrecoverableRationale} (validated ${formatDateTime(a.assessedAt)})`
                        : "—",
                    ],
                    [
                      "Assessment history",
                      l.assessments.length === 0
                        ? "None"
                        : l.assessments
                            .map((x) =>
                              x.totalAmount === null
                                ? `#${x.reviewSequence}: not yet quantified`
                                : `#${x.reviewSequence}: ${money(x.totalAmount, currency)} total, ${money(x.unrecoverableAmount, currency)} unrecoverable`,
                            )
                            .join(" · "),
                    ],
                  ]}
                />
                {draft && (
                  <div className="mt-4 grid gap-4 border-t border-slate-100 pt-3 lg:grid-cols-2">
                    <ActionForm action={assessLeakageAction} testId={`assess-${l.leakage.code}`}>
                      <Hidden name="projectId" value={projectId} />
                      <Hidden name="reviewId" value={review.id} />
                      <Hidden name="leakageId" value={l.leakage.id} />
                      <h4 className="mb-2 text-sm font-semibold">Assess in Review #{review.sequence}</h4>
                      <div className="space-y-2">
                        <FormGrid>
                          <MoneyField
                            name="totalAmount"
                            label="Total VL"
                            required
                            currency={currency}
                            defaultValue={moneyInputValue(a?.totalAmount)}
                            hint="Total potential value affected (≥ 0)"
                          />
                          <MoneyField
                            name="unrecoverableAmount"
                            label="Unrecoverable VL"
                            currency={currency}
                            defaultValue={moneyInputValue(a?.unrecoverableAmount ?? "0")}
                            hint="Only where evidence shows the value is lost. Default 0 (recoverable)."
                          />
                        </FormGrid>
                        <TextArea
                          name="unrecoverableRationale"
                          label="Evidence of loss (required if unrecoverable > 0)"
                          rows={2}
                          defaultValue={a?.unrecoverableRationale}
                        />
                        <TextArea
                          name="assessmentNote"
                          label="Assessment note"
                          rows={2}
                          defaultValue={a?.assessmentNote}
                        />
                        <p className="text-xs text-slate-500">You validate any unrecoverable amount by saving.</p>
                        <SubmitButton variant="secondary">Save assessment</SubmitButton>
                      </div>
                    </ActionForm>
                    <ActionForm action={updateLeakageAction}>
                      <Hidden name="projectId" value={projectId} />
                      <Hidden name="leakageId" value={l.leakage.id} />
                      <h4 className="mb-2 text-sm font-semibold">Details</h4>
                      <div className="space-y-2">
                        <TextField name="title" label="Issue" required defaultValue={l.leakage.title} />
                        <TextArea
                          name="description"
                          label="Description"
                          rows={2}
                          defaultValue={l.leakage.description}
                        />
                        <FormGrid>
                          <SelectField
                            name="responseOwnerPersonId"
                            label="Risk / Leakage Owner"
                            defaultValue={l.leakage.responseOwnerPersonId}
                            placeholder="—"
                            options={stakeholders}
                          />
                          <DateField
                            name="requiredDecisionDate"
                            label="Required decision date"
                            defaultValue={l.leakage.requiredDecisionDate}
                          />
                        </FormGrid>
                        <TextArea
                          name="consultantAssessment"
                          label="Consultant assessment"
                          rows={2}
                          defaultValue={l.leakage.consultantAssessment}
                        />
                        <DriverChecklist drivers={drivers} selected={l.drivers.map((d) => d.valueDriverId)} />
                        <SubmitButton variant="secondary">Save details</SubmitButton>
                      </div>
                    </ActionForm>
                  </div>
                )}
              </Expander>
            );
          })}
          {draft && (
            <Expander summary="Identify Value Leakage" testId="add-leakage">
              <ActionForm action={createLeakageAction} resetOnSuccess testId="add-leakage-form">
                <Hidden name="projectId" value={projectId} />
                <Hidden name="reviewId" value={review.id} />
                <div className="space-y-2">
                  <FormGrid cols={3}>
                    <TextField
                      name="code"
                      label="Code"
                      required
                      defaultValue={nextLeakageCode(leakage.map((l) => l.leakage.code))}
                    />
                    <TextField name="title" label="Issue" required />
                    <SelectField
                      name="responseOwnerPersonId"
                      label="Risk / Leakage Owner"
                      placeholder="—"
                      options={stakeholders}
                    />
                  </FormGrid>
                  <TextArea name="description" label="Description" rows={2} />
                  <FormGrid>
                    <DateField name="requiredDecisionDate" label="Required decision date" />
                    <TextField name="consultantAssessment" label="Consultant assessment" />
                  </FormGrid>
                  <DriverChecklist drivers={drivers} />
                  <p className="text-xs text-slate-500">Size it with an assessment after adding.</p>
                  <SubmitButton>Add leakage item</SubmitButton>
                </div>
              </ActionForm>
            </Expander>
          )}
        </div>
        {reviewEvidence}
      </Section>
    </>
  );
}

/** F. Management options (presentation only; economics and the issue freeze are unchanged). */
export function OptionsSection({
  projectId,
  currency,
  review,
  response,
  currentForecastTotal,
  optionPaths,
}: Base & {
  currentForecastTotal: string | null;
  /** Phase 4D.9D: each option's dated value milestones, placed with the options. */
  optionPaths?: React.ReactNode;
}) {
  const { draft, issued, optionsEditable } = state({ projectId, currency, review, response });
  const { scenarios, recommendation, decision } = response;
  return (
    <>
      <Section
        id="options"
        title="Options / alternative outcomes"
        description="Consultant-entered projected totals for each option. Differences are calculated; the values themselves are never derived."
      >
        {issued && <Notice tone="locked">Options are frozen: Cardaxia&apos;s recommendation has been issued.</Notice>}
        {scenarios.length === 0 ? (
          <Empty>No options recorded.</Empty>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th>Option</th>
                  <th>Kind</th>
                  <th className="text-right">Projected total</th>
                  <th className="text-right">vs current</th>
                  <th className="text-right">vs recommended</th>
                  <th>Narrative / assumptions</th>
                  {optionsEditable && <th />}
                </tr>
              </thead>
              <tbody>
                {scenarios.map((sc) => (
                  <tr key={sc.id} data-testid="scenario-row">
                    <td className="font-medium">
                      {sc.label}
                      {decision?.selectedScenarioId === sc.id && (
                        <>
                          {" "}
                          <PlainBadge tone="sky">Client-selected</PlainBadge>
                        </>
                      )}
                      {recommendation?.scenarioId === sc.id && (
                        <>
                          {" "}
                          <PlainBadge tone="emerald">Cardaxia recommendation</PlainBadge>
                        </>
                      )}
                    </td>
                    <td>{scenarioKindLabel(sc.kind, Boolean(recommendation?.issuedAt))}</td>
                    <td className="text-right font-semibold whitespace-nowrap" data-testid="scenario-total">
                      {money(sc.totalValue, currency)}
                    </td>
                    <td className="text-right whitespace-nowrap">{delta(sc.vsCurrent, currency)}</td>
                    <td className="text-right whitespace-nowrap" data-testid="scenario-vs-recommended">
                      {delta(sc.vsRecommended, currency)}
                    </td>
                    <td className="max-w-xs text-xs text-slate-600">{sc.narrative ?? "—"}</td>
                    {optionsEditable && (
                      <td>
                        <ActionForm
                          action={removeScenarioAction}
                          confirm={`Remove option "${sc.label}"?`}
                          showSuccess={false}
                        >
                          <Hidden name="projectId" value={projectId} />
                          <Hidden name="scenarioId" value={sc.id} />
                          <SubmitButton variant="danger">Remove</SubmitButton>
                        </ActionForm>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
            {draft && (
              <p className="mt-2 text-xs text-slate-500" data-testid="outcomes-pending">
                Alternative Value Outcomes are shown once this review is finalised.
              </p>
            )}
          </>
        )}
        {currentForecastTotal && !scenarios.some((s) => s.kind === "current") && optionsEditable && (
          <p className="mt-2 text-xs text-slate-500">
            This review&apos;s Current Forecast is {formatMoneyShort(currentForecastTotal, currency)} — enter it as the
            Current trajectory if appropriate.
          </p>
        )}
        {optionsEditable && (
          <div className="mt-3">
            <Expander summary="Add option" testId="add-scenario">
              <ActionForm action={upsertScenarioAction} resetOnSuccess testId="add-scenario-form">
                <Hidden name="projectId" value={projectId} />
                <Hidden name="reviewId" value={review.id} />
                <Hidden name="sortOrder" value={String(scenarios.length + 1)} />
                <div className="space-y-2">
                  <FormGrid cols={3}>
                    <TextField name="label" label="Option" required placeholder="e.g. Delay one quarter" />
                    <SelectField
                      name="kind"
                      label="Kind"
                      required
                      defaultValue="alternative"
                      options={SCENARIO_KINDS.map((k) => ({ value: k, label: scenarioKindLabel(k, false) }))}
                    />
                    <MoneyField name="totalValue" label="Projected total value" required currency={currency} />
                  </FormGrid>
                  <TextArea name="narrative" label="Narrative / assumptions" rows={2} />
                  <SubmitButton variant="secondary">Add option</SubmitButton>
                </div>
              </ActionForm>
            </Expander>
          </div>
        )}
        {optionPaths}
      </Section>
    </>
  );
}

/** G. Cardaxia recommendation: draft → issue (unchanged lifecycle). */
export function RecommendationSection({ projectId, currency, review, response }: Base) {
  const { draft } = state({ projectId, currency, review, response });
  const { scenarios, recommendation } = response;
  return (
    <>
      <Section
        id="recommendation"
        title="Cardaxia recommendation"
        description="Separate from, and never rewritten by, the client's decision."
      >
        {recommendation?.issuedAt ? (
          <div className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm" data-testid="recommendation">
            <p className="font-semibold">
              {recommendation.scenario?.label}: {money(recommendation.scenario?.totalValue ?? null, currency)}{" "}
              <PlainBadge tone="emerald">🔒 Issued</PlainBadge>
            </p>
            <p className="mt-1 whitespace-pre-wrap">{recommendation.narrative}</p>
            <p className="mt-1 text-xs text-slate-600">
              Issued {formatDateTime(recommendation.issuedAt)} by {recommendation.issuerName}
            </p>
          </div>
        ) : !draft ? (
          <p className="text-sm text-slate-600">No recommendation was issued in this review.</p>
        ) : !scenarios.some((s) => s.kind === "recommended") ? (
          <p className="text-sm text-slate-600">
            Add an option of kind &quot;Recommended&quot; to draft the recommendation.
          </p>
        ) : (
          <div className="space-y-3">
            <ActionForm action={saveRecommendationAction} testId="recommendation-form">
              <Hidden name="projectId" value={projectId} />
              <Hidden name="reviewId" value={review.id} />
              <Hidden name="scenarioId" value={scenarios.find((s) => s.kind === "recommended")!.id} />
              <p className="mb-2 text-sm">
                Recommended option: <strong>{scenarios.find((s) => s.kind === "recommended")!.label}</strong> (
                {money(scenarios.find((s) => s.kind === "recommended")!.totalValue, currency)})
              </p>
              <TextArea
                name="narrative"
                label="Recommendation"
                required
                rows={3}
                defaultValue={recommendation?.narrative}
              />
              <div className="mt-2">
                <SubmitButton variant="secondary">Save draft recommendation</SubmitButton>
              </div>
            </ActionForm>
            {recommendation && (
              <ActionForm
                action={issueRecommendationAction}
                confirm="Issue Cardaxia's recommendation? It and the options become permanent."
              >
                <Hidden name="projectId" value={projectId} />
                <Hidden name="reviewId" value={review.id} />
                <SubmitButton>Issue recommendation</SubmitButton>
              </ActionForm>
            )}
          </div>
        )}
      </Section>
    </>
  );
}

/** H. Client / AVO decision against the issued recommendation (unchanged rules). */
export function DecisionSection({
  projectId,
  currency,
  review,
  response,
  stakeholders,
  evidence,
  outcomes,
}: Base & {
  stakeholders: Option[];
  evidence: Option[];
  /** Phase 4D.6: the Alternative Value Outcomes visual (finalised reviews), placed after the decision. */
  outcomes?: React.ReactNode;
}) {
  const { issued } = state({ projectId, currency, review, response });
  const { scenarios, recommendation, decision } = response;
  const base = `/projects/${projectId}`;
  return (
    <>
      <Section
        id="decision"
        title="Client / AVO decision"
        description="Recorded by a Cardaxia consultant. Permanent once recorded."
      >
        {decision ? (
          <div data-testid="decision">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat
                label="Cardaxia recommendation"
                value={money(recommendation?.scenario?.totalValue ?? null, currency)}
                note={recommendation?.scenario?.label}
                testId="decision-recommended"
              />
              <Stat
                label="Client-selected"
                value={money(decision.scenario?.totalValue ?? null, currency)}
                note={decision.scenario?.label}
                testId="decision-selected"
              />
              <Stat
                label="Client-elected value difference"
                value={delta(decision.clientElectedDifference, currency)}
                note="Selected − recommended"
                testId="decision-difference"
              />
            </div>
            <div className="mt-3">
              <KeyValues
                items={[
                  ["Decision maker", decision.deciderName],
                  ["Decision date", formatDate(decision.decidedOn)],
                  ["Rationale", decision.rationale ?? "—"],
                  ["Economic consequence", decision.economicConsequence ?? "—"],
                  [
                    "Supporting evidence",
                    decision.supportingEvidenceId ? (
                      <TextLink key="e" href={`${base}/evidence/${decision.supportingEvidenceId}`}>
                        {decision.evidenceCode} {decision.evidenceTitle}
                      </TextLink>
                    ) : (
                      "—"
                    ),
                  ],
                  ["Recorded by", `${decision.recorderName} · ${formatDateTime(decision.recordedAt)}`],
                ]}
              />
            </div>
          </div>
        ) : !issued ? (
          <p className="text-sm text-slate-600">
            The client decision is recorded after Cardaxia&apos;s recommendation is issued.
          </p>
        ) : (
          <ActionForm
            action={recordDecisionAction}
            confirm="Record this client decision? It is permanent."
            testId="decision-form"
          >
            <Hidden name="projectId" value={projectId} />
            <Hidden name="reviewId" value={review.id} />
            <div className="space-y-2">
              <FormGrid cols={3}>
                <SelectField
                  name="selectedScenarioId"
                  label="Selected option"
                  required
                  placeholder="— Choose —"
                  options={scenarios.map((s) => ({
                    value: s.id,
                    label: `${s.label} (${formatMoneyShort(s.totalValue, currency)})`,
                  }))}
                />
                <SelectField
                  name="decidedByPersonId"
                  label="Decision maker"
                  required
                  placeholder="— Choose stakeholder —"
                  options={stakeholders}
                />
                <DateField
                  name="decidedOn"
                  label="Decision date"
                  required
                  defaultValue={new Date().toISOString().slice(0, 10)}
                />
              </FormGrid>
              <TextArea name="rationale" label="Rationale" rows={2} />
              <TextArea name="economicConsequence" label="Economic consequence" rows={2} />
              <SelectField
                name="supportingEvidenceId"
                label="Supporting evidence"
                placeholder="— None —"
                options={evidence}
              />
              <SubmitButton>Record decision</SubmitButton>
            </div>
          </ActionForm>
        )}
      </Section>

      {outcomes}
    </>
  );
}

/** I. Value Case impact: forecast movement never alters the Authorised Value Case; a Value Change is separate. */
export async function ValueCaseImpactSection({
  projectId,
  currency,
  review,
  response,
  authorised,
}: Base & {
  /** The Authorised Value Case this review measures against, and this review's (formal or draft) forecast. */
  authorised: { versionNumber: number; total: string; forecastTotal: string | null; valueGap: string | null };
}) {
  const { decision } = response;
  const base = `/projects/${projectId}`;
  const changes = await listValueChanges(projectId);
  const openChange = changes.find((c) => c.change.status === "draft" || c.change.status === "proposed");
  return (
    <>
      <Section
        id="value-change"
        title="Value Case impact"
        testId="value-case-impact"
        description="Forecast movement never alters the Authorised Value Case. A Value Change is a separate, explicit step."
      >
        <div className="mb-3 grid gap-3 text-sm sm:grid-cols-3" data-testid="value-case-impact-figures">
          <Stat
            label={`Authorised Value (V${authorised.versionNumber})`}
            value={money(authorised.total, currency)}
            note="Unchanged by this review"
            testId="impact-authorised"
          />
          <Stat
            label={`Review #${review.sequence} Current Forecast`}
            value={authorised.forecastTotal === null ? "Incomplete" : money(authorised.forecastTotal, currency)}
            note={review.status === "draft" ? "Working until finalised" : "Formal position"}
          />
          <Stat
            label="Value Gap"
            value={authorised.valueGap === null ? "Incomplete" : money(authorised.valueGap, currency)}
            note="Authorised − Current Forecast"
          />
        </div>
        <p className="mb-3 text-xs text-slate-600" data-testid="value-change-guidance">
          After the management response and decision, a separate Value Change may be required. It is prepared explicitly
          here and is never created automatically.
        </p>
        {response.changes.length > 0 && (
          <ul className="mb-3 space-y-1 text-sm">
            {response.changes.map((c) => (
              <li key={c.id}>
                <TextLink href={`${base}/changes/${c.id}`}>{c.code}</TextLink> <PlainBadge>{c.status}</PlainBadge>
              </li>
            ))}
          </ul>
        )}
        {!decision ? (
          <p className="text-sm text-slate-600">A Value Change is prepared after the client decision.</p>
        ) : openChange ? (
          <p className="text-sm text-slate-600">
            <TextLink href={`${base}/changes/${openChange.change.id}`}>{openChange.change.code}</TextLink> is open (
            {openChange.change.status}).
          </p>
        ) : (
          <ActionForm action={createValueChangeAction} testId="create-change-form">
            <Hidden name="projectId" value={projectId} />
            <Hidden name="assuranceReviewId" value={review.id} />
            <Hidden name="decisionId" value={decision.id} />
            <div className="space-y-2">
              <FormGrid cols={3}>
                <TextField
                  name="code"
                  label="Code"
                  required
                  defaultValue={nextChangeCode(changes.map((c) => c.change.code))}
                />
                <MoneyField
                  name="statedChangeAmount"
                  label="Stated change to Authorised Value"
                  currency={currency}
                  hint="e.g. -0.6m. The proposed version must reconcile to it before authorisation."
                />
              </FormGrid>
              <TextArea name="reason" label="Reason" rows={2} />
              <p className="text-xs text-slate-500">
                Creates a draft of the next version copied from the Authorised version in force; adjust only the
                affected drivers.
              </p>
              <SubmitButton>Prepare Value Change</SubmitButton>
            </div>
          </ActionForm>
        )}
      </Section>
    </>
  );
}

/**
 * The matter as active management response: stage, owner, remediation, monitoring, evidence status and its working
 * vs this review's Value Leakage. Finalised reviews show the snapshot's own fields; living status (evidence requests,
 * working leakage) is shown on draft reviews only, labelled as working.
 */
function MatterResponse({
  entry: l,
  living,
  currency,
  reviewSequence,
}: {
  entry: Response["leakage"][number];
  living: WorkspaceMatter | undefined;
  currency: string;
  reviewSequence: number;
}) {
  const formal = l.thisReview?.amounts;
  return (
    <div
      className="mb-3 grid gap-x-4 gap-y-1 rounded border border-slate-200 bg-slate-50 p-2 text-xs sm:grid-cols-2 lg:grid-cols-3"
      data-testid="matter-response"
    >
      <p>
        <span className="text-slate-500">Stage: </span>
        {l.leakage.status === "closed" ? "Closed" : l.leakage.stage ? ASSURANCE_STAGE_LABELS[l.leakage.stage] : "Open"}
      </p>
      <p>
        <span className="text-slate-500">Owner: </span>
        {l.ownerName ?? <span className="text-amber-700">Not assigned</span>}
      </p>
      <p data-testid="matter-response-monitor">
        <span className="text-slate-500">Monitor until: </span>
        {l.leakage.monitorUntil ? formatDate(l.leakage.monitorUntil) : "—"}
      </p>
      <p className="sm:col-span-2 lg:col-span-3" data-testid="matter-response-remediation">
        <span className="text-slate-500">Remediation: </span>
        {l.leakage.remediationPlan ?? <span className="text-amber-700">No plan recorded</span>}
      </p>
      {living && (
        <p data-testid="matter-response-evidence">
          <span className="text-slate-500">Evidence: </span>
          {living.evidenceCount} supporting
          {living.requestState && (
            <span className={living.requestState.outstanding ? "text-amber-700" : undefined}>
              {" "}
              · {living.requestState.label}
            </span>
          )}
        </p>
      )}
      {living && (
        <p data-testid="matter-response-working">
          <span className="text-slate-500">Working VL: </span>
          {living.entry.working ? `${money(living.entry.working.total, currency)} (working)` : "Not yet quantified"}
        </p>
      )}
      <p data-testid="matter-response-formal">
        <span className="text-slate-500">Review #{reviewSequence} VL: </span>
        {formal ? money(formal.total, currency) : <span className="text-amber-700">Not yet assessed</span>}
      </p>
    </div>
  );
}

function nextLeakageCode(codes: readonly string[]): string {
  const max = codes.reduce((m, c) => Math.max(m, Number(/^VL-(\d+)$/.exec(c)?.[1] ?? 0)), 0);
  return `VL-${String(max + 1).padStart(3, "0")}`;
}

function Stat({ label, value, note, testId }: { label: string; value: string; note?: string; testId?: string }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-semibold" data-testid={testId}>
        {value}
      </p>
      {note && <p className="text-xs text-slate-500">{note}</p>}
    </div>
  );
}
