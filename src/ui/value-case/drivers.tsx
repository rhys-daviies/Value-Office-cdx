import { EVIDENCE_STATUSES, QUALIFICATION_STATUSES } from "@/domain/statuses";
import {
  addAssumptionAction,
  addValueDriverAction,
  removeAssumptionAction,
  removeValueDriverAction,
  updateAssumptionAction,
  updateDriverVersionAction,
} from "@/server/actions/value-case";
import { linkEvidenceAction, unlinkEvidenceAction } from "@/server/actions/evidence";
import type { DriverRow } from "@/server/queries/value-case";

import { ActionForm, SubmitButton } from "../components/action-form";
import { EvidenceBadge, NonFinancialBadge, QualificationBadge } from "../components/badges";
import {
  Checkbox,
  DateField,
  FormGrid,
  Hidden,
  MoneyField,
  SelectField,
  TextArea,
  TextField,
} from "../components/fields";
import { Expander, KeyValues, Missing, TextLink } from "../components/layout";
import { formatDate, formatMetric, formatMoney, formatMoneyShort, metricInputValue, moneyInputValue } from "../format";
import { EVIDENCE_STATUS_LABELS, QUALIFICATION_LABELS } from "../labels";

type Option = { value: string; label: string };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export type DriverEditorContext = {
  projectId: string;
  currency: string;
  stakeholders: Option[];
  evidence: Option[];
};

const qualificationOptions = QUALIFICATION_STATUSES.map((s) => ({ value: s, label: QUALIFICATION_LABELS[s] }));
const evidenceStatusOptions = EVIDENCE_STATUSES.map((s) => ({ value: s, label: EVIDENCE_STATUS_LABELS[s] }));

export function DriverValue({ driver, currency }: { driver: Pick<DriverRow, "financialValue">; currency: string }) {
  return driver.financialValue === null ? (
    <NonFinancialBadge />
  ) : (
    <>{formatMoneyShort(driver.financialValue, currency)}</>
  );
}

function DriverSummaryLine({ driver, currency }: { driver: DriverRow; currency: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-mono text-slate-500">{driver.code}</span>
      <span className="font-semibold">{driver.name}</span>
      <span className="font-semibold text-slate-900">
        <DriverValue driver={driver} currency={currency} />
      </span>
      <QualificationBadge status={driver.qualificationStatus} />
      <EvidenceBadge status={driver.evidenceStatus} />
      <span className="text-xs font-normal text-slate-500">
        {driver.avoName ? `AVO ${driver.avoName}` : "No AVO"} · {plural(driver.assumptions.length, "assumption")} ·{" "}
        {plural(driver.evidenceLinkCount, "evidence link")}
      </span>
    </span>
  );
}

/** Full editor for a driver in a draft version. */
/** 4D.10E: the governed "why" for this driver's value, separate from how it is calculated. */
export type AdjustmentPrompt = { label: string; hint: string; required: boolean };

