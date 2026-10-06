import { notFound } from "next/navigation";

import { ASSURANCE_STAGES } from "@/domain/statuses";
import {
  assessMatterWorkingAction,
  closeMatterAction,
  reopenMatterAction,
  setMatterOwnerAction,
  setMatterRemediationAction,
  setMatterStageAction,
} from "@/server/actions/matters";
import { matterWorkflow } from "@/domain/assurance-workflow";
import { getMatterReviewHandoff } from "@/server/queries/assurance";
import { getMatterEvidence } from "@/server/queries/evidence";
import { listStakeholders } from "@/server/queries/mobilise";
import { getAssuranceMatter } from "@/server/queries/response";
import { MatterEvidenceSections } from "@/ui/assurance/matter-evidence";
import { StageBadge, WORKING_LABEL, WorkingAmount } from "@/ui/assurance/matters";
import { ActionForm, SubmitButton } from "@/ui/components/action-form";
import { DateField, FormGrid, Hidden, MoneyField, SelectField, TextArea } from "@/ui/components/fields";
import { Empty, KeyValues, Notice, Section, Table, TextLink } from "@/ui/components/layout";
import { formatDate, formatDateTime, formatMoneyShort, moneyInputValue } from "@/ui/format";
import { ASSURANCE_STAGE_LABELS } from "@/ui/labels";
import { isUuid, requireProject } from "@/ui/require";
import { ownerOptions, personWithRole } from "@/ui/people";

export const metadata = { title: "Assurance matter" };

