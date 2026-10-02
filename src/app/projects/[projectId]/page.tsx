import { getProjectOverview } from "@/server/queries/projects";
import { getExecutiveOverview } from "@/server/queries/overview";
import {
  EvidenceBadge,
  NonFinancialBadge,
  QualificationBadge,
  RequestItemBadge,
  VersionBadge,
} from "@/ui/components/badges";
import { Expander } from "@/ui/components/expander";
import { KeyValues, Missing, Notice, Section, TextLink } from "@/ui/components/layout";
import { formatDate, formatMoneyChange, formatMoneyShort, formatPeriod } from "@/ui/format";
import { IR_STATUS_LABELS, KEY_DATE_LABELS } from "@/ui/labels";
import { LatestValueDecision } from "@/ui/overview/decision";
import { ValueAttention } from "@/ui/overview/attention";
import { ExecutivePosition } from "@/ui/overview/position";
import { ValueTrajectory } from "@/ui/trajectory/trajectory";
import { ValueCaseSummary } from "@/ui/value-case/summary";
import { requireProject } from "@/ui/require";
import { moneyChange, versionAuthority } from "@/domain/value-case";
import { EVIDENCE_STATUSES, INFORMATION_REQUEST_ITEM_STATUSES, QUALIFICATION_STATUSES } from "@/domain/statuses";

// Executive Overview (Phase 4D.9I): where the project stands on value, what is changing and what needs management
// attention — value position → Value Trajectory → value requiring attention → latest value decision → governed
// commitment. Detail lives in Assurance and Value Case. Before authorisation the setup record is the page.

export default async function ProjectOverviewPage({ params }: PageProps<"/projects/[projectId]">) {
  const { projectId } = await params;
  await requireProject(projectId);
  const [o, x] = await Promise.all([getProjectOverview(projectId).then((r) => r!), getExecutiveOverview(projectId)]);
  const base = `/projects/${projectId}`;
  const currency = o.header.project.currency;

  return (
    <>
      {o.nextStep && (
        <Notice tone="info" title="Next step">
          <TextLink href={`${base}/${o.nextStep.href}`}>{o.nextStep.label}</TextLink>
        </Notice>
      )}

      {!x.authorised ? (
        <SetupRecord o={o} base={base} currency={currency} preAuthorisation />
      ) : (
        <>
          <ExecutivePosition o={x} base={base} />
          <ValueTrajectory chart={x.trajectory} currency={currency} id="trajectory" headline={false} />
          <div className={`mb-6 grid gap-4 ${x.decision ? "xl:grid-cols-2" : ""}`}>
            <ValueAttention o={x} base={base} />
            <LatestValueDecision o={x} base={base} />
          </div>
          <ValueCaseSummary summary={x.valueCase} base={base} />
          <Expander summary="Project setup and mobilisation record" testId="overview-setup-record">
            <div className="pt-3">
              <SetupRecord o={o} base={base} currency={currency} preAuthorisation={false} />
            </div>
          </Expander>
        </>
      )}
    </>
  );
}

