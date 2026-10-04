import { notFound } from "next/navigation";

import { recordEvidenceAction } from "@/server/actions/evidence";
import {
  authoriseValueChangeAction,
  proposeValueChangeAction,
  includeDriverAction,
  rejectValueChangeAction,
  returnValueChangeAction,
  updateValueChangeAction,
  withdrawValueChangeAction,
} from "@/server/actions/value-change";
import { getCurrentActor } from "@/server/auth/actor";
import { getDriverRegister } from "@/server/queries/drivers";
import { nextEvidenceCode } from "@/server/queries/evidence";
import { listEvidenceOptions } from "@/server/queries/information-request";
import { listStakeholders } from "@/server/queries/mobilise";
import { getValueChangeDetail } from "@/server/queries/response";
import { getVersionTrajectoryAuthoring } from "@/server/queries/trajectory";
import { nextCode } from "@/server/queries/value-case";
import { ActionForm, SubmitButton } from "@/ui/components/action-form";
import { PlainBadge, VersionBadge } from "@/ui/components/badges";
import { DateField, FormGrid, Hidden, MoneyField, SelectField, TextArea, TextField } from "@/ui/components/fields";
import { KeyValues, Notice, Section, Table, TextLink } from "@/ui/components/layout";
import { reportPreviewHref } from "@/ui/reports/routes";
import { formatDate, formatDateTime, formatMoneyChange, formatMoneyShort, moneyInputValue } from "@/ui/format";
import { isUuid, requireProject } from "@/ui/require";
import { VersionTrajectorySection } from "@/ui/trajectory/milestones";
import { WorkingEstimate } from "@/ui/drivers/display";
import { AddDriverForm, DriverEditor } from "@/ui/value-case/drivers";

export const metadata = { title: "Value Change" };

const today = () => new Date().toISOString().slice(0, 10);

const STATUS_TONE = {
  draft: "amber",
  proposed: "sky",
  authorised: "emerald",
  rejected: "red",
  withdrawn: "slate",
} as const;

