import { notFound } from "next/navigation";

import { EVIDENCE_STATUSES, QUALIFICATION_STATUSES } from "@/domain/statuses";
import {
  addDriverAssumptionAction,
  initialiseDriverRecordAction,
  removeDriverAssumptionAction,
  setDriverAvoAction,
  setDriverEstimateAction,
  setDriverEvidenceStatusAction,
  setDriverQualificationAction,
  updateDriverAssumptionAction,
  updateDriverWorkingAction,
} from "@/server/actions/drivers";
import { linkDriverEvidenceAction, unlinkDriverEvidenceAction } from "@/server/actions/evidence";
import { getDriverDetail } from "@/server/queries/drivers";
import { ActionForm, SubmitButton } from "@/ui/components/action-form";
import { EvidenceBadge, PlainBadge, QualificationBadge, RequestItemBadge } from "@/ui/components/badges";
import { FormGrid, Hidden, MoneyField, SelectField, TextArea, TextField } from "@/ui/components/fields";
import { Empty, Expander, KeyValues, Notice, Section, Table, TextLink } from "@/ui/components/layout";
import {
  AuthorisedValue,
  CurrentForecast,
  LivingStatusBadge,
  WORKING_DRIVER_LABEL,
  WorkingEstimate,
} from "@/ui/drivers/display";
import {
  formatDate,
  formatDateTime,
  formatMetric,
  formatMoneyShort,
  metricInputValue,
  moneyInputValue,
} from "@/ui/format";
import { EVIDENCE_STATUS_LABELS, QUALIFICATION_LABELS, VERSION_STATUS_LABELS } from "@/ui/labels";
import { isUuid, requireProject } from "@/ui/require";
import { ownerOptions, personWithRole } from "@/ui/people";

export const metadata = { title: "Value Driver" };