/** Setup and re-qualification record: the working surface before authorisation, a collapsed record after it. */
function SetupRecord({
  o,
  base,
  currency,
  preAuthorisation,
}: {
  o: NonNullable<Awaited<ReturnType<typeof getProjectOverview>>>;
  base: string;
  currency: string;
  preAuthorisation: boolean;
}) {
  const { project, clientName, valueBasisLocked } = o.header;
  const requalifiedTotal = o.requalified?.headlineTotal ?? null;
  return (
    <>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Project">
          <KeyValues
            items={[
              ["Client", clientName],
              ["Project", `${project.name} (${project.code})`],
              [
                "Status",
                <span key="status" className="capitalize">
                  {project.status}
                </span>,
              ],
              ["Context", project.context ?? <Missing>Not recorded</Missing>],
            ]}
          />
        </Section>

        <Section
          title="Value Basis"
          actions={
            valueBasisLocked ? (
              <span className="text-xs text-slate-500">🔒 Locked by proposed/authorised Value Case</span>
            ) : undefined
          }
        >
          <KeyValues
            items={[
              ["Currency", currency],
              [
                "Basis",
                project.valueBasisDescription ?? <Missing>Not defined — required before V1 can be proposed</Missing>,
              ],
              ["Period", formatPeriod(project.valuePeriodStart, project.valuePeriodEnd)],
            ]}
          />
        </Section>

        {preAuthorisation && (
          <>
            {/* Pre-authorisation only (4D.9I): after V1 is authorised the Value Case summary and page carry this history. */}
            <Section
              title="Re-Qualification baseline (V0 → V1)"
              actions={<TextLink href={`${base}/value-case`}>Open Value Case</TextLink>}
            >
              <div className="space-y-3 text-sm" data-testid="overview-value-case">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-slate-500">Inherited Business Case</p>
                    {o.inherited ? (
                      <VersionBadge
                        kind="inherited_business_case"
                        status={o.inherited.version.status}
                        versionNumber={0}
                      />
                    ) : (
                      <Missing>Not captured</Missing>
                    )}
                  </div>
                  <p className="text-2xl font-semibold text-slate-700" data-testid="overview-inherited-total">
                    {formatMoneyShort(o.inherited?.headlineTotal, currency)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <div>
                    <p className="text-slate-500">Re-Qualified Value Case</p>
                    {o.requalified ? (
                      <>
                        <VersionBadge
                          kind="value_case"
                          status={o.requalified.version.status}
                          versionNumber={o.requalified.version.versionNumber}
                        />
                        <p className="mt-1 text-xs text-slate-500">
                          {versionAuthority(
                            "value_case",
                            o.requalified.version.status,
                            o.requalified.version.versionNumber,
                          )}
                        </p>
                      </>
                    ) : (
                      <Missing>No draft yet</Missing>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-semibold text-slate-900" data-testid="overview-requalified-total">
                      {formatMoneyShort(requalifiedTotal, currency)}
                    </p>
                    {o.inherited?.headlineTotal && requalifiedTotal && (
                      <p className="text-xs text-slate-500">
                        {formatMoneyChange(moneyChange(o.inherited.headlineTotal, requalifiedTotal), currency)} vs
                        inherited
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </Section>
          </>
        )}
        <Section title="Mobilisation" actions={<TextLink href={`${base}/setup`}>Open Setup</TextLink>}>
          <KeyValues
            items={[
              ["Stakeholders", o.stakeholders.length === 0 ? <Missing>None recorded</Missing> : o.stakeholders.length],
              ["Value Case Owner", o.vco ? o.vco.name : <Missing>Not nominated — required to authorise V1</Missing>],
              [
                "Key dates",
                o.keyDates.length === 0 ? (
                  <Missing>None recorded</Missing>
                ) : (
                  <ul>
                    {o.keyDates.map((d) => (
                      <li key={d.id}>
                        {d.kind === "other" ? d.label : KEY_DATE_LABELS[d.kind]}: {formatDate(d.date)}
                      </li>
                    ))}
                  </ul>
                ),
              ],
              [
                "Information Request",
                o.requests.length === 0 ? (
                  <Missing>Not created</Missing>
                ) : (
                  <div className="space-y-1">
                    <p>{o.requests.map((r) => `${r.reference} (${IR_STATUS_LABELS[r.status]})`).join(", ")}</p>
                    <p className="flex flex-wrap gap-1">
                      {INFORMATION_REQUEST_ITEM_STATUSES.map((s) => (
                        <span key={s} className="inline-flex items-center gap-1">
                          <RequestItemBadge status={s} /> {o.irItems[s]}
                        </span>
                      ))}
                    </p>
                  </div>
                ),
              ],
              [
                "Evidence",
                `${o.evidenceCount} evidence ${o.evidenceCount === 1 ? "item" : "items"} · ${o.documentCount} document ${o.documentCount === 1 ? "reference" : "references"}`,
              ],
            ]}
          />
        </Section>
      </div>

      {preAuthorisation && (
        <Section
          title="Re-Qualification status"
          actions={<TextLink href={`${base}/requalification`}>Open Re-Qualification</TextLink>}
        >
          {!o.requalified ? (
            <p className="text-sm text-slate-600">No Re-Qualified Value Case yet.</p>
          ) : (
            <div className="grid gap-4 text-sm sm:grid-cols-3" data-testid="overview-requalification">
              <div>
                <p className="text-slate-500">Value Drivers</p>
                <p className="text-lg font-semibold">{o.requalified.summary.driverCount}</p>
                <p className="text-xs text-slate-500">
                  {o.requalified.summary.financialCount} financial
                  {o.requalified.summary.nonFinancialCount > 0 && (
                    <>
                      {" "}
                      · {o.requalified.summary.nonFinancialCount} <NonFinancialBadge />
                    </>
                  )}
                </p>
              </div>
              <div>
                <p className="mb-1 text-slate-500">Qualification</p>
                <ul className="space-y-1">
                  {QUALIFICATION_STATUSES.map((s) => (
                    <li key={s}>
                      <QualificationBadge status={s} /> {o.requalified!.summary.qualification[s]}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-1 text-slate-500">Evidence status</p>
                <ul className="space-y-1">
                  {EVIDENCE_STATUSES.map((s) => (
                    <li key={s}>
                      <EvidenceBadge status={s} /> {o.requalified!.summary.evidence[s]}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </Section>
      )}
    </>
  );
}