export default async function AssuranceMatterPage({
  params,
}: PageProps<"/projects/[projectId]/assurance/matters/[matterId]">) {
  const { projectId, matterId } = await params;
  const { project } = await requireProject(projectId);
  if (!isUuid(matterId)) notFound();
  const [m, stakeholders, ev, handoff] = await Promise.all([
    getAssuranceMatter(projectId, matterId),
    listStakeholders(projectId),
    getMatterEvidence(projectId, matterId),
    getMatterReviewHandoff(projectId, matterId),
  ]);
  if (!m) notFound();
  const { leakage } = m;
  const currency = project.currency;
  const open = leakage.status === "open";
  const base = `/projects/${projectId}`;
  const count = (status: string) => ev.items.filter((i) => i.item.status === status).length;
  const workflow = matterWorkflow({
    status: leakage.status,
    stage: leakage.stage,
    evidenceLinked: ev.linked.length,
    requests: {
      open: count("open"),
      partial: count("partially_received"),
      received: count("received"),
      unavailable: count("not_available"),
    },
    quantified: m.working !== null,
    remediationPlan: leakage.remediationPlan,
    monitorUntil: leakage.monitorUntil,
    formalReviews: m.formal.length,
    draftReviewSequence: handoff.draft?.sequence ?? null,
  });
  const hidden = (
    <>
      <Hidden name="projectId" value={projectId} />
      <Hidden name="matterId" value={leakage.id} />
    </>
  );

  return (
    <>
      <p className="mb-3 text-sm">
        <TextLink href={`${base}/assurance`}>← Value Assurance</TextLink>
      </p>
      <div className="mb-6 flex flex-wrap items-center gap-2" data-testid="matter-header">
        <h1 className="text-xl font-semibold text-slate-900">
          <span className="font-mono text-slate-500">{leakage.code}</span> {leakage.title}
        </h1>
        <StageBadge entry={m} />
        <span className="text-sm text-slate-500">Assurance matter · living record</span>
      </div>

      <ol
        className="mb-6 grid gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6"
        aria-label="Matter workflow"
        data-testid="matter-workflow"
      >
        {workflow.map((step) => (
          <li
            key={step.key}
            className={`rounded border px-2 py-1.5 ${step.done ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}
            data-testid={`workflow-${step.key}`}
            data-done={step.done ? "true" : "false"}
          >
            <p className="font-semibold text-slate-800">
              {step.done ? "✓ " : ""}
              {step.label}
            </p>
            <p className="text-slate-600">
              {step.detail}
              {step.date && ` ${formatDate(step.date)}`}
            </p>
          </li>
        ))}
      </ol>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Matter">
          <KeyValues
            items={[
              [
                "Description",
                <span key="d" className="whitespace-pre-wrap">
                  {leakage.description ?? "—"}
                </span>,
              ],
              [
                "Raised",
                m.identifiedInSequence !== null
                  ? `In Assurance Review #${m.identifiedInSequence}`
                  : `In Continuous Assurance, ${formatDate(leakage.identifiedOn)}`,
              ],
              ["Affected Value Drivers", m.drivers.map((d) => d.code).join(", ") || "—"],
              [
                "Risk / Leakage Owner",
                <span key="o" data-testid="matter-owner">
                  {m.ownerName ? personWithRole(m.ownerName, m.ownerRole) : "Not assigned"}
                </span>,
              ],
              ["Required decision date", formatDate(leakage.requiredDecisionDate)],
              ["Status", open ? "Open" : "Closed"],
              ...(leakage.closureNote
                ? ([
                    [
                      "Closure note",
                      <span key="c" className="whitespace-pre-wrap" data-testid="closure-note">
                        {leakage.closureNote}
                      </span>,
                    ],
                  ] as [string, React.ReactNode][])
                : []),
            ]}
          />
        </Section>

        <Section
          title="Working stage and owner"
          description="Move freely between stages while the matter is open. Every change is audited."
        >
          {open ? (
            <div className="space-y-4">
              <ActionForm action={setMatterStageAction} testId="stage-form">
                {hidden}
                <FormGrid>
                  <SelectField
                    name="stage"
                    label="Working stage"
                    required
                    defaultValue={leakage.stage ?? "identified"}
                    options={ASSURANCE_STAGES.map((s) => ({ value: s, label: ASSURANCE_STAGE_LABELS[s] }))}
                  />
                </FormGrid>
                <div className="mt-2">
                  <SubmitButton variant="secondary">Set stage</SubmitButton>
                </div>
              </ActionForm>
              <ActionForm action={setMatterOwnerAction} testId="owner-form">
                {hidden}
                <SelectField
                  name="responseOwnerPersonId"
                  label="Risk / Leakage Owner"
                  placeholder="— Not assigned —"
                  defaultValue={leakage.responseOwnerPersonId}
                  options={ownerOptions(stakeholders)}
                />
                <p className="mt-1 text-xs text-slate-500">May differ from the affected drivers&apos; AVOs.</p>
                <div className="mt-2">
                  <SubmitButton variant="secondary">Save owner</SubmitButton>
                </div>
              </ActionForm>
            </div>
          ) : (
            <Empty>Closed — reopen the matter to change its stage or owner.</Empty>
          )}
        </Section>
      </div>

      <MatterEvidenceSections
        projectId={projectId}
        entry={m}
        ev={ev}
        draftReview={handoff.draft}
        reliedOn={handoff.reliedOn}
        stakeholders={ownerOptions(stakeholders)}
      />

      <Section
        title={WORKING_LABEL}
        description="The consultant's current view of the Value Leakage. It does not change Authorised Value, Current Forecast or Value Gap, and it is never a formal review figure. Recoverable = Total − Unrecoverable."
      >
        <div
          className="mb-3 rounded border border-dashed border-violet-300 bg-violet-50 p-3 text-sm"
          data-testid="working-assessment"
        >
          {m.working ? (
            <>
              Total <strong>{formatMoneyShort(m.working.total, currency)}</strong> · Recoverable{" "}
              <strong>{formatMoneyShort(m.working.recoverable, currency)}</strong> · Unrecoverable{" "}
              <strong>{formatMoneyShort(m.working.unrecoverable, currency)}</strong>
              <div className="mt-1 text-xs text-violet-800">
                Assessed {formatDateTime(leakage.workingAssessedAt)} by {m.workingAssessedByName ?? "—"}
                {leakage.workingUnrecoverableRationale &&
                  ` · Evidence of loss: ${leakage.workingUnrecoverableRationale}`}
              </div>
            </>
          ) : (
            <WorkingAmount entry={m} currency={currency} />
          )}
        </div>
        {open && (
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <ActionForm action={assessMatterWorkingAction} testId="working-form">
              {hidden}
              <Hidden name="intent" value="save" />
              <FormGrid>
                <MoneyField
                  name="workingTotalAmount"
                  label="Working total Value Leakage"
                  required
                  currency={currency}
                  defaultValue={moneyInputValue(leakage.workingTotalAmount)}
                />
                <MoneyField
                  name="workingUnrecoverableAmount"
                  label="Working unrecoverable"
                  currency={currency}
                  defaultValue={moneyInputValue(leakage.workingUnrecoverableAmount ?? "0")}
                  hint="Treated as recoverable unless evidence shows loss."
                />
              </FormGrid>
              <TextArea
                name="workingUnrecoverableRationale"
                label="Evidence of loss (required if unrecoverable > 0)"
                rows={2}
                defaultValue={leakage.workingUnrecoverableRationale}
              />
              <div className="mt-2">
                <SubmitButton variant="secondary">Save working assessment</SubmitButton>
              </div>
            </ActionForm>
            {m.working && (
              <ActionForm
                action={assessMatterWorkingAction}
                testId="clear-working-form"
                confirm="Clear the working assessment? The matter will read as not yet quantified."
              >
                {hidden}
                <Hidden name="intent" value="clear" />
                <p className="mb-2 text-xs text-slate-500">
                  No longer supportable? Clear it back to not yet quantified.
                </p>
                <SubmitButton variant="secondary">Clear working assessment</SubmitButton>
              </ActionForm>
            )}
          </div>
        )}
      </Section>

      <Section title="Remediation and monitoring">
        {open ? (
          <ActionForm action={setMatterRemediationAction} testId="remediation-form">
            {hidden}
            <TextArea
              name="remediationPlan"
              label="Remediation approach"
              rows={3}
              defaultValue={leakage.remediationPlan}
            />
            <FormGrid>
              <DateField name="monitorUntil" label="Monitor until" defaultValue={leakage.monitorUntil} />
            </FormGrid>
            <div className="mt-2">
              <SubmitButton variant="secondary">Save remediation</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <KeyValues
            items={[
              ["Remediation approach", leakage.remediationPlan ?? "—"],
              ["Monitor until", formatDate(leakage.monitorUntil)],
            ]}
          />
        )}
      </Section>

      <Section
        id="formal-review"
        title="Formal review"
        description="This matter is worked continuously. A formal Assurance Review records it as it stands when the review is finalised; later edits to the living matter never change that record."
      >
        <div className="mb-3 rounded border border-slate-300 bg-slate-50 p-3 text-sm" data-testid="matter-handoff">
          {handoff.draft && open ? (
            <>
              <p className="font-semibold">
                Being assessed in Review #{handoff.draft.sequence} (draft){" "}
                <span className="font-normal text-slate-600">
                  · {handoff.assessed ? "Value Leakage assessed in this review" : "not yet assessed in this review"}
                </span>
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Evidence is relied on in the review only when you link it (see Evidence above). The matter is recorded
                in Review #{handoff.draft.sequence} when it is finalised.
              </p>
              <p className="mt-2">
                <TextLink href={`${base}/assurance/${handoff.draft.id}#matter-${leakage.code}`}>
                  Assess in Review #{handoff.draft.sequence} →
                </TextLink>
              </p>
            </>
          ) : open ? (
            <>
              <p className="font-semibold">Worked continuously — no formal review is open</p>
              <p className="mt-1 text-xs text-slate-600">
                It will be recorded in the next formal Assurance Review when that review is finalised. A matter does not
                require an immediate review.
              </p>
              <p className="mt-2">
                <TextLink href={`${base}/assurance#formal`}>Formal Assurance Reviews</TextLink>
              </p>
            </>
          ) : (
            <p>Closed — later reviews no longer record it unless it is reopened.</p>
          )}
        </div>
        <h3 className="mb-2 text-sm font-semibold">Formal review records</h3>
        {m.formal.length === 0 ? (
          <Empty>Not yet in a finalised Assurance Review.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Review</th>
                <th>Status / stage at finalisation</th>
                <th>Formal Value Leakage</th>
              </tr>
            </thead>
            <tbody>
              {m.formal.map((f) => (
                <tr key={f.reviewId} data-testid="formal-record">
                  <td>
                    <TextLink href={`${base}/assurance/${f.reviewId}`}>Review #{f.reviewSequence}</TextLink>
                  </td>
                  <td>
                    {f.snapshotted
                      ? `${f.status === "closed" ? "Closed" : "Open"}${f.stage ? ` · ${ASSURANCE_STAGE_LABELS[f.stage]}` : ""}`
                      : "Recorded before snapshots"}
                  </td>
                  <td>
                    {f.amounts ? (
                      `Total ${formatMoneyShort(f.amounts.total, currency)} · Recoverable ${formatMoneyShort(f.amounts.recoverable, currency)} · Unrecoverable ${formatMoneyShort(f.amounts.unrecoverable, currency)}`
                    ) : (
                      <span className="text-amber-700 italic">Not yet quantified</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <Section title={open ? "Resolve" : "Reopen"} tone="muted">
        {open ? (
          <ActionForm action={closeMatterAction} testId="close-form" confirm="Close this Assurance matter?">
            {hidden}
            <TextArea name="closureNote" label="Closure note — how the matter was resolved" rows={2} required />
            <div className="mt-2">
              <SubmitButton variant="secondary">Close matter</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <>
            <Notice tone="locked">Closed. Its closure note is kept if it is reopened.</Notice>
            <ActionForm action={reopenMatterAction} testId="reopen-form">
              {hidden}
              <SubmitButton variant="secondary">Reopen matter</SubmitButton>
            </ActionForm>
          </>
        )}
      </Section>
    </>
  );
}