export default async function ValueDriverPage({ params }: PageProps<"/projects/[projectId]/value-drivers/[driverId]">) {
  const { projectId, driverId } = await params;
  const { project } = await requireProject(projectId);
  if (!isUuid(driverId)) notFound();
  const d = await getDriverDetail(projectId, driverId);
  if (!d) notFound();
  const { entry } = d;
  const { record, working } = entry;
  const currency = project.currency;
  const base = `/projects/${projectId}`;
  const stakeholders = ownerOptions(d.stakeholders);
  const hidden = (
    <>
      <Hidden name="projectId" value={projectId} />
      <Hidden name="valueDriverId" value={entry.driver.id} />
    </>
  );

  return (
    <>
      <p className="mb-3 text-sm">
        <TextLink href={`${base}/value-drivers`}>← Value Drivers</TextLink>
      </p>
      <div className="mb-6 flex flex-wrap items-center gap-2" data-testid="driver-header">
        <h1 className="text-xl font-semibold text-slate-900">
          <span className="font-mono text-slate-500">{entry.driver.code}</span> {working?.name}
        </h1>
        <LivingStatusBadge entry={entry} />
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-3" data-testid="driver-readings">
        <div className="rounded border border-dashed border-violet-300 bg-violet-50 p-3">
          <div className="text-xs font-semibold text-violet-800 uppercase">Working estimate</div>
          <WorkingEstimate value={working?.workingEstimate} currency={currency} noRecord={!record} />
        </div>
        <div className="rounded border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold text-slate-500 uppercase">Authorised Value</div>
          <AuthorisedValue entry={entry} currency={currency} />
        </div>
        <div className="rounded border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold text-slate-500 uppercase">Current Forecast</div>
          <CurrentForecast entry={entry} currency={currency} />
        </div>
      </div>

      {/* 1. Current working driver ------------------------------------------------ */}
      <Section title="Current working driver" description={WORKING_DRIVER_LABEL}>
        {!record ? (
          <div data-testid="no-working-record">
            <Notice tone="info" title="No working changes yet">
              Shown as recorded in V{entry.fromVersion}. Start a working record to track Cardaxia&apos;s current
              understanding — V{entry.fromVersion} itself is never changed.
            </Notice>
            <ActionForm action={initialiseDriverRecordAction} testId="initialise-record-form">
              {hidden}
              <SubmitButton variant="secondary">Start working record from V{entry.fromVersion}</SubmitButton>
            </ActionForm>
          </div>
        ) : (
          <div className="space-y-4" data-testid="working-driver">
            <KeyValues
              items={[
                [
                  "Origin",
                  record.identifiedOn
                    ? `Identified ${formatDate(record.identifiedOn)}${entry.origin ? ` in Assurance matter ${entry.origin.code} ${entry.origin.title}` : ""}`
                    : `Working record started from V${entry.fromVersion ?? d.history.find((h) => h.version.id === record.initialisedFromVersionId)?.version.versionNumber}`,
                ],
                [
                  "Working AVO",
                  <span key="a" data-testid="working-avo">
                    {entry.avoName ? personWithRole(entry.avoName, entry.avoRole) : "Not assigned"}
                  </span>,
                ],
                [
                  "Working status",
                  <span key="s" className="space-x-1">
                    <QualificationBadge status={record.qualificationStatus} />
                    <EvidenceBadge status={record.evidenceStatus} />
                  </span>,
                ],
                [
                  "Metric",
                  `${record.metric ?? "—"} · baseline ${formatMetric(record.baselineValue, record.metricUnit)} → target ${formatMetric(record.targetValue, record.metricUnit)}`,
                ],
                [
                  "Working estimate",
                  <span key="e">
                    <WorkingEstimate value={record.workingEstimate} currency={currency} />
                    {record.estimateRecordedAt && (
                      <span className="ml-2 text-xs text-slate-500">
                        {formatDateTime(record.estimateRecordedAt)} by {d.estimateRecordedByName ?? "—"}
                      </span>
                    )}
                  </span>,
                ],
              ]}
            />
            <div className="grid gap-4 lg:grid-cols-3">
              <ActionForm action={setDriverAvoAction} testId="driver-avo-form">
                {hidden}
                <SelectField
                  name="avoPersonId"
                  label="Working AVO"
                  placeholder="— Not assigned —"
                  defaultValue={record.avoPersonId}
                  options={stakeholders}
                />
                <div className="mt-2">
                  <SubmitButton variant="secondary">Save AVO</SubmitButton>
                </div>
              </ActionForm>
              <ActionForm action={setDriverQualificationAction} testId="driver-qualification-form">
                {hidden}
                <SelectField
                  name="qualificationStatus"
                  label="Working qualification"
                  required
                  defaultValue={record.qualificationStatus}
                  options={QUALIFICATION_STATUSES.map((s) => ({ value: s, label: QUALIFICATION_LABELS[s] }))}
                />
                <div className="mt-2">
                  <SubmitButton variant="secondary">Save qualification</SubmitButton>
                </div>
              </ActionForm>
              <ActionForm action={setDriverEvidenceStatusAction} testId="driver-evidence-status-form">
                {hidden}
                <SelectField
                  name="evidenceStatus"
                  label="Working evidence status"
                  required
                  defaultValue={record.evidenceStatus}
                  options={EVIDENCE_STATUSES.map((s) => ({ value: s, label: EVIDENCE_STATUS_LABELS[s] }))}
                />
                <div className="mt-2">
                  <SubmitButton variant="secondary">Save evidence status</SubmitButton>
                </div>
              </ActionForm>
            </div>
            <div className="grid gap-4 rounded border border-dashed border-violet-300 bg-violet-50 p-3 lg:grid-cols-[2fr_1fr]">
              <ActionForm action={setDriverEstimateAction} testId="driver-estimate-form">
                {hidden}
                <Hidden name="intent" value="save" />
                <MoneyField
                  name="workingEstimate"
                  label="Working estimate (not authorised)"
                  required
                  currency={currency}
                  defaultValue={moneyInputValue(record.workingEstimate)}
                  hint="Never added to Authorised Value, Current Forecast, Value Gap or realised value."
                />
                <div className="mt-2">
                  <SubmitButton variant="secondary">Save working estimate</SubmitButton>
                </div>
              </ActionForm>
              {record.workingEstimate !== null && (
                <ActionForm
                  action={setDriverEstimateAction}
                  testId="driver-clear-estimate-form"
                  confirm="Clear the working estimate? The driver will read as not yet quantified."
                >
                  {hidden}
                  <Hidden name="intent" value="clear" />
                  <SubmitButton variant="secondary">Clear working estimate</SubmitButton>
                </ActionForm>
              )}
            </div>
            <Expander summary="Edit working details" testId="driver-details">
              <ActionForm action={updateDriverWorkingAction} testId="driver-details-form">
                {hidden}
                <div className="space-y-2">
                  <TextField name="name" label="Name" required defaultValue={record.name} />
                  <TextArea name="description" label="Description" rows={2} defaultValue={record.description} />
                  <FormGrid cols={4}>
                    <TextField name="metric" label="Metric" defaultValue={record.metric} />
                    <TextField name="metricUnit" label="Unit" defaultValue={record.metricUnit} />
                    <TextField
                      name="baselineValue"
                      label="Baseline"
                      defaultValue={metricInputValue(record.baselineValue)}
                    />
                    <TextField name="targetValue" label="Target" defaultValue={metricInputValue(record.targetValue)} />
                  </FormGrid>
                  <TextArea
                    name="calculationRationale"
                    label="Economic rationale"
                    rows={2}
                    defaultValue={record.calculationRationale}
                  />
                  <TextArea name="notes" label="Notes" rows={2} defaultValue={record.notes} />
                  <SubmitButton variant="secondary">Save working details</SubmitButton>
                </div>
              </ActionForm>
            </Expander>

            <div>
              <h3 className="mb-1 text-sm font-semibold">Working assumptions ({d.assumptions.length})</h3>
              <p className="mb-2 text-xs text-slate-600" data-testid="driver-assumptions-help">
                The assumptions behind this driver&apos;s current working forecast, with how well evidence supports
                each. They become the governed Assumptions when the driver is next included in a Value Change.
              </p>
              {d.assumptions.length === 0 && <Empty>No working assumptions yet.</Empty>}
              <div className="space-y-2" data-testid="driver-assumptions">
                {d.assumptions.map((a) => (
                  <Expander
                    key={a.id}
                    testId="driver-assumption"
                    summary={
                      <span className="inline-flex flex-wrap items-center gap-2">
                        {a.statement} <EvidenceBadge status={a.evidenceStatus} />
                      </span>
                    }
                  >
                    <ActionForm action={updateDriverAssumptionAction}>
                      <Hidden name="projectId" value={projectId} />
                      <Hidden name="assumptionId" value={a.id} />
                      <div className="space-y-2">
                        <TextArea name="statement" label="Assumption" required rows={2} defaultValue={a.statement} />
                        <FormGrid>
                          <SelectField
                            name="evidenceStatus"
                            label="Evidence"
                            required
                            defaultValue={a.evidenceStatus}
                            options={EVIDENCE_STATUSES.map((s) => ({ value: s, label: EVIDENCE_STATUS_LABELS[s] }))}
                          />
                          <TextField name="notes" label="Notes" defaultValue={a.notes} />
                        </FormGrid>
                        <SubmitButton variant="secondary">Save assumption</SubmitButton>
                      </div>
                    </ActionForm>
                    <div className="mt-2">
                      <ActionForm
                        action={removeDriverAssumptionAction}
                        confirm="Remove this working assumption?"
                        showSuccess={false}
                      >
                        <Hidden name="projectId" value={projectId} />
                        <Hidden name="assumptionId" value={a.id} />
                        <SubmitButton variant="danger">Remove</SubmitButton>
                      </ActionForm>
                    </div>
                  </Expander>
                ))}
              </div>
              <div className="mt-2">
                <ActionForm action={addDriverAssumptionAction} resetOnSuccess testId="add-driver-assumption-form">
                  {hidden}
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-72 flex-1">
                      <TextField name="statement" label="New working assumption" required />
                    </div>
                    <SubmitButton variant="secondary">Add assumption</SubmitButton>
                  </div>
                </ActionForm>
              </div>
            </div>
          </div>
        )}
      </Section>

      {/* 2. Evidence ----------------------------------------------------------------- */}
      <Section
        title="Evidence"
        description="Working evidence accumulates against the continuing driver without touching any Value Case version. Formal reliance is recorded on a version's drivers and assumptions."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold">Working evidence ({d.workingEvidence.length})</h3>
            {d.workingEvidence.length === 0 ? (
              <Empty>No working evidence linked.</Empty>
            ) : (
              <ul className="space-y-1 text-sm" data-testid="driver-working-evidence">
                {d.workingEvidence.map((w) => (
                  <li key={w.linkId} className="flex items-start justify-between gap-2">
                    <span>
                      <PlainBadge tone="violet">Working link</PlainBadge>{" "}
                      <TextLink href={`${base}/evidence/${w.evidence.id}`}>
                        {w.evidence.code} {w.evidence.title}
                      </TextLink>
                      {w.relevanceNote && <span className="block text-xs text-slate-500">{w.relevanceNote}</span>}
                    </span>
                    <ActionForm
                      action={unlinkDriverEvidenceAction}
                      confirm="Remove this working link?"
                      showSuccess={false}
                    >
                      <Hidden name="projectId" value={projectId} />
                      <Hidden name="evidenceLinkId" value={w.linkId} />
                      <SubmitButton variant="danger">Unlink</SubmitButton>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}
            {d.linkableEvidence.length > 0 && (
              <ActionForm action={linkDriverEvidenceAction} resetOnSuccess testId="driver-link-evidence-form">
                {hidden}
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div className="min-w-60 flex-1">
                    <SelectField
                      name="evidenceId"
                      label="Link existing evidence"
                      required
                      placeholder="— Choose evidence —"
                      options={d.linkableEvidence.map((e) => ({ value: e.id, label: `${e.code} ${e.title}` }))}
                    />
                  </div>
                  <SubmitButton variant="secondary">Link</SubmitButton>
                </div>
              </ActionForm>
            )}
            <p className="mt-1 text-xs text-slate-500">
              New evidence is recorded in the <TextLink href={`${base}/evidence`}>Evidence register</TextLink> or from
              an Assurance matter.
            </p>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Formal reliance ({d.formalEvidence.length})</h3>
            {d.formalEvidence.length === 0 ? (
              <Empty>No Value Case version relies on evidence for this driver.</Empty>
            ) : (
              <ul className="space-y-1 text-sm">
                {d.formalEvidence.map((f) => (
                  <li key={f.linkId}>
                    V{f.versionNumber} ·{" "}
                    <TextLink href={`${base}/evidence/${f.evidence.id}`}>
                      {f.evidence.code} {f.evidence.title}
                    </TextLink>
                  </li>
                ))}
              </ul>
            )}
            {(d.requests.length > 0 || entry.matters.length > 0) && (
              <h3 className="mt-4 mb-2 text-sm font-semibold">Assurance context</h3>
            )}
            <ul className="space-y-1 text-sm">
              {entry.matters.map((m) => (
                <li key={m.id}>
                  Matter{" "}
                  <TextLink href={`${base}/assurance/matters/${m.id}`}>
                    {m.code} {m.title}
                  </TextLink>
                  {m.status === "closed" && <span className="text-xs text-slate-500"> (closed)</span>}
                </li>
              ))}
              {d.requests.map((r) => (
                <li key={r.item.id}>
                  <TextLink href={`${base}/information-request#ir-${r.requestId}`}>
                    {r.reference} #{r.item.sequence}
                  </TextLink>{" "}
                  {r.item.description} <RequestItemBadge status={r.item.status} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* 3. Value Case history ------------------------------------------------------- */}
      <Section
        title="Value Case history"
        description="How this driver appeared in each Value Case version. These are governed records and are read-only; changing a commitment needs a Value Change."
      >
        {d.history.length === 0 ? (
          <Empty>Not yet in any Value Case version — this driver is emerging.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Value</th>
                <th>Metric</th>
                <th>Qualification / evidence</th>
                <th>AVO</th>
              </tr>
            </thead>
            <tbody>
              {d.history.map((h) => (
                <tr key={h.dv.id} data-testid={`history-V${h.version.versionNumber}`}>
                  <td>
                    <TextLink href={`${base}/value-case/v/${h.version.versionNumber}`}>
                      V{h.version.versionNumber}
                    </TextLink>{" "}
                    <span className="text-xs text-slate-500">{VERSION_STATUS_LABELS[h.version.status]}</span>
                  </td>
                  <td className="font-semibold">
                    {h.dv.financialValue === null ? "Non-financial" : formatMoneyShort(h.dv.financialValue, currency)}
                  </td>
                  <td className="text-xs">
                    {h.dv.metric ?? "—"} · {formatMetric(h.dv.baselineValue, h.dv.metricUnit)} →{" "}
                    {formatMetric(h.dv.targetValue, h.dv.metricUnit)}
                  </td>
                  <td className="space-x-1">
                    <QualificationBadge status={h.dv.qualificationStatus} />
                    <EvidenceBadge status={h.dv.evidenceStatus} />
                  </td>
                  <td>{h.avoName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </>
  );
}