export function DriverEditor({
  driver,
  ctx,
  open = false,
  adjustment,
}: {
  driver: DriverRow;
  ctx: DriverEditorContext;
  open?: boolean;
  /** Shown only on Value Case versions (V1 definition, Value Change drafts); never on the Original Business Case. */
  adjustment?: AdjustmentPrompt;
}) {
  const { projectId, currency } = ctx;
  return (
    <Expander
      open={open}
      testId={`driver-${driver.code}`}
      summary={
        // 4D.10D: an explicit Edit affordance — editing is never hidden behind an unlabelled expander.
        <span className="inline-flex w-[calc(100%-1.25rem)] flex-wrap items-center justify-between gap-2 align-middle">
          <DriverSummaryLine driver={driver} currency={currency} />
          <span
            className="rounded border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800"
            data-testid={`driver-edit-${driver.code}`}
          >
            <span className="group-open:hidden">Edit {driver.code}</span>
            <span className="hidden group-open:inline">Close editor</span>
          </span>
        </span>
      }
    >
      <ActionForm action={updateDriverVersionAction} testId={`driver-form-${driver.code}`}>
        <Hidden name="projectId" value={projectId} />
        <Hidden name="driverVersionId" value={driver.driverVersionId} />
        <div className="space-y-3">
          <FormGrid cols={3}>
            <TextField name="name" label="Name" required defaultValue={driver.name} />
            <SelectField
              name="avoPersonId"
              label="Accountable Value Owner"
              defaultValue={driver.avoPersonId}
              placeholder="— Not assigned —"
              options={ctx.stakeholders}
            />
            <div />
          </FormGrid>
          <TextArea name="description" label="Description" rows={2} defaultValue={driver.description} />
          <FormGrid cols={4}>
            <TextField name="metric" label="Metric" defaultValue={driver.metric} />
            <TextField name="metricUnit" label="Unit" defaultValue={driver.metricUnit} hint="e.g. %, $, hours" />
            <TextField
              name="baselineValue"
              label="Baseline"
              inputMode="decimal"
              defaultValue={metricInputValue(driver.baselineValue)}
            />
            <TextField
              name="targetValue"
              label="Target"
              inputMode="decimal"
              defaultValue={metricInputValue(driver.targetValue)}
            />
          </FormGrid>
          <TextArea
            name="calculationRationale"
            label="Economic calculation / rationale"
            rows={3}
            defaultValue={driver.calculationRationale}
            placeholder="How the metric movement translates into financial value on the project's Value Basis"
          />
          <FormGrid cols={3}>
            <MoneyField
              name="financialValue"
              label="Financial value"
              currency={currency}
              defaultValue={moneyInputValue(driver.financialValue)}
              hint={`${currency}. Negative values allowed (costs, dis-benefits).`}
            />
            <div className="pt-6">
              <Checkbox
                name="nonFinancial"
                label="Non-financial outcome"
                defaultChecked={driver.financialValue === null}
                hint="No financial value; excluded from the total"
              />
            </div>
            <div />
            <DateField name="benefitStartDate" label="Realisation start" defaultValue={driver.benefitStartDate} />
            <DateField name="benefitFullDate" label="Full run-rate date" defaultValue={driver.benefitFullDate} />
            <TextField name="timingDescription" label="Timing notes" defaultValue={driver.timingDescription} />
            <SelectField
              name="qualificationStatus"
              label="Qualification status"
              required
              defaultValue={driver.qualificationStatus}
              options={qualificationOptions}
            />
            <SelectField
              name="evidenceStatus"
              label="Evidence status"
              required
              defaultValue={driver.evidenceStatus}
              options={evidenceStatusOptions}
            />
          </FormGrid>
          {adjustment && (
            <TextArea
              name="adjustmentRationale"
              label={adjustment.label}
              rows={2}
              defaultValue={driver.adjustmentRationale}
              required={adjustment.required}
              hint={adjustment.hint}
            />
          )}
          <TextArea name="notes" label="Notes" rows={2} defaultValue={driver.notes} />
          <SubmitButton>Save driver</SubmitButton>
        </div>
      </ActionForm>

      <div className="mt-5 grid gap-5 border-t border-slate-200 pt-4 lg:grid-cols-2">
        <div>
          <h4 className="mb-2 text-sm font-semibold">Assumptions ({driver.assumptions.length})</h4>
          <div className="space-y-2">
            {driver.assumptions.map((a) => (
              <Expander
                key={a.id}
                testId="assumption"
                summary={
                  <span className="inline-flex flex-wrap items-center gap-2 font-normal">
                    {a.statement} <EvidenceBadge status={a.evidenceStatus} />
                    {a.evidence.length > 0 && (
                      <span className="text-xs text-slate-500">{a.evidence.map((l) => l.code).join(", ")}</span>
                    )}
                  </span>
                }
              >
                <ActionForm action={updateAssumptionAction}>
                  <Hidden name="projectId" value={projectId} />
                  <Hidden name="assumptionId" value={a.id} />
                  <div className="space-y-2">
                    <TextArea name="statement" label="Assumption" required rows={2} defaultValue={a.statement} />
                    <FormGrid>
                      <SelectField
                        name="evidenceStatus"
                        label="Evidence status"
                        required
                        defaultValue={a.evidenceStatus}
                        options={evidenceStatusOptions}
                      />
                      <TextField name="notes" label="Notes" defaultValue={a.notes} />
                    </FormGrid>
                    <SubmitButton variant="secondary">Save assumption</SubmitButton>
                  </div>
                </ActionForm>
                <EvidenceLinks
                  projectId={projectId}
                  links={a.evidence}
                  target={`assumption:${a.id}`}
                  evidence={ctx.evidence}
                />
                <div className="mt-2">
                  <ActionForm action={removeAssumptionAction} confirm="Remove this assumption?" showSuccess={false}>
                    <Hidden name="projectId" value={projectId} />
                    <Hidden name="assumptionId" value={a.id} />
                    <SubmitButton variant="danger">Remove assumption</SubmitButton>
                  </ActionForm>
                </div>
              </Expander>
            ))}
            <Expander summary="Add assumption" testId="add-assumption">
              <ActionForm action={addAssumptionAction} resetOnSuccess>
                <Hidden name="projectId" value={projectId} />
                <Hidden name="driverVersionId" value={driver.driverVersionId} />
                <div className="space-y-2">
                  <TextArea name="statement" label="Assumption" required rows={2} />
                  <SelectField
                    name="evidenceStatus"
                    label="Evidence status"
                    defaultValue="unevidenced"
                    options={evidenceStatusOptions}
                  />
                  <SubmitButton variant="secondary">Add assumption</SubmitButton>
                </div>
              </ActionForm>
            </Expander>
          </div>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-semibold">Linked evidence ({driver.evidence.length})</h4>
          <EvidenceLinks
            projectId={projectId}
            links={driver.evidence}
            target={`driver:${driver.driverVersionId}`}
            evidence={ctx.evidence}
          />
        </div>
      </div>

      <div className="mt-5 border-t border-slate-200 pt-3">
        <ActionForm
          action={removeValueDriverAction}
          confirm={`Remove ${driver.code} ${driver.name} from this draft? Its assumptions and evidence links in this draft are removed too.`}
          showSuccess={false}
        >
          <Hidden name="projectId" value={projectId} />
          <Hidden name="driverVersionId" value={driver.driverVersionId} />
          <SubmitButton variant="danger">Remove driver from draft</SubmitButton>
        </ActionForm>
      </div>
    </Expander>
  );
}

