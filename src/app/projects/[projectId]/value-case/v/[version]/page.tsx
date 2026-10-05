import { notFound } from "next/navigation";

import { versionAuthority } from "@/domain/value-case";
import {
  addExistingDriverToOriginalAction,
  recordInheritedBusinessCaseAction,
  updateVersionDetailsAction,
} from "@/server/actions/value-case";
import { listEvidenceOptions } from "@/server/queries/information-request";
import { listStakeholders } from "@/server/queries/mobilise";
import { getVersionTrajectoryAuthoring } from "@/server/queries/trajectory";
import { getRequalificationWorkspace, getVersionDetail } from "@/server/queries/value-case";
import { ActionForm, SubmitButton } from "@/ui/components/action-form";
import {
  EvidenceBadge,
  LockedBadge,
  NonFinancialBadge,
  QualificationBadge,
  VersionBadge,
} from "@/ui/components/badges";
import { FormGrid, Hidden, MoneyField, SelectField, TextArea, TextField } from "@/ui/components/fields";
import { ButtonLink, Empty, KeyValues, Notice, Section, Table, TextLink } from "@/ui/components/layout";
import {
  formatDate,
  formatDateTime,
  formatMetric,
  formatMoney,
  formatMoneyShort,
  formatPeriod,
  moneyInputValue,
} from "@/ui/format";
import { requireProject } from "@/ui/require";
import { VersionTrajectorySection } from "@/ui/trajectory/milestones";
import { AddDriverForm, DriverEditor, DriverReadOnly, DriverValue } from "@/ui/value-case/drivers";

export const metadata = { title: "Value Case version" };

