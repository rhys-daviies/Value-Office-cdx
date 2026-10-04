import { EVIDENCE_STATUSES, QUALIFICATION_STATUSES } from "@/domain/statuses";
import { moneyChange } from "@/domain/value-case";
import { recordEvidenceAction } from "@/server/actions/evidence";
import {
  authoriseInitialVersionAction,
  createDraftVersionAction,
  proposeVersionAction,
  returnVersionToDraftAction,
} from "@/server/actions/value-case";
import { getCurrentActor } from "@/server/auth/actor";
import { nextEvidenceCode } from "@/server/queries/evidence";
import { listEvidenceOptions } from "@/server/queries/information-request";
import { listStakeholders } from "@/server/queries/mobilise";
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
  const [ws, stakeholders, evidence, actor] = await Promise.all([
    getRequalificationWorkspace(projectId),
    listStakeholders(projectId),
    listEvidenceOptions(projectId),
    getCurrentActor().catch(() => null),
  ]);
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

      {/* ---- No V1 yet ------------------------------------------------------------ */}
      {!v1 && (
        <Section title="Create the draft Value Case (V1)">
          {!ws.inheritedVersion && (
            <Notice tone="warning">
              No Original Business Case has been captured. You can start V1 without it, but the comparison needs it —{" "}
              <TextLink href={`${base}/value-case`}>capture the Original Business Case first</TextLink>.
            </Notice>
          )}
          {ws.inheritedVersion?.status === "draft" && (
            <Notice tone="warning">
              The Original Business Case is still being captured.{" "}
              <TextLink href={`${base}/value-case/v/0`}>Record the Original Business Case</TextLink> to base V1 on it
              and carry its drivers forward.
            </Notice>
          )}
          <ActionForm action={createDraftVersionAction} testId="create-v1-form">
            <Hidden name="projectId" value={projectId} />
            {ws.inheritedVersion?.status === "recorded" && (
              <Hidden name="basedOnVersionId" value={ws.inheritedVersion.id} />
            )}
            <div className="space-y-3">
              <TextField name="title" label="Title" required defaultValue="Value Case" />
              <TextArea name="summary" label="Summary" rows={2} />
              {ws.inheritedVersion?.status === "recorded" && (
                <p className="text-xs text-slate-500">
                  Based on the Original Business Case. Its drivers ({ws.inheritedDrivers.length}) are copied into the
                  draft for definition; the Original Business Case itself is never changed.
                </p>
              )}
              <SubmitButton>Create draft V1</SubmitButton>
            </div>
          </ActionForm>
        </Section>
      )}

      {/* ---- Comparison ----------------------------------------------------------- */}
      {v1 && (
        <Section
          title="Original Business Case vs Value Case (V1)"
          description="Per Value Driver. Drivers are matched by their stable code across versions."
        >
          {ws.comparison.length === 0 ? (
            <Empty>No Value Drivers yet.</Empty>
          ) : (
            <ComparisonTable
              rows={ws.comparison}
              currency={currency}
              inheritedTotal={ws.inheritedTotal}
              v1Total={v1Total}
            />
          )}
        </Section>
      )}

      {/* ---- Driver detail -------------------------------------------------------- */}
      {v1 && (
        <Section
          title={`V${v1.versionNumber} Value Drivers`}
          description={
            v1.status === "draft"
              ? "Expand a driver to define it. Incomplete qualification is visible but does not block proposal."
              : "Read-only."
          }
        >
          <div className="space-y-2">
            {ws.requalifiedDrivers.map((d) =>
              v1.status === "draft" ? (
                <DriverEditor key={d.driverVersionId} driver={d} ctx={ctx} />
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
        <Section title="Propose V1 for VCO authorisation" tone="muted">
          <ul className="mb-3 space-y-1 text-sm" data-testid="propose-checklist">
            <Check
              ok={Boolean(project.valueBasisDescription)}
              label="Value Basis defined"
              required
              fix={`${base}/setup#value-basis`}
            />
            <Check ok={s.driverCount > 0} label="At least one Value Driver" required />
            <Check
              ok={Boolean(vco)}
              label="Value Case Owner nominated (needed to record authorisation)"
              fix={`${base}/setup#stakeholders`}
            />
            <Check
              ok={s.qualification.unqualified === 0}
              label={`Unqualified drivers: ${s.qualification.unqualified} (visible, not blocking)`}
            />
            <Check
              ok={s.evidence.unevidenced === 0}
              label={`Unevidenced drivers: ${s.evidence.unevidenced} (visible, not blocking)`}
            />
          </ul>
          <p className="mb-3 text-sm text-slate-600">
            Proposing locks the draft and locks the project&apos;s currency and Value Basis. You can return a proposed
            version to draft if changes are needed before authorisation.
          </p>
          <ActionForm
            action={proposeVersionAction}
            confirm="Propose V1 for VCO authorisation? The draft will be locked."
          >
            <Hidden name="projectId" value={projectId} />
            <Hidden name="versionId" value={v1.id} />
            <SubmitButton
              disabled={!project.valueBasisDescription || s.driverCount === 0}
              title={
                !project.valueBasisDescription
                  ? "Define the Value Basis first"
                  : s.driverCount === 0
                    ? "Add a Value Driver first"
                    : undefined
              }
            >
              Propose V1
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
  rows,
  currency,
  inheritedTotal,
  v1Total,
}: {
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
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.driverId} data-testid="comparison-row">
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
              {!r.inherited && <PlainBadge tone="sky">New in V1</PlainBadge>}
              {!r.requalified && <PlainBadge tone="red">Not carried into V1</PlainBadge>}
            </td>
          </tr>
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
