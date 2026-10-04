import { Fragment } from "react";

import { EVIDENCE_STATUSES, QUALIFICATION_STATUSES } from "@/domain/statuses";
import { proposalChecklist } from "@/domain/mobilisation";
import {
  classifyDefinitionChange,
  definitionRationaleRequired,
  hasRationale,
  moneyChange,
  type DefinitionChange,
} from "@/domain/value-case";
import { recordEvidenceAction } from "@/server/actions/evidence";
import {
  authoriseInitialVersionAction,
  createDraftVersionAction,
  proposeVersionAction,
  returnVersionToDraftAction,
  setNotCarriedForwardAction,
} from "@/server/actions/value-case";
import { getCurrentActor } from "@/server/auth/actor";
import { nextEvidenceCode } from "@/server/queries/evidence";
import { listEvidenceOptions } from "@/server/queries/information-request";
import { listStakeholders } from "@/server/queries/mobilise";
import { getMobilisationStatus } from "@/server/queries/projects";
import { getVersionTrajectoryAuthoring } from "@/server/queries/trajectory";
import { getRequalificationWorkspace, type ComparisonRow } from "@/server/queries/value-case";
import { ActionForm, SubmitButton } from "@/ui/components/action-form";
import { EvidenceBadge, NonFinancialBadge, PlainBadge, QualificationBadge, VersionBadge } from "@/ui/components/badges";
import { DateField, FormGrid, Hidden, SelectField, TextArea, TextField } from "@/ui/components/fields";
import { Empty, Missing, Notice, Section, Table, TextLink } from "@/ui/components/layout";
import { reportPreviewHref } from "@/ui/reports/routes";
import { formatDate, formatMoneyChange, formatMoneyShort } from "@/ui/format";
import { VersionTrajectorySection } from "@/ui/trajectory/milestones";
import { requireProject } from "@/ui/require";
import { AddDriverForm, DriverEditor, DriverReadOnly, DriverValue } from "@/ui/value-case/drivers";

export const metadata = { title: "Value Case Definition" };

const today = () => new Date().toISOString().slice(0, 10);