export default async function VersionPage({ params }: PageProps<"/projects/[projectId]/value-case/v/[version]">) {
  const { projectId, version: versionParam } = await params;
  const { project } = await requireProject(projectId);
  if (!/^\d{1,4}$/.test(versionParam)) notFound();
  const detail = await getVersionDetail(projectId, Number(versionParam));
  if (!detail) notFound();

  const { version, drivers, summary } = detail;
  const currency = project.currency;
  const isV0 = version.kind === "inherited_business_case";
  const editableV0 = isV0 && version.status === "draft";
  const headline = isV0
    ? (version.statedTotalValue ?? (summary.financialCount ? summary.financialTotal : null))
    : summary.driverCount
      ? summary.financialTotal
      : null;
  const base = `/projects/${projectId}`;
  const trajectory = isV0 ? null : await getVersionTrajectoryAuthoring(projectId, version.id);

  // Original Business Case context (4D.10D): whether a V1 already exists, and whether it was created from this case.
  const ws = isV0 ? await getRequalificationWorkspace(projectId) : null;
  const v1 = ws?.requalifiedVersion ?? null;
  const v1FromOriginal = Boolean(v1 && v1.basedOnVersionId === version.id);
  const lateBaseline = Boolean(isV0 && v1 && !v1FromOriginal);
  const v0DriverIds = new Set(drivers.map((d) => d.valueDriverId));
  const existingForLate = (ws?.requalifiedDrivers ?? []).filter((d) => !v0DriverIds.has(d.valueDriverId));
  const driverTotal = summary.financialCount > 0 ? summary.financialTotal : null;

  const ctx = editableV0
    ? {
        projectId,
        currency,
        stakeholders: (await listStakeholders(projectId)).map((s) => ({ value: s.personId, label: s.name })),
        evidence: (await listEvidenceOptions(projectId)).map((e) => ({ value: e.id, label: `${e.code} ${e.title}` })),
      }
    : null;

  return (
    <>
      <p className="mb-3 text-sm">
        <TextLink href={`${base}/value-case`}>← Value Case timeline</TextLink>
      </p>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <VersionBadge kind={version.kind} status={version.status} versionNumber={version.versionNumber} />
            {version.status !== "draft" && <LockedBadge />}
          </div>
          <h2 className="mt-2 text-lg font-semibold" data-testid="version-authority">
            {versionAuthority(version.kind, version.status, version.versionNumber)}
          </h2>
          <p className="text-sm text-slate-500">{version.title}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">{isV0 ? "Stated total" : "Financial total"}</p>
          <p className="text-3xl font-semibold" data-testid="version-total">
            {formatMoneyShort(headline, currency)}
          </p>
          {summary.nonFinancialCount > 0 && (
            <p className="text-xs text-slate-500">
              excludes {summary.nonFinancialCount} <NonFinancialBadge />
            </p>
          )}
        </div>
      </div>

      {version.status === "authorised" && (
        <Notice tone="success" title="Authorised Value Case — read-only">
          This version is the Authorised Value Case in force. It is immutable; only an approved Value Change (a later
          phase) can create a subsequent version.
        </Notice>
      )}
      {version.status === "recorded" && (
        <Notice tone="locked" title="Recorded — read-only">
          The Original Business Case is preserved exactly as captured. It is the recorded historical reference and
          cannot be edited.
          <span className="mt-2 block" data-testid="obc-continue">
            {v1 ? (
              <TextLink href={`${base}/requalification`}>Open Value Case Definition</TextLink>
            ) : (
              <ButtonLink href={`${base}/requalification`}>Continue to Value Case Definition</ButtonLink>
            )}
          </span>
        </Notice>
      )}
      {version.status === "proposed" && (
        <Notice tone="info" title="Proposed — awaiting VCO authorisation">
          Locked while proposed.{" "}
          <TextLink href={`${base}/requalification#authorise`}>Record authorisation or return to draft</TextLink>.
        </Notice>
      )}
      {version.kind === "value_case" && version.status === "draft" && (
        <Notice tone="warning" title="Draft">
          {version.versionNumber === 1 ? (
            <>
              Edit this version in <TextLink href={`${base}/requalification`}>Value Case Definition</TextLink>.
            </>
          ) : (
            <>
              Edit this version in its <TextLink href={`${base}/changes`}>Value Change</TextLink>.
            </>
          )}
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Version">
          <KeyValues
            items={[
              ["Version", isV0 ? "Original Business Case" : `V${version.versionNumber}`],
              ["Kind", isV0 ? "Original Business Case (recorded starting point, never authorised)" : "Value Case"],
              [
                "Status",
                <VersionBadge
                  key="status"
                  kind={version.kind}
                  status={version.status}
                  versionNumber={version.versionNumber}
                />,
              ],
              ["Based on", detail.basedOn ? `V${detail.basedOn.versionNumber} ${detail.basedOn.title}` : "—"],
              ["Summary", version.summary ?? "—"],
              ["Created", formatDateTime(version.createdAt)],
              ...(version.proposedAt
                ? ([["Proposed", `${formatDateTime(version.proposedAt)} by ${detail.proposerName ?? "—"}`]] as [
                    string,
                    string,
                  ][])
                : []),
            ]}
          />
        </Section>
        <Section title="Value Basis">
          <KeyValues
            items={[
              ["Currency", currency],
              ["Basis", project.valueBasisDescription ?? "—"],
              ["Period", formatPeriod(project.valuePeriodStart, project.valuePeriodEnd)],
            ]}
          />
        </Section>
      </div>

      {(version.status === "authorised" || version.status === "superseded") && (
        <Section
          title="Authorisation"
          description="Recorded by a Cardaxia consultant on the Value Case Owner's behalf."
        >
          <div data-testid="authorisation-details">
            <KeyValues
              items={[
                ["Authorised by (VCO)", detail.authoriserName],
                ["Authorisation date", formatDate(version.authorisedOn)],
                [
                  "Evidence",
                  version.authorisationEvidenceId ? (
                    <TextLink href={`${base}/evidence/${version.authorisationEvidenceId}`}>
                      {detail.evidenceCode} {detail.evidenceTitle}
                    </TextLink>
                  ) : (
                    "—"
                  ),
                ],
                ["Note", version.authorisationNote ?? "—"],
                ["Recorded by (consultant)", `${detail.recorderName ?? "—"} (${detail.recorderEmail ?? ""})`],
                ["Recorded at", formatDateTime(version.authorisationRecordedAt)],
              ]}
            />
          </div>
        </Section>
      )}

      {editableV0 && ctx && (
        <Section
          title="Capture the Original Business Case"
          description="Record the Business Case as the client presented it. Driver detail is optional — the stated total is what the client claimed."
        >
          <ActionForm action={updateVersionDetailsAction}>
            <Hidden name="projectId" value={projectId} />
            <Hidden name="versionId" value={version.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField name="title" label="Title" required defaultValue={version.title} />
              <MoneyField
                name="statedTotalValue"
                label="Stated total value"
                currency={currency}
                defaultValue={moneyInputValue(version.statedTotalValue)}
              />
            </div>
            <div className="mt-3">
              <TextArea name="summary" label="Summary" rows={2} defaultValue={version.summary} />
            </div>
            <div className="mt-3">
              <SubmitButton variant="secondary">Save details</SubmitButton>
            </div>
          </ActionForm>
        </Section>
      )}

      {trajectory && (
        <Section
          title="Value Basis and planned value"
          description={
            version.status === "draft"
              ? "Edit this draft's basis and milestones where the version is edited (Value Case Definition or its Value Change)."
              : "As recorded on this version."
          }
        >
          <VersionTrajectorySection
            projectId={projectId}
            currency={currency}
            authoring={{ ...trajectory, editable: false }}
            project={project}
          />
        </Section>
      )}

      {isV0 && (
        <Section
          title="Original Business Case: total and drivers"
          description="Recorded exactly as the client presented it. The stated total and the drivers it itemises are both kept; they need not add up to each other."
        >
          <div className="grid gap-3 text-sm sm:grid-cols-2" data-testid="obc-total-and-drivers">
            <div className="rounded border border-slate-200 p-3">
              <p className="text-xs text-slate-500">Stated total</p>
              <p className="text-2xl font-semibold" data-testid="obc-stated-total">
                {formatMoneyShort(version.statedTotalValue, currency)}
              </p>
              {version.statedTotalValue === null && <p className="text-xs text-slate-500">Not stated</p>}
            </div>
            <div className="rounded border border-slate-200 p-3">
              <p className="text-xs text-slate-500">Original Business Case drivers</p>
              <p className="text-2xl font-semibold" data-testid="obc-driver-summary">
                {summary.driverCount === 0
                  ? "None itemised"
                  : `${summary.driverCount} ${summary.driverCount === 1 ? "driver" : "drivers"}`}
              </p>
              {summary.driverCount > 0 && (
                <p className="text-xs text-slate-500">
                  Financial drivers total {formatMoneyShort(driverTotal, currency)}
                  {summary.nonFinancialCount > 0 && ` · ${summary.nonFinancialCount} non-financial`}
                </p>
              )}
            </div>
          </div>
          <p className="mt-3 text-sm text-slate-600">
            {lateBaseline
              ? "A Value Case (V1) already exists and was not created from this Original Business Case: it is a comparison reference, not V1's starting point."
              : "The existing business case is the starting point for Value Case Definition: when V1 is created from the recorded Original Business Case, its drivers are copied into V1 to be assessed, adjusted and qualified."}
          </p>
        </Section>
      )}

      {lateBaseline && (
        <Notice tone="warning" title="V1 was not created from this Original Business Case">
          Drivers added here are <strong>not</strong> copied into V{v1!.versionNumber}, and V{v1!.versionNumber} is
          never rewritten. To compare a driver with V{v1!.versionNumber}, record the Original Business Case value
          against that existing Value Driver
          {editableV0 ? " below" : ""}.
        </Notice>
      )}

      <Section
        title={
          isV0 ? `Original Business Case drivers (${summary.driverCount})` : `Value Drivers (${summary.driverCount})`
        }
        description={
          editableV0
            ? "Add the drivers the Original Business Case itemised, where available. Select Edit on a driver to change it while the Original Business Case is being captured."
            : undefined
        }
      >
        {drivers.length === 0 ? (
          <Empty>{isV0 ? "No driver breakdown captured for the Original Business Case." : "No Value Drivers."}</Empty>
        ) : (
          !editableV0 && (
            <Table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Driver</th>
                  <th>Metric</th>
                  <th>Baseline → target</th>
                  <th className="text-right">Value</th>
                  <th>AVO</th>
                  <th>Qualification</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((d) => (
                  <tr key={d.driverVersionId} data-testid="version-driver-row">
                    <td className="font-mono">{d.code}</td>
                    <td className="font-medium">{d.name}</td>
                    <td>{d.metric ?? "—"}</td>
                    <td className="whitespace-nowrap">
                      {formatMetric(d.baselineValue, d.metricUnit)} → {formatMetric(d.targetValue, d.metricUnit)}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <DriverValue driver={d} currency={currency} />
                    </td>
                    <td>{d.avoName ?? <span className="text-amber-700">—</span>}</td>
                    <td>
                      <QualificationBadge status={d.qualificationStatus} />
                    </td>
                    <td>
                      <EvidenceBadge status={d.evidenceStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        )}
        <div className="mt-4 space-y-2">
          {drivers.map((d) =>
            editableV0 && ctx ? (
              <DriverEditor key={d.driverVersionId} driver={d} ctx={ctx} />
            ) : (
              <DriverReadOnly key={d.driverVersionId} driver={d} currency={currency} projectId={projectId} />
            ),
          )}
          {editableV0 && ctx && (
            <AddDriverForm
              versionId={version.id}
              ctx={ctx}
              nextCode={ws!.nextDriverCode}
              sortOrder={drivers.length + 1}
              open={drivers.length === 0 && !lateBaseline}
              summary="Add an Original Business Case driver"
            />
          )}
          {editableV0 && lateBaseline && existingForLate.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3" data-testid="obc-existing-driver">
              <p className="mb-2 text-sm font-medium">Record the Original Business Case value for an existing driver</p>
              <ActionForm action={addExistingDriverToOriginalAction} resetOnSuccess testId="obc-existing-driver-form">
                <Hidden name="projectId" value={projectId} />
                <Hidden name="versionId" value={version.id} />
                <Hidden name="sortOrder" value={String(drivers.length + 1)} />
                <FormGrid cols={2}>
                  <SelectField
                    name="valueDriverId"
                    label={`Existing V${v1!.versionNumber} Value Driver`}
                    required
                    placeholder="— Choose driver —"
                    options={existingForLate.map((d) => ({ value: d.valueDriverId, label: `${d.code} ${d.name}` }))}
                  />
                  <MoneyField name="financialValue" label="Original Business Case value" currency={currency} />
                </FormGrid>
                <p className="mt-2 text-xs text-slate-500">
                  Keeps the same Value Driver so the two can be compared. V{v1!.versionNumber} is not changed.
                </p>
                <div className="mt-2">
                  <SubmitButton variant="secondary">Add to the Original Business Case</SubmitButton>
                </div>
              </ActionForm>
            </div>
          )}
        </div>
      </Section>

      {editableV0 && (
        <Section title="Record the Original Business Case" tone="muted">
          <div className="mb-3 rounded border border-slate-200 bg-white p-3 text-sm" data-testid="obc-record-summary">
            <p className="font-medium">You are about to record:</p>
            <ul className="mt-1 space-y-0.5">
              <li>
                Stated total:{" "}
                <strong>
                  {version.statedTotalValue === null ? "not stated" : formatMoney(version.statedTotalValue, currency)}
                </strong>
              </li>
              <li>
                Drivers: <strong>{summary.driverCount === 0 ? "none (headline only)" : summary.driverCount}</strong>
              </li>
              {drivers.map((d) => (
                <li key={d.driverVersionId} className="pl-4 text-slate-600">
                  {d.code} {d.name} · <DriverValue driver={d} currency={currency} />
                </li>
              ))}
            </ul>
          </div>
          <p className="mb-3 text-sm text-slate-600">
            Recording locks the Original Business Case permanently as the historical record of what the client
            originally claimed — it can no longer be edited.{" "}
            {v1
              ? `V${v1.versionNumber} already exists, so it remains a comparison reference.`
              : "You then continue to Value Case Definition, where V1 is created from it."}
          </p>
          <ActionForm
            action={recordInheritedBusinessCaseAction}
            confirm="Record and lock the Original Business Case? This cannot be undone."
          >
            <Hidden name="projectId" value={projectId} />
            <Hidden name="versionId" value={version.id} />
            <SubmitButton>Record the Original Business Case</SubmitButton>
          </ActionForm>
        </Section>
      )}
    </>
  );
}