function EvidenceLinks({
  projectId,
  links,
  target,
  evidence,
}: {
  projectId: string;
  links: DriverRow["evidence"];
  target: string;
  evidence: Option[];
}) {
  return (
    <div className="mt-2 space-y-2">
      {links.length === 0 && <p className="text-xs text-slate-500">No evidence linked.</p>}
      {links.map((l) => (
        <div key={l.linkId} className="flex items-start justify-between gap-2 text-sm">
          <TextLink href={`/projects/${projectId}/evidence/${l.evidenceId}`}>
            {l.code} {l.title}
          </TextLink>
          <ActionForm action={unlinkEvidenceAction} showSuccess={false}>
            <Hidden name="projectId" value={projectId} />
            <Hidden name="evidenceLinkId" value={l.linkId} />
            <SubmitButton variant="danger">Unlink</SubmitButton>
          </ActionForm>
        </div>
      ))}
      {evidence.length === 0 ? (
        <p className="text-xs text-slate-500">
          Record evidence in the <TextLink href={`/projects/${projectId}/evidence`}>Evidence register</TextLink> to link
          it here.
        </p>
      ) : (
        <ActionForm action={linkEvidenceAction} resetOnSuccess showSuccess={false}>
          <Hidden name="projectId" value={projectId} />
          <Hidden name="target" value={target} />
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <SelectField
                name="evidenceId"
                label="Link evidence"
                required
                placeholder="— Choose evidence —"
                options={evidence}
              />
            </div>
            <SubmitButton variant="secondary">Link</SubmitButton>
          </div>
        </ActionForm>
      )}
    </div>
  );
}

