import Link from "next/link";

import { EVIDENCE_STATUSES, QUALIFICATION_STATUSES } from "@/domain/statuses";
import { createEmergingDriverAction } from "@/server/actions/drivers";
import { getDriverRegister } from "@/server/queries/drivers";
import { getContinuousAssurance } from "@/server/queries/response";
import { nextCode } from "@/server/queries/value-case";
import { ActionForm, SubmitButton } from "@/ui/components/action-form";
import { EvidenceBadge, QualificationBadge } from "@/ui/components/badges";
import { DateField, FormGrid, Hidden, MoneyField, SelectField, TextArea, TextField } from "@/ui/components/fields";
import { Empty, Expander, Notice, Section, Table, TextLink } from "@/ui/components/layout";
import { AuthorisedValue, CurrentForecast, LivingStatusBadge, WorkingEstimate } from "@/ui/drivers/display";
import { formatMoneyShort } from "@/ui/format";
import { EVIDENCE_STATUS_LABELS, QUALIFICATION_LABELS } from "@/ui/labels";
import { requireProject } from "@/ui/require";

export const metadata = { title: "Value Drivers" };

export default async function ValueDriversPage({ params }: PageProps<"/projects/[projectId]/value-drivers">) {
  const { projectId } = await params;
  const { project } = await requireProject(projectId);
  const [register, assurance] = await Promise.all([getDriverRegister(projectId), getContinuousAssurance(projectId)]);
  const currency = project.currency;
  const base = `/projects/${projectId}/value-drivers`;
  const stakeholders = register.stakeholders.map((s) => ({ value: s.personId, label: s.name }));

  return (
    <>
      <p className="mb-4 max-w-3xl text-sm text-slate-600">
        Every Value Driver across the engagement: what is in the Authorised Value Case, and what Cardaxia is working on
        now — including emerging drivers identified since authorisation. Working estimates are never authorised value,
        forecast or part of any total; an emerging driver enters the Authorised Value Case only through a Value Change.
      </p>

      <Section
        title={`Value Drivers (${register.entries.length})`}
        description={
          register.inForce ? (
            <>
              Authorised Value Case in force: V{register.inForce.versionNumber},{" "}
              <strong data-testid="authorised-total">{formatMoneyShort(register.authorisedTotal, currency)}</strong>{" "}
              authorised. Working estimates below are not included.
              <span className="mt-1 block text-xs text-slate-500" data-testid="driver-counts">
                {register.entries.filter((e) => e.presentation === "in_value_case").length} in Value Case ·{" "}
                {register.entries.filter((e) => e.presentation === "emerging").length} emerging ·{" "}
                {register.entries.filter((e) => e.presentation === "outside_current").length} outside current Value
                Case. Governed history is in <TextLink href={`/projects/${projectId}/value-case`}>Value Case</TextLink>.
              </span>
            </>
          ) : (
            "No Authorised Value Case yet."
          )
        }
      >
        {register.entries.length === 0 ? (
          <Empty>No Value Drivers yet. Drivers are first added through Re-Qualification.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Driver</th>
                <th>Status</th>
                <th>Qualification / evidence</th>
                <th>Current AVO</th>
                <th>Working estimate</th>
                <th>Authorised Value</th>
                <th>Current Forecast</th>
                <th>Assurance</th>
              </tr>
            </thead>
            <tbody>
              {register.entries.map((e) => (
                <tr key={e.driver.id} data-testid={`driver-row-${e.driver.code}`}>
                  <td>
                    <Link
                      href={`${base}/${e.driver.id}`}
                      className="font-medium text-sky-800 underline decoration-sky-300"
                    >
                      <span className="font-mono text-slate-500">{e.driver.code}</span> {e.working?.name ?? ""}
                    </Link>
                    {e.fromVersion !== null && (
                      <div className="text-xs text-slate-500">As in V{e.fromVersion} — no working changes yet</div>
                    )}
                  </td>
                  <td>
                    <LivingStatusBadge entry={e} />
                  </td>
                  <td className="space-y-1">
                    {e.working && (
                      <>
                        <QualificationBadge status={e.working.qualificationStatus} />{" "}
                        <EvidenceBadge status={e.working.evidenceStatus} />
                      </>
                    )}
                  </td>
                  <td>{e.avoName ?? <span className="text-amber-700">Not assigned</span>}</td>
                  <td>
                    <WorkingEstimate value={e.working?.workingEstimate} currency={currency} noRecord={!e.record} />
                  </td>
                  <td>
                    <AuthorisedValue entry={e} currency={currency} />
                  </td>
                  <td>
                    <CurrentForecast entry={e} currency={currency} />
                  </td>
                  <td className="text-xs text-slate-600">
                    {e.origin && <div>From matter {e.origin.code}</div>}
                    {e.matters.filter((m) => m.status === "open").length > 0 && (
                      <div>{e.matters.filter((m) => m.status === "open").length} open matter(s)</div>
                    )}
                    {e.workingEvidenceCount > 0 && <div>{e.workingEvidenceCount} working evidence</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <Section title="Add a Value Driver" tone="muted">
        {!register.inForce ? (
          <Notice tone="info">
            Until the Value Case is authorised, add drivers to the draft Value Case in Re-Qualification.
          </Notice>
        ) : (
          <Expander summary="+ Add Value Driver" testId="add-driver">
            <ActionForm action={createEmergingDriverAction} testId="add-driver-form">
              <Hidden name="projectId" value={projectId} />
              <p className="mb-3 text-xs text-slate-600">
                The driver starts as <strong>Emerging</strong>: it is not added to the Authorised Value Case, the
                Current Forecast or any total, and no Value Change is created. Include it in a Value Change when
                governance should consider it.
              </p>
              <div className="space-y-2">
                <FormGrid cols={3}>
                  <TextField
                    name="code"
                    label="Code"
                    required
                    defaultValue={nextCode(
                      register.entries.map((e) => e.driver.code),
                      "VD",
                    )}
                  />
                  <TextField name="name" label="Name" required />
                  <DateField name="identifiedOn" label="Identified on" />
                </FormGrid>
                <TextArea name="description" label="Description" rows={2} />
                <FormGrid cols={3}>
                  <SelectField
                    name="avoPersonId"
                    label="Working AVO"
                    placeholder="— Not assigned —"
                    options={stakeholders}
                  />
                  <SelectField
                    name="qualificationStatus"
                    label="Qualification"
                    defaultValue="unqualified"
                    options={QUALIFICATION_STATUSES.map((s) => ({ value: s, label: QUALIFICATION_LABELS[s] }))}
                  />
                  <SelectField
                    name="evidenceStatus"
                    label="Evidence"
                    defaultValue="unevidenced"
                    options={EVIDENCE_STATUSES.map((s) => ({ value: s, label: EVIDENCE_STATUS_LABELS[s] }))}
                  />
                </FormGrid>
                <FormGrid cols={4}>
                  <TextField name="metric" label="Metric" />
                  <TextField name="metricUnit" label="Unit" />
                  <TextField name="baselineValue" label="Baseline" />
                  <TextField name="targetValue" label="Target" />
                </FormGrid>
                <TextArea name="calculationRationale" label="Economic rationale" rows={2} />
                <FormGrid>
                  <MoneyField
                    name="workingEstimate"
                    label="Working estimate (not authorised)"
                    currency={currency}
                    hint="Leave blank if not yet quantified. Never added to Authorised Value or forecast."
                  />
                  <SelectField
                    name="originValueLeakageId"
                    label="Identified in Assurance matter"
                    placeholder="— None —"
                    options={assurance.open.map((m) => ({
                      value: m.leakage.id,
                      label: `${m.leakage.code} ${m.leakage.title}`,
                    }))}
                  />
                </FormGrid>
                <TextArea name="notes" label="Notes" rows={2} />
                <SubmitButton>Add emerging Value Driver</SubmitButton>
              </div>
            </ActionForm>
          </Expander>
        )}
      </Section>
    </>
  );
}