export default async function RequalificationPage({ params }: PageProps<"/projects/[projectId]/requalification">) {
  const { projectId } = await params;
  const { project, valueCase } = await requireProject(projectId);
  const [ws, stakeholders, evidence, actor, mobilisation] = await Promise.all([
    getRequalificationWorkspace(projectId),
    listStakeholders(projectId),
    listEvidenceOptions(projectId),
    getCurrentActor().catch(() => null),
    getMobilisationStatus(projectId).then((m) => m!),
  ]);
  // One derivation for the facts shared with Mobilisation (Value Basis, VCO, drivers, counts) — 4D.10D.
  // 4D.10E: governed movement rationale. Only a RECORDED Original Business Case is a governed baseline.
  const baseline = ws.inheritedVersion?.status === "recorded" ? ws.inheritedDrivers : [];
  const counterpart = (driverId: string) => baseline.find((b) => b.valueDriverId === driverId) ?? null;
  const exclusionOf = (driverId: string) => ws.exclusions.find((x) => x.valueDriverId === driverId) ?? null;
  const missingRationale = [
    ...ws.requalifiedDrivers.filter(
      (d) => definitionRationaleRequired(counterpart(d.valueDriverId), d) && !hasRationale(d.adjustmentRationale),
    ),
    ...baseline.filter(
      (b) =>
        !ws.requalifiedDrivers.some((d) => d.valueDriverId === b.valueDriverId) &&
        definitionRationaleRequired(b, null) &&
        !exclusionOf(b.valueDriverId),
    ),
  ]
    .map((d) => d.code)
    .sort();
  const checklist = proposalChecklist(mobilisation.facts, {
    missingRationale: ws.requalifiedVersion ? missingRationale : [],
  });
  const blocked = checklist.find((c) => c.blocking && !c.ok) ?? null;
  const obc = ws.inheritedVersion;
  const v1FromOriginal = Boolean(obc && ws.requalifiedVersion?.basedOnVersionId === obc.id);
  const currency = project.currency;
  const v1 = ws.requalifiedVersion;
  const trajectory = v1 ? await getVersionTrajectoryAuthoring(projectId, v1.id) : null;
  const s = ws.requalifiedSummary;
  const vco = stakeholders.find((p) => p.personId === valueCase.vcoPersonId) ?? null;
  const base = `/projects/${projectId}`;
  const ctx = {
    projectId,
    currency,
    stakeholders: stakeholders.map((p) => ({ value: p.personId, label: p.name })),
    evidence: evidence.map((e) => ({ value: e.id, label: `${e.code} ${e.title}` })),
  };
  const v1Total = v1 && s.driverCount > 0 ? s.financialTotal : null;
  const change = moneyChange(ws.inheritedTotal, v1Total);

  return (
    <>
      <StateBanner status={v1?.status ?? null} versionNumber={v1?.versionNumber ?? 1} />
      <p className="-mt-2 mb-4 text-sm text-slate-600 print:hidden" data-testid="requal-role">
        Value Case Definition turns the Original Business Case into the initial defensible Value Case and Authorised V1.
        For ongoing Value Driver assessment, use{" "}
        <TextLink href={`/projects/${projectId}/value-drivers`}>Value Drivers</TextLink>.
        {v1 && (
          <>
            {" "}
            · <TextLink href={reportPreviewHref(projectId, "requalification", v1.id)}>Re-Qualification Report</TextLink>
          </>
        )}
      </p>

      {/* ---- Headline comparison -------------------------------------------------- */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3" data-testid="requal-headline">
        <Stat
          label="Original Business Case"
          value={formatMoneyShort(ws.inheritedTotal, currency)}
          sub={
            ws.inheritedVersion ? (
              <VersionBadge kind="inherited_business_case" status={ws.inheritedVersion.status} versionNumber={0} />
            ) : (
              <Missing>Not captured</Missing>
            )
          }
          testId="requal-inherited-total"
        />
        <Stat
          label={v1?.status === "authorised" ? "Authorised Value Case (V1)" : "Draft Value Case (V1)"}
          value={formatMoneyShort(v1Total, currency)}
          sub={
            v1 ? (
              <span className="inline-flex flex-wrap items-center gap-1">
                <VersionBadge kind="value_case" status={v1.status} versionNumber={v1.versionNumber} />
                {s.nonFinancialCount > 0 && (
                  <span className="text-xs text-slate-500">
                    + {s.nonFinancialCount} <NonFinancialBadge />
                  </span>
                )}
              </span>
            ) : (
              <Missing>Not started</Missing>
            )
          }
          testId="requal-v1-total"
          emphasis
        />
        <Stat
          label="Change from the Original Business Case"
          value={formatMoneyChange(change, currency)}
          sub={
            <span className="text-xs text-slate-500">
              {change === null ? "Needs both totals" : "V1 financial total − Original Business Case stated total"}
            </span>
          }
          testId="requal-change"
        />
      </div>

      {v1 && (
        <div className="mb-6 grid gap-3 text-sm sm:grid-cols-3" data-testid="requal-status-counts">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="mb-1 text-slate-500">
              Value Drivers: <strong className="text-slate-900">{s.driverCount}</strong> ({s.financialCount} financial,{" "}
              {s.nonFinancialCount} non-financial)
            </p>
            <p className="text-xs text-slate-500">
              {s.withoutAvo > 0 ? <Missing>{s.withoutAvo} without an AVO</Missing> : "All drivers have an AVO"}
            </p>
            <p className="text-xs text-slate-500">
              {s.withoutEvidenceLinks > 0 ? (
                <Missing>{s.withoutEvidenceLinks} with no linked evidence</Missing>
              ) : (
                "All drivers have linked evidence"
              )}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="mb-1 text-slate-500">Qualification</p>
            <div className="flex flex-wrap gap-2">
              {QUALIFICATION_STATUSES.map((q) => (
                <span key={q} className="inline-flex items-center gap-1" data-testid={`count-${q}`}>
                  <QualificationBadge status={q} /> {s.qualification[q]}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="mb-1 text-slate-500">Evidence status</p>
            <div className="flex flex-wrap gap-2">
              {EVIDENCE_STATUSES.map((e) => (
                <span key={e} className="inline-flex items-center gap-1">
                  <EvidenceBadge status={e} /> {s.evidence[e]}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ---- No V1 yet: entry into Value Case Definition (4D.10D) ------------------- */}
      {!v1 && (
        <Section
          title="Start Value Case Definition"
          description="V1 will become Cardaxia's first governed Value Case: assessed, adjusted and qualified here, then proposed as a whole for the Value Case Owner's authorisation."
        >
          <div data-testid="definition-entry" data-baseline={obc?.status ?? "none"}>
            {obc?.status === "recorded" && (
              <Notice tone="info" title="Starting from the recorded Original Business Case">
                {ws.inheritedDrivers.length > 0 ? (
                  <>
                    Its {ws.inheritedDrivers.length} {ws.inheritedDrivers.length === 1 ? "driver" : "drivers"} (
                    {ws.inheritedDrivers.map((d) => d.code).join(", ")}) will be copied into the draft V1 as the
                    starting point, keeping the same Value Drivers. You then assess, adjust and add to them. The
                    Original Business Case itself is never changed.
                  </>
                ) : (
                  <>
                    It records a headline value only, so V1 starts with no drivers; the headline remains the comparison
                    reference. The Original Business Case itself is never changed.
                  </>
                )}
              </Notice>
            )}
            {obc === null && (
              <Notice tone="warning" title="No Original Business Case baseline has been recorded">
                You can start V1 without one, but there will be no Original Business Case to compare against.{" "}
                <TextLink href={`${base}/value-case`}>Capture the Original Business Case first</TextLink> if one exists
                — its drivers then become V1&apos;s starting point.
              </Notice>
            )}
            {obc?.status === "draft" && (
              <Notice tone="warning" title="The Original Business Case is still being captured">
                Record it first to use it as V1&apos;s starting point:{" "}
                <TextLink href={`${base}/value-case/v/0`}>finish and record the Original Business Case</TextLink>. If
                you create V1 now, it starts empty and the Original Business Case drivers are not copied into it.
              </Notice>
            )}
          </div>
          <ActionForm action={createDraftVersionAction} testId="create-v1-form">
            <Hidden name="projectId" value={projectId} />
            {obc?.status === "recorded" && <Hidden name="basedOnVersionId" value={obc.id} />}
            <div className="space-y-3">
              <TextField name="title" label="Title" required defaultValue="Value Case" />
              <TextArea name="summary" label="Summary" rows={2} />
              <SubmitButton>
                {obc?.status === "recorded" ? "Create draft V1 from the Original Business Case" : "Create draft V1"}
              </SubmitButton>
            </div>
          </ActionForm>
        </Section>
      )}

      {/* ---- Comparison ----------------------------------------------------------- */}
      {v1 && (
        <Section
          title={`Original Business Case vs ${v1.status === "authorised" ? "Authorised" : v1.status === "superseded" ? "Superseded" : "Proposed"} Value Case V1`}
          description="Per Value Driver, matched by the same Value Driver across the two. Unchanged, adjusted, new and not-carried-forward drivers are labelled; nothing has to reconcile."
        >
          {obc && !v1FromOriginal && (
            <Notice tone="warning" title="V1 was not created from the Original Business Case">
              V1 was created before the Original Business Case was recorded, so none of its drivers were copied from it.
              Drivers are compared only where the Original Business Case records a value against the same Value Driver.
            </Notice>
          )}
          {!obc && (
            <p className="mb-2 text-sm text-slate-600" data-testid="comparison-no-baseline">
              No Original Business Case baseline has been recorded, so every driver is new in V1.
            </p>
          )}
          {ws.comparison.length === 0 ? (
            <Empty>No Value Drivers yet.</Empty>
          ) : (
            <>
              <DefinitionCounts rows={ws.comparison} />
              <ComparisonTable
                projectId={projectId}
                v1={v1}
                baselineRecorded={ws.inheritedVersion?.status === "recorded"}
                exclusions={ws.exclusions}
                rows={ws.comparison}
                currency={currency}
                inheritedTotal={ws.inheritedTotal}
                v1Total={v1Total}
              />
            </>
          )}
        </Section>
      )}

      {/* ---- Driver detail -------------------------------------------------------- */}
      {v1 && (
        <Section
          title={`V${v1.versionNumber} Value Drivers`}
          description={
            v1.status === "draft"
              ? "Select Edit on a driver to assess, adjust or qualify it; add drivers for value the Original Business Case does not represent. Incomplete qualification is visible but does not block proposal."
              : "Read-only."
          }
        >
          <div className="space-y-2">
            {ws.requalifiedDrivers.map((d) =>
              v1.status === "draft" ? (
                <DriverEditor
                  key={d.driverVersionId}
                  driver={d}
                  ctx={ctx}
                  adjustment={
                    counterpart(d.valueDriverId)
                      ? {
                          label: "Why the value differs from the Original Business Case",
                          hint: "Governed adjustment rationale — required at proposal when the value differs from the recorded Original Business Case. How the value is calculated stays in the rationale above.",
                          required: definitionRationaleRequired(counterpart(d.valueDriverId), d),
                        }
                      : {
                          label: "Why this value is introduced",
                          hint: "Governed rationale for introducing this value into the first governed Value Case (there is no recorded Original Business Case counterpart) — required at proposal for a financial value.",
                          required: definitionRationaleRequired(null, d),
                        }
                  }
                />
              ) : (
                <DriverReadOnly key={d.driverVersionId} driver={d} currency={currency} projectId={projectId} />
              ),
            )}
            {v1.status === "draft" && (
              <AddDriverForm
                versionId={v1.id}
                nextCode={ws.nextDriverCode}
                ctx={ctx}
                sortOrder={ws.requalifiedDrivers.length + 1}
              />
            )}
          </div>
        </Section>
      )}

      {/* ---- Value Basis and planned value (Phase 4D.9D) ------------------------- */}
      {v1 && trajectory && (
        <Section
          id="trajectory"
          title={`V${v1.versionNumber} Value Basis and planned value`}
          description="The economic basis, Value Period and dated value milestones of this commitment. Optional; nothing is generated."
        >
          <VersionTrajectorySection
            projectId={projectId}
            currency={currency}
            authoring={trajectory}
            project={project}
          />
        </Section>
      )}

      {/* ---- State transitions ---------------------------------------------------- */}
      {v1?.status === "draft" && (
        <Section title="Propose Value Case V1" tone="muted">
          <p className="mb-3 text-sm text-slate-800" data-testid="propose-explanation">
            This submits the <strong>complete proposed Value Case</strong>, including{" "}
            {s.driverCount === 1 ? "its one driver" : `all ${s.driverCount} of its drivers`}, for the Value Case
            Owner&apos;s authorisation. Drivers are not submitted individually — every driver above is part of this
            proposal.
          </p>
          <ul className="mb-3 space-y-1 text-sm" data-testid="propose-checklist">
            {checklist.map((c) => (
              <Check
                key={c.key}
                ok={c.ok}
                label={c.label}
                required={c.blocking}
                fix={c.fix ? `${base}/${c.fix}` : undefined}
              />
            ))}
          </ul>
          <p className="mb-3 text-sm text-slate-600">
            Proposing locks the draft and locks the project&apos;s currency and Value Basis. You can return a proposed
            version to draft if changes are needed before authorisation.
          </p>
          <ActionForm
            action={proposeVersionAction}
            confirm={`Propose Value Case V1 — the complete Value Case with ${s.driverCount} ${s.driverCount === 1 ? "driver" : "drivers"} — for VCO authorisation? The draft will be locked.`}
          >
            <Hidden name="projectId" value={projectId} />
            <Hidden name="versionId" value={v1.id} />
            <SubmitButton disabled={blocked !== null} title={blocked ? `${blocked.label} first` : undefined}>
              Propose Value Case V1
            </SubmitButton>
          </ActionForm>
        </Section>
      )}

      {v1?.status === "proposed" && (
        <Section id="authorise" title="Record VCO authorisation">
          <div
            className="mb-4 rounded border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900"
            data-testid="authorisation-statement"
          >
            <p>
              <strong>You ({actor?.email ?? "consultant"})</strong> are <strong>recording</strong> an authorisation. The{" "}
              <strong>Value Case Owner</strong>
              {vco ? (
                <>
                  , <strong>{vco.name}</strong>,
                </>
              ) : null}{" "}
              is the person who authorises the Value Case. Attach the evidence of their authorisation (signed notice,
              email, meeting record).
            </p>
          </div>

          {!vco ? (
            <Notice tone="warning" title="No Value Case Owner">
              Nominate the VCO in <TextLink href={`${base}/setup#stakeholders`}>Mobilisation</TextLink> before recording
              authorisation.
            </Notice>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <ActionForm
                action={authoriseInitialVersionAction}
                confirm={`Record that ${vco.name} (Value Case Owner) authorised V${v1.versionNumber}? It becomes the Authorised Value Case and is permanently read-only.`}
                testId="authorise-form"
              >
                <Hidden name="projectId" value={projectId} />
                <Hidden name="versionId" value={v1.id} />
                <Hidden name="authorisedByPersonId" value={vco.personId} />
                <div className="space-y-3">
                  <p className="text-sm">
                    Authorised by: <strong data-testid="authoriser-name">{vco.name}</strong> (Value Case Owner)
                  </p>
                  <DateField name="authorisedOn" label="Date the VCO authorised" required defaultValue={today()} />
                  <SelectField
                    name="authorisationEvidenceId"
                    label="Authorisation evidence"
                    required
                    placeholder="— Choose evidence —"
                    options={ctx.evidence}
                    hint="Record it alongside if it is not in the register yet"
                  />
                  <TextArea name="authorisationNote" label="Note" rows={2} />
                  <SubmitButton variant="authorise">Record authorisation — create Authorised V1</SubmitButton>
                </div>
              </ActionForm>

              <div className="rounded border border-slate-200 p-3">
                <h3 className="mb-2 text-sm font-semibold">Record authorisation evidence</h3>
                <ActionForm action={recordEvidenceAction} resetOnSuccess testId="authorisation-evidence-form">
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
                      defaultValue={`VCO authorisation of V${v1.versionNumber}`}
                    />
                    <TextArea
                      name="summary"
                      label="Summary"
                      rows={2}
                      placeholder="e.g. Signed Value Case authorisation notice; email from VCO dated …"
                    />
                    <SelectField
                      name="sourcePersonId"
                      label="Source"
                      defaultValue={vco.personId}
                      options={ctx.stakeholders}
                    />
                    <SubmitButton variant="secondary">Record evidence</SubmitButton>
                  </div>
                </ActionForm>
              </div>
            </div>
          )}

          <div className="mt-6 border-t border-slate-200 pt-4">
            <ActionForm
              action={returnVersionToDraftAction}
              confirm="Return V1 to draft? It will need to be proposed again."
            >
              <Hidden name="projectId" value={projectId} />
              <Hidden name="versionId" value={v1.id} />
              <SubmitButton variant="secondary">Return to draft</SubmitButton>
            </ActionForm>
          </div>
        </Section>
      )}

      {v1?.status === "authorised" && (
        <Section title="Authorisation">
          <p className="text-sm">
            Authorised by the Value Case Owner on <strong>{formatDate(v1.authorisedOn)}</strong>.{" "}
            <TextLink href={`${base}/value-case/v/${v1.versionNumber}`}>View Authorised V{v1.versionNumber}</TextLink> ·{" "}
            <TextLink href={`${base}/value-case/v/0`}>View Original Business Case</TextLink>
          </p>
        </Section>
      )}
    </>
  );
}

function StateBanner({ status, versionNumber }: { status: string | null; versionNumber: number }) {
  const banners: Record<string, { cls: string; title: string; body: string }> = {
    none: {
      cls: "border-slate-300 bg-white text-slate-800",
      title: "Value Case Definition not started",
      body: "Turn the Original Business Case into a structured, defensible Value Case.",
    },
    draft: {
      cls: "border-amber-300 bg-amber-50 text-amber-900",
      title: `Draft Value Case (V${versionNumber}) — editable`,
      body: "Work in progress. Not yet proposed to the Value Case Owner.",
    },
    proposed: {
      cls: "border-sky-300 bg-sky-50 text-sky-900",
      title: `Proposed Value Case (V${versionNumber}) — locked, awaiting VCO authorisation`,
      body: "Record the VCO's authorisation, or return it to draft for changes.",
    },
    authorised: {
      cls: "border-emerald-400 bg-emerald-50 text-emerald-900",
      title: `Authorised Value Case V${versionNumber} — read-only`,
      body: "Management-approved. Preserved permanently; later changes require an approved Value Change.",
    },
    // 4D.10B: once a Value Change is authorised V1 is superseded — the definition is complete, never "not started".
    superseded: {
      cls: "border-slate-300 bg-slate-50 text-slate-800",
      title: `Authorised Value Case V${versionNumber} — superseded by an authorised Value Change`,
      body: "Value Case Definition is complete and preserved. The Value Case in force is shown on the Value Case page.",
    },
  };
  const b = banners[status ?? "none"] ?? banners.none!;
  return (
    <div className={`mb-6 rounded-lg border-2 px-4 py-3 ${b.cls}`} data-testid="requal-state">
      <p className="font-semibold">{b.title}</p>
      <p className="text-sm">{b.body}</p>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  testId,
  emphasis,
}: {
  label: string;
  value: string;
  sub: React.ReactNode;
  testId: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`rounded-lg border bg-white p-4 ${emphasis ? "border-slate-400" : "border-slate-200"}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-slate-900" data-testid={testId}>
        {value}
      </p>
      <div className="mt-1">{sub}</div>
    </div>
  );
}

function Check({ ok, label, required, fix }: { ok: boolean; label: string; required?: boolean; fix?: string }) {
  return (
    <li className={ok ? "text-emerald-800" : required ? "text-red-700" : "text-amber-800"}>
      {ok ? "✓" : required ? "✗" : "⚠"} {label}
      {required && !ok && " — required"}
      {!ok && fix && (
        <>
          {" "}
          <TextLink href={fix}>Fix</TextLink>
        </>
      )}
    </li>
  );
}

function ComparisonTable({
  projectId,
  v1,
  baselineRecorded,
  exclusions,
  rows,
  currency,
  inheritedTotal,
  v1Total,
}: {
  projectId: string;
  v1: { id: string; status: string };
  baselineRecorded: boolean;
  exclusions: { valueDriverId: string; adjustmentRationale: string }[];
  rows: ComparisonRow[];
  currency: string;
  inheritedTotal: string | null;
  v1Total: string | null;
}) {
  return (
    <Table>
      <thead>
        <tr>
          <th>Code</th>
          <th>Value Driver</th>
          <th className="text-right">Original Business Case</th>
          <th className="text-right">Value Case V1</th>
          <th className="text-right">Change</th>
          <th>Qualification</th>
          <th>Evidence</th>
          <th>AVO</th>
          <th>Definition</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Fragment key={r.driverId}>
            <tr data-testid="comparison-row" data-change={classifyDefinitionChange(r.inherited, r.requalified)}>
              <td className="font-mono">{r.code}</td>
              <td className="font-medium">{r.name}</td>
              <td className="text-right whitespace-nowrap text-slate-500">
                {r.inherited ? <DriverValue driver={r.inherited} currency={currency} /> : "—"}
              </td>
              <td className="text-right font-semibold whitespace-nowrap" data-testid="comparison-v1-value">
                {r.requalified ? <DriverValue driver={r.requalified} currency={currency} /> : "—"}
              </td>
              <td className="text-right whitespace-nowrap">
                {r.inherited && r.requalified
                  ? formatMoneyChange(moneyChange(r.inherited.financialValue, r.requalified.financialValue), currency)
                  : "—"}
              </td>
              <td>{r.requalified && <QualificationBadge status={r.requalified.qualificationStatus} />}</td>
              <td>{r.requalified && <EvidenceBadge status={r.requalified.evidenceStatus} />}</td>
              <td>{r.requalified ? (r.requalified.avoName ?? <span className="text-amber-700">—</span>) : ""}</td>
              <td>
                <DefinitionBadge change={classifyDefinitionChange(r.inherited, r.requalified)} />
              </td>
            </tr>
            <RationaleRow
              row={r}
              projectId={projectId}
              v1={v1}
              baselineRecorded={baselineRecorded}
              exclusion={exclusions.find((x) => x.valueDriverId === r.driverId) ?? null}
            />
          </Fragment>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-slate-300 font-semibold">
          <td />
          <td className="px-2 py-1.5">Total (financial drivers; Original Business Case = stated total)</td>
          <td className="px-2 py-1.5 text-right">{formatMoneyShort(inheritedTotal, currency)}</td>
          <td className="px-2 py-1.5 text-right">{formatMoneyShort(v1Total, currency)}</td>
          <td className="px-2 py-1.5 text-right">
            {formatMoneyChange(moneyChange(inheritedTotal, v1Total), currency)}
          </td>
          <td colSpan={4} />
        </tr>
      </tfoot>
    </Table>
  );
}

/** Consultant-readable relation of a proposed V1 driver to the Original Business Case (4D.10D). */
const DEFINITION_LABELS: Record<DefinitionChange, { label: string; tone: "slate" | "amber" | "sky" | "red" }> = {
  unchanged: { label: "Carried forward · unchanged", tone: "slate" },
  adjusted: { label: "Carried forward · adjusted", tone: "amber" },
  new: { label: "New in V1", tone: "sky" },
  not_carried_forward: { label: "Not carried into V1", tone: "red" },
};

function DefinitionBadge({ change }: { change: DefinitionChange }) {
  const { label, tone } = DEFINITION_LABELS[change];
  return <PlainBadge tone={tone}>{label}</PlainBadge>;
}

function DefinitionCounts({ rows }: { rows: ComparisonRow[] }) {
  const counts = rows.reduce<Record<DefinitionChange, number>>(
    (acc, r) => ({
      ...acc,
      [classifyDefinitionChange(r.inherited, r.requalified)]:
        acc[classifyDefinitionChange(r.inherited, r.requalified)] + 1,
    }),
    { unchanged: 0, adjusted: 0, new: 0, not_carried_forward: 0 },
  );
  return (
    <p className="mb-2 flex flex-wrap gap-2 text-sm" data-testid="definition-counts">
      {(Object.keys(DEFINITION_LABELS) as DefinitionChange[]).map((k) => (
        <span key={k} className="inline-flex items-center gap-1">
          <DefinitionBadge change={k} /> {counts[k]}
        </span>
      ))}
    </p>
  );
}

/**
 * 4D.10E: the governed "why" beneath each compared driver — why changed, why introduced (no recorded counterpart; no
 * movement arithmetic is shown), or why not carried forward. "Required" mirrors the proposal gate exactly.
 */
function RationaleRow({
  row,
  projectId,
  v1,
  baselineRecorded,
  exclusion,
}: {
  row: ComparisonRow;
  projectId: string;
  v1: { id: string; status: string };
  baselineRecorded: boolean;
  exclusion: { adjustmentRationale: string } | null;
}) {
  const original = baselineRecorded ? row.inherited : null;
  const editable = v1.status === "draft";
  if (row.requalified) {
    const required = definitionRationaleRequired(original, row.requalified);
    const text = row.requalified.adjustmentRationale;
    if (!required && !hasRationale(text)) return null;
    return (
      <tr data-testid="comparison-rationale" data-code={row.code}>
        <td />
        <td colSpan={8} className="pb-2 text-xs text-slate-600">
          <span className="font-semibold">{original ? "Why changed: " : "Why introduced: "}</span>
          {hasRationale(text) ? (
            text
          ) : (
            <span className="text-red-700">Required before proposal — select Edit on {row.code} to record it</span>
          )}
        </td>
      </tr>
    );
  }
  if (!original) return null; // not in V1 and no governed baseline row: nothing to explain
  const required = definitionRationaleRequired(original, null);
  return (
    <tr data-testid="comparison-rationale" data-code={row.code}>
      <td />
      <td colSpan={8} className="pb-2 text-xs text-slate-600">
        <span className="font-semibold">Why not carried forward: </span>
        {exclusion && !editable && exclusion.adjustmentRationale}
        {!exclusion && !editable && "—"}
        {editable && (
          <ActionForm action={setNotCarriedForwardAction} testId={`not-carried-form-${row.code}`}>
            <Hidden name="projectId" value={projectId} />
            <Hidden name="versionId" value={v1.id} />
            <Hidden name="valueDriverId" value={row.driverId} />
            <div className="mt-1 flex items-end gap-2">
              <div className="flex-1">
                <TextArea
                  name="adjustmentRationale"
                  label={required ? "Reason (required before proposal)" : "Reason (optional)"}
                  rows={1}
                  defaultValue={exclusion?.adjustmentRationale}
                />
              </div>
              <SubmitButton variant="secondary">Save reason</SubmitButton>
            </div>
          </ActionForm>
        )}
      </td>
    </tr>
  );
}
