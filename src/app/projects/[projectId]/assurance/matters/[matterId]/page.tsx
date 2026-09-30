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
import { listStakeholders } from "@/server/queries/mobilise";
import { getAssuranceMatter } from "@/server/queries/response";
import { StageBadge, WORKING_LABEL, WorkingAmount } from "@/ui/assurance/matters";
import { ActionForm, SubmitButton } from "@/ui/components/action-form";
import { DateField, FormGrid, Hidden, MoneyField, SelectField, TextArea } from "@/ui/components/fields";
import { Empty, KeyValues, Notice, Section, Table, TextLink } from "@/ui/components/layout";
import { formatDate, formatDateTime, formatMoneyShort, moneyInputValue } from "@/ui/format";
import { ASSURANCE_STAGE_LABELS } from "@/ui/labels";
import { isUuid, requireProject } from "@/ui/require";

export const metadata = { title: "Assurance matter" };

export default async function AssuranceMatterPage({
  params,
}: PageProps<"/projects/[projectId]/assurance/matters/[matterId]">) {
  const { projectId, matterId } = await params;
  const { project } = await requireProject(projectId);
  if (!isUuid(matterId)) notFound();
  const [m, stakeholders] = await Promise.all([getAssuranceMatter(projectId, matterId), listStakeholders(projectId)]);
  if (!m) notFound();
  const { leakage } = m;
  const currency = project.currency;
  const open = leakage.status === "open";
  const base = `/projects/${projectId}`;
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
                  {m.ownerName ?? "Not assigned"}
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
                  options={stakeholders.map((s) => ({ value: s.personId, label: s.name }))}
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
        title="Formal review records"
        description="How each finalised Assurance Review recorded this matter. Later edits to the living matter never change these."
      >
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