export function AddDriverForm({
  versionId,
  nextCode,
  ctx,
  sortOrder,
  open = false,
  summary = "Add Value Driver",
}: {
  versionId: string;
  nextCode: string;
  ctx: DriverEditorContext;
  sortOrder: number;
  open?: boolean;
  summary?: string;
}) {
  return (
    <Expander summary={`+ ${summary}`} testId="add-driver" open={open}>
      <ActionForm action={addValueDriverAction} resetOnSuccess testId="add-driver-form">
        <Hidden name="projectId" value={ctx.projectId} />
        <Hidden name="versionId" value={versionId} />
        <Hidden name="sortOrder" value={String(sortOrder)} />
        <div className="space-y-3">
          <FormGrid cols={3}>
            <TextField name="code" label="Code" required defaultValue={nextCode} />
            <TextField name="name" label="Name" required />
            <MoneyField name="financialValue" label="Financial value" currency={ctx.currency} />
          </FormGrid>
          <Checkbox
            name="nonFinancial"
            label="Non-financial outcome"
            hint="No financial value; excluded from the total"
          />
          <FormGrid cols={4}>
            <TextField name="metric" label="Metric" />
            <TextField name="metricUnit" label="Unit" />
            <TextField name="baselineValue" label="Baseline" inputMode="decimal" />
            <TextField name="targetValue" label="Target" inputMode="decimal" />
          </FormGrid>
          <p className="text-xs text-slate-500">
            Rationale, timing, AVO, statuses and assumptions are edited after adding.
          </p>
          <SubmitButton>Add driver</SubmitButton>
        </div>
      </ActionForm>
    </Expander>
  );
}

/** Read-only presentation of a driver in a locked version. */
export function DriverReadOnly({
  driver,
  currency,
  projectId,
}: {
  driver: DriverRow;
  currency: string;
  projectId: string;
}) {
  return (
    <Expander testId={`driver-${driver.code}`} summary={<DriverSummaryLine driver={driver} currency={currency} />}>
      <div className="grid gap-4 lg:grid-cols-2">
        <KeyValues
          items={[
            ["Description", driver.description ?? "—"],
            ["Metric", driver.metric ?? "—"],
            [
              "Baseline → target",
              `${formatMetric(driver.baselineValue, driver.metricUnit)} → ${formatMetric(driver.targetValue, driver.metricUnit)}`,
            ],
            [
              "Financial value",
              driver.financialValue === null ? <NonFinancialBadge /> : formatMoney(driver.financialValue, currency),
            ],
            ["Rationale", driver.calculationRationale ?? <Missing>Not recorded</Missing>],
            [
              "Realisation",
              `${formatDate(driver.benefitStartDate)} → full run-rate ${formatDate(driver.benefitFullDate)}`,
            ],
            ["Timing notes", driver.timingDescription ?? "—"],
            ["AVO", driver.avoName ?? <Missing>Not assigned</Missing>],
            ["Qualification", <QualificationBadge key="q" status={driver.qualificationStatus} />],
            ["Evidence status", <EvidenceBadge key="e" status={driver.evidenceStatus} />],
            ["Notes", driver.notes ?? "—"],
          ]}
        />
        <div className="space-y-3 text-sm">
          <div>
            <h4 className="mb-1 font-semibold">Assumptions ({driver.assumptions.length})</h4>
            {driver.assumptions.length === 0 ? (
              <p className="text-slate-500">None recorded.</p>
            ) : (
              <ul className="list-disc space-y-1 pl-5">
                {driver.assumptions.map((a) => (
                  <li key={a.id}>
                    {a.statement} <EvidenceBadge status={a.evidenceStatus} />
                    {a.evidence.length > 0 && (
                      <span className="text-xs text-slate-500"> {a.evidence.map((l) => l.code).join(", ")}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4 className="mb-1 font-semibold">Linked evidence ({driver.evidence.length})</h4>
            {driver.evidence.length === 0 ? (
              <p className="text-slate-500">None linked.</p>
            ) : (
              <ul className="space-y-1">
                {driver.evidence.map((l) => (
                  <li key={l.linkId}>
                    <TextLink href={`/projects/${projectId}/evidence/${l.evidenceId}`}>
                      {l.code} {l.title}
                    </TextLink>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Expander>
  );
}