export default async function ValueChangePage({ params }: PageProps<"/projects/[projectId]/changes/[changeId]">) {
  const { projectId, changeId } = await params;
  const { project } = await requireProject(projectId);
  if (!isUuid(changeId)) notFound();
  const d = await getValueChangeDetail(projectId, changeId);
  if (!d) notFound();
  const [stakeholders, evidence, actor, register, trajectory] = await Promise.all([
    listStakeholders(projectId),
    listEvidenceOptions(projectId),
    getCurrentActor().catch(() => null),
    getDriverRegister(projectId),
    getVersionTrajectoryAuthoring(projectId, d.toVersion.id),
  ]);
  // Phase 4D.3: identities with a working record that are not yet in the proposed version.
  const inProposed = new Set(d.toDrivers.map((drv) => drv.valueDriverId));
  const includable = register.entries.filter((e) => e.record && !inProposed.has(e.driver.id));
  const { change } = d;
  const currency = project.currency;
  const base = `/projects/${projectId}`;
  const ctx = {
    projectId,
    currency,
    stakeholders: stakeholders.map((p) => ({ value: p.personId, label: p.name })),
    evidence: evidence.map((e) => ({ value: e.id, label: `${e.code} ${e.title}` })),
  };
  const canAuthorise = d.reconciled !== false && Boolean(d.vco);

  return (
    <>
      <p className="mb-3 text-sm">
        <TextLink href={`${base}/changes`}>← Value Changes</TextLink>
        {" · "}
        <TextLink href={reportPreviewHref(projectId, "value_change_notice", change.id)}>Value Change Notice</TextLink>
      </p>
      <div className="mb-6 rounded-lg border-2 border-slate-300 bg-white px-4 py-3" data-testid="change-state">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{change.code}</h2>
          <PlainBadge tone={STATUS_TONE[change.status]}>{change.status}</PlainBadge>
        </div>
        <p className="text-sm text-slate-600">
          {
            {
              draft: `Draft — adjust the affected drivers in V${d.toVersion.versionNumber}, then propose to the Value Case Owner.`,
              proposed: `Proposed to the Value Case Owner — V${d.toVersion.versionNumber} is locked. Record the VCO's decision.`,
              authorised: `Authorised — V${d.toVersion.versionNumber} is the Authorised Value Case in force; V${d.fromVersion.versionNumber} is superseded and preserved.`,
              rejected: "Rejected by the VCO — preserved for the record.",
              withdrawn: "Withdrawn — preserved for the record.",
            }[change.status]
          }
        </p>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-4" data-testid="change-figures">
        <Figure
          label={`V${d.fromVersion.versionNumber} (${d.fromVersion.status})`}
          value={formatMoneyShort(d.fromTotal, currency)}
          note="Authorised value this change starts from"
          testId="change-from-total"
        />
        <Figure
          label="Stated change"
          value={change.statedChangeAmount ? formatMoneyChange(change.statedChangeAmount, currency) : "Not stated"}
          testId="change-stated"
        />
        <Figure
          label={`Proposed V${d.toVersion.versionNumber} (driver total)`}
          value={formatMoneyShort(d.toTotal, currency)}
          note={`Driver-level change ${formatMoneyChange(d.actualChange, currency)}`}
          testId="change-to-total"
        />
        <Figure
          label="Authorised value if approved (stated)"
          value={d.projectedFromStated ? formatMoneyShort(d.projectedFromStated, currency) : "—"}
          note={`V${d.fromVersion.versionNumber} + stated change`}
          testId="change-projected"
        />
      </div>
      {d.reconciled === false && change.status !== "authorised" && (
        <Notice tone="warning" title="Not reconciled">
          The proposed version&apos;s drivers change the financial total by{" "}
          {formatMoneyChange(d.actualChange, currency)}, but the change states{" "}
          {formatMoneyChange(change.statedChangeAmount, currency)}. It cannot be authorised until they agree
          {change.status === "proposed"
            ? " — return it to draft and adjust the affected drivers"
            : " — adjust the affected drivers"}
          .
        </Notice>
      )}
      {d.reconciled === true && change.status !== "authorised" && (
        <Notice tone="success">Reconciled: the proposed drivers deliver the stated change.</Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Change">
          <KeyValues
            items={[
              [
                "Current version",
                <span key="f">
                  <VersionBadge
                    kind="value_case"
                    status={d.fromVersion.status}
                    versionNumber={d.fromVersion.versionNumber}
                  />
                </span>,
              ],
              [
                "Proposed version",
                <span key="t">
                  <VersionBadge
                    kind="value_case"
                    status={d.toVersion.status}
                    versionNumber={d.toVersion.versionNumber}
                  />
                </span>,
              ],
              ["Reason", change.reason ?? "—"],
              ["Economic impact", change.economicImpactNarrative ?? "—"],
              [
                "Originating review",
                d.review ? (
                  <TextLink key="r" href={`${base}/assurance/${d.review.id}`}>
                    Review #{d.review.sequence}
                  </TextLink>
                ) : (
                  "—"
                ),
              ],
              [
                "Originating decision",
                change.decisionId ? (
                  d.review ? (
                    <TextLink key="dd" href={`${base}/assurance/${d.review.id}#decision`}>
                      Client decision
                    </TextLink>
                  ) : (
                    "Recorded"
                  )
                ) : (
                  "—"
                ),
              ],
              ["Value Case Owner", d.vco?.name ?? "Not nominated"],
              ["Prepared by", `${d.createdBy?.name ?? "—"} · ${formatDateTime(change.createdAt)}`],
              ...(change.proposedAt
                ? ([["Proposed", `${formatDateTime(change.proposedAt)} by ${d.proposedBy?.name ?? "—"}`]] as [
                    string,
                    string,
                  ][])
                : []),
            ]}
          />
          {change.status === "draft" && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <ActionForm action={updateValueChangeAction}>
                <Hidden name="projectId" value={projectId} />
                <Hidden name="changeId" value={change.id} />
                <div className="space-y-2">
                  <FormGrid>
                    <TextField name="code" label="Code" required defaultValue={change.code} />
                    <MoneyField
                      name="statedChangeAmount"
                      label="Stated change"
                      currency={currency}
                      defaultValue={moneyInputValue(change.statedChangeAmount)}
                    />
                  </FormGrid>
                  <TextArea name="reason" label="Reason (required to propose)" rows={2} defaultValue={change.reason} />
                  <TextArea
                    name="economicImpactNarrative"
                    label="Economic impact"
                    rows={2}
                    defaultValue={change.economicImpactNarrative}
                  />
                  <SubmitButton variant="secondary">Save change</SubmitButton>
                </div>
              </ActionForm>
            </div>
          )}
        </Section>

        {(change.status === "authorised" || change.status === "rejected" || change.status === "withdrawn") && (
          <Section title={change.status === "authorised" ? "VCO authorisation" : "Closure"}>
            <div data-testid="change-authorisation">
              {change.status === "authorised" ? (
                <KeyValues
                  items={[
                    ["Authorised by (VCO)", d.authoriser?.name ?? "—"],
                    ["Authorisation date", formatDate(change.authorisedOn)],
                    [
                      "Evidence",
                      d.evidence ? (
                        <TextLink key="e" href={`${base}/evidence/${d.evidence.id}`}>
                          {d.evidence.code} {d.evidence.title}
                        </TextLink>
                      ) : (
                        "—"
                      ),
                    ],
                    ["Note", change.authorisationNote ?? "—"],
                    [
                      "Recorded by (consultant)",
                      `${d.recordedBy?.name ?? "—"} (${d.recordedBy?.email ?? ""}) · ${formatDateTime(change.authorisationRecordedAt)}`,
                    ],
                  ]}
                />
              ) : (
                <KeyValues
                  items={[
                    ["Note", change.closureNote ?? "—"],
                    ["Recorded by", `${d.closedBy?.name ?? "—"} · ${formatDateTime(change.closedAt)}`],
                  ]}
                />
              )}
            </div>
          </Section>
        )}
      </div>

      <Section
        title="Affected Value Drivers"
        description={`V${d.fromVersion.versionNumber} against proposed V${d.toVersion.versionNumber}. Changed drivers are highlighted.`}
      >
        <Table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Driver</th>
              <th className="text-right">V{d.fromVersion.versionNumber}</th>
              <th className="text-right">V{d.toVersion.versionNumber}</th>
              <th className="text-right">Change</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {d.driverRows.map((r) => (
              <tr
                key={r.valueDriverId}
                className={r.changed ? "bg-amber-50" : undefined}
                data-testid="change-driver-row"
              >
                <td className="font-mono">{r.code}</td>
                <td className="font-medium">{r.name}</td>
                <td className="text-right">
                  {r.inFrom ? (r.fromValue === null ? "Non-financial" : formatMoneyShort(r.fromValue, currency)) : "—"}
                </td>
                <td className="text-right">
                  {r.inTo ? (r.toValue === null ? "Non-financial" : formatMoneyShort(r.toValue, currency)) : "Removed"}
                </td>
                <td className="text-right">{r.change ? formatMoneyChange(r.change, currency) : "—"}</td>
                <td>
                  {r.changed && (
                    <PlainBadge tone="amber">{!r.inFrom ? "New" : !r.inTo ? "Removed" : "Changed"}</PlainBadge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        {change.status === "draft" && (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-slate-500">
              Edit only the drivers affected by this change. V{d.fromVersion.versionNumber} is never modified.
            </p>
            {d.toDrivers.map((drv) => (
              <DriverEditor key={drv.driverVersionId} driver={drv} ctx={ctx} adjustment={VALUE_CHANGE_ADJUSTMENT} />
            ))}
            <AddDriverForm
              versionId={d.toVersion.id}
              ctx={ctx}
              nextCode={nextCode(
                register.entries.map((e) => e.driver.code),
                "VD",
              )}
              sortOrder={d.toDrivers.length + 1}
            />
          </div>
        )}
        {change.status === "draft" && includable.length > 0 && (
          <div
            className="mt-4 rounded border border-dashed border-violet-300 bg-violet-50 p-3"
            data-testid="includable-drivers"
          >
            <h3 className="text-sm font-semibold text-violet-900">Include an existing Value Driver</h3>
            <p className="mb-2 text-xs text-violet-800">
              This adds the driver to the proposed Value Case only. It does not alter the current Authorised Value Case.
              It starts from the driver&apos;s working record — its working estimate becomes the proposed financial
              value, to reconcile and edit here like any other driver.
            </p>
            <ul className="space-y-1 text-sm">
              {includable.map((e) => (
                <li
                  key={e.driver.id}
                  className="flex flex-wrap items-center justify-between gap-2"
                  data-testid="includable-driver"
                >
                  <span>
                    <span className="font-mono text-slate-500">{e.driver.code}</span> {e.working?.name} ·{" "}
                    <WorkingEstimate value={e.working?.workingEstimate} currency={currency} />
                  </span>
                  <ActionForm
                    action={includeDriverAction}
                    confirm={`Add ${e.driver.code} to proposed V${d.toVersion.versionNumber}? The current Authorised Value Case is not changed.`}
                  >
                    <Hidden name="projectId" value={projectId} />
                    <Hidden name="changeId" value={change.id} />
                    <Hidden name="valueDriverId" value={e.driver.id} />
                    <SubmitButton variant="secondary">Include in proposed Value Case</SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {trajectory && (
        <Section
          id="trajectory"
          title={`V${d.toVersion.versionNumber} Value Basis and planned value`}
          description={`The proposed commitment's basis, Value Period and value milestones. V${d.fromVersion.versionNumber} stays exactly as authorised.`}
        >
          <VersionTrajectorySection
            projectId={projectId}
            currency={currency}
            authoring={trajectory}
            project={project}
          />
        </Section>
      )}

      {change.status === "draft" && (
        <Section title="Propose to the Value Case Owner" tone="muted">
          <div className="flex flex-wrap gap-3">
            <ActionForm
              action={proposeValueChangeAction}
              confirm={`Propose ${change.code} to the VCO? V${d.toVersion.versionNumber} will be locked.`}
            >
              <Hidden name="projectId" value={projectId} />
              <Hidden name="changeId" value={change.id} />
              <SubmitButton disabled={!change.reason} title={!change.reason ? "Record the reason first" : undefined}>
                Propose {change.code}
              </SubmitButton>
            </ActionForm>
          </div>
          <WithdrawForm projectId={projectId} changeId={change.id} code={change.code} />
        </Section>
      )}

      {change.status === "proposed" && (
        <Section id="authorise" title="Record the VCO's decision">
          <div
            className="mb-4 rounded border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900"
            data-testid="change-authorisation-statement"
          >
            <strong>You ({actor?.email ?? "consultant"})</strong> are <strong>recording</strong> the decision. The{" "}
            <strong>Value Case Owner{d.vco ? `, ${d.vco.name},` : ""}</strong> is the person who authorises, rejects or
            returns this change.
          </div>
          {!d.vco ? (
            <Notice tone="warning">
              Nominate the Value Case Owner in <TextLink href={`${base}/setup#stakeholders`}>Mobilisation</TextLink>{" "}
              first.
            </Notice>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <ActionForm
                action={authoriseValueChangeAction}
                confirm={`Record that ${d.vco.name} (VCO) authorised ${change.code}? V${d.toVersion.versionNumber} becomes the Authorised Value Case and V${d.fromVersion.versionNumber} is superseded.`}
                testId="authorise-change-form"
              >
                <Hidden name="projectId" value={projectId} />
                <Hidden name="changeId" value={change.id} />
                <Hidden name="authorisedByPersonId" value={d.vco.id} />
                <div className="space-y-3">
                  <p className="text-sm">
                    Authorised by: <strong>{d.vco.name}</strong> (Value Case Owner)
                  </p>
                  <DateField name="authorisedOn" label="Date the VCO authorised" required defaultValue={today()} />
                  <SelectField
                    name="authorisationEvidenceId"
                    label="Authorisation evidence"
                    required
                    placeholder="— Choose evidence —"
                    options={ctx.evidence}
                  />
                  <TextArea name="authorisationNote" label="Note" rows={2} />
                  <SubmitButton
                    variant="authorise"
                    disabled={!canAuthorise}
                    title={!canAuthorise ? "The proposed drivers do not reconcile to the stated change" : undefined}
                  >
                    Record authorisation — create Authorised V{d.toVersion.versionNumber}
                  </SubmitButton>
                </div>
              </ActionForm>
              <div className="rounded border border-slate-200 p-3">
                <h3 className="mb-2 text-sm font-semibold">Record authorisation evidence</h3>
                <ActionForm action={recordEvidenceAction} resetOnSuccess testId="change-evidence-form">
                  <Hidden name="projectId" value={projectId} />
                  <div className="space-y-2">
                    <FormGrid>
                      <TextField
                        name="code"
                        label="Code"
                        required
                        defaultValue={nextEvidenceCode(evidence.map((e) => e.code))}
                      />
                      <DateField name="evidenceDate" label="Evidence date" defaultValue={today()} />
                    </FormGrid>
                    <TextField
                      name="title"
                      label="Title"
                      required
                      defaultValue={`VCO authorisation of ${change.code}`}
                    />
                    <TextArea name="summary" label="Summary" rows={2} />
                    <SubmitButton variant="secondary">Record evidence</SubmitButton>
                  </div>
                </ActionForm>
              </div>
            </div>
          )}
          <div className="mt-6 grid gap-4 border-t border-slate-200 pt-4 lg:grid-cols-3">
            <ActionForm action={returnValueChangeAction} confirm={`Return ${change.code} to draft for revision?`}>
              <Hidden name="projectId" value={projectId} />
              <Hidden name="changeId" value={change.id} />
              <p className="mb-2 text-sm">The VCO asked for changes:</p>
              <SubmitButton variant="secondary">Return to draft</SubmitButton>
            </ActionForm>
            <ActionForm
              action={rejectValueChangeAction}
              confirm={`Record that the VCO rejected ${change.code}? This is permanent.`}
            >
              <Hidden name="projectId" value={projectId} />
              <Hidden name="changeId" value={change.id} />
              <TextField name="closureNote" label="Why the VCO rejected it" required />
              <div className="mt-2">
                <SubmitButton variant="danger">Record rejection</SubmitButton>
              </div>
            </ActionForm>
            <WithdrawForm projectId={projectId} changeId={change.id} code={change.code} />
          </div>
        </Section>
      )}
    </>
  );
}

function WithdrawForm({ projectId, changeId, code }: { projectId: string; changeId: string; code: string }) {
  return (
    <div className="mt-3">
      <ActionForm action={withdrawValueChangeAction} confirm={`Withdraw ${code}? This is permanent.`}>
        <Hidden name="projectId" value={projectId} />
        <Hidden name="changeId" value={changeId} />
        <TextField name="closureNote" label="Why it is withdrawn" required />
        <div className="mt-2">
          <SubmitButton variant="danger">Withdraw</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}

function Figure({ label, value, note, testId }: { label: string; value: string; note?: string; testId: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold" data-testid={testId}>
        {value}
      </p>
      {note && <p className="text-xs text-slate-500">{note}</p>}
    </div>
  );
}

/**
 * 4D.10E: on a Value Change the governed explanation is the change's own reason (required at proposal). A
 * driver-level reason is optional — useful when several drivers move for different reasons.
 */
const VALUE_CHANGE_ADJUSTMENT = {
  label: "Why this driver changes (optional)",
  hint: "The Value Change reason explains the change as a whole and is required at proposal. Add a driver-level reason when drivers move for different reasons.",
  required: false,
};
