import { getProjectOverview } from "@/server/queries/projects";
import { getValueCaseEvolution } from "@/server/queries/evolution";
import { getValueCaseSummary } from "@/server/queries/value-case-summary";
import { getValueTrajectoryChart } from "@/server/queries/trajectory";
import { getLatestValueDecision } from "@/server/queries/outcomes";
import { getOverviewValueOfficeState } from "@/server/queries/workspace";
import { AttentionBadges } from "@/ui/assurance/matters";
import { GovernedPosition, WorkingPicture } from "@/ui/assurance/picture";
import { change, Figure, NOT_ASSESSED, RequirementBadge } from "@/ui/assurance/display";
import {
  EvidenceBadge,
  NonFinancialBadge,
  QualificationBadge,
  RequestItemBadge,
  GovernedTag,
  VersionBadge,
} from "@/ui/components/badges";
import { Empty, KeyValues, Missing, Notice, Section, TextLink } from "@/ui/components/layout";
import { formatDate, formatMoneyChange, formatMoneyShort, formatPeriod } from "@/ui/format";
import { IR_STATUS_LABELS, KEY_DATE_LABELS } from "@/ui/labels";
import { ValueCaseSummary } from "@/ui/value-case/summary";
import { ValueTrajectory } from "@/ui/trajectory/trajectory";
import { AlternativeValueOutcomes } from "@/ui/outcomes/outcomes";
import { requireProject } from "@/ui/require";
import { moneyChange, versionAuthority } from "@/domain/value-case";
import { EVIDENCE_STATUSES, INFORMATION_REQUEST_ITEM_STATUSES, QUALIFICATION_STATUSES } from "@/domain/statuses";

export default async function ProjectOverviewPage({ params }: PageProps<"/projects/[projectId]">) {
  const { projectId } = await params;
  await requireProject(projectId);
  const [o, state, evolution, latestDecision, trajectory] = await Promise.all([
    getProjectOverview(projectId).then((x) => x!),
    getOverviewValueOfficeState(projectId),
    getValueCaseEvolution(projectId),
    getLatestValueDecision(projectId),
    getValueTrajectoryChart(projectId),
  ]);
  // 4D.9H: the full Value Case Evolution lives on the Value Case page; Overview carries a compact governance summary.
  const valueCase = await getValueCaseSummary(projectId, evolution);
  const { position, cadence, response } = state;
  const attentionMatters = state.workspace.matters.filter((m) => m.needsAttention);
  const { project, clientName, valueBasisLocked } = o.header;
  const base = `/projects/${projectId}`;
  const currency = project.currency;
  const requalifiedTotal = o.requalified?.headlineTotal ?? null;

  return (
    <>
      {o.nextStep && (
        <Notice tone="info" title="Next step">
          <TextLink href={`${base}/${o.nextStep.href}`}>{o.nextStep.label}</TextLink>
        </Notice>
      )}
      {o.requalified?.version.status === "authorised" && (
        <Notice tone="success" title={`Authorised Value Case V${o.requalified.version.versionNumber} is in force`}>
          Authorised on {formatDate(o.requalified.version.authorisedOn)}. Forecasts and realised values are recorded in{" "}
          <TextLink href={`${base}/assurance`}>Value Assurance</TextLink> reviews and never alter it.
        </Notice>
      )}

      {!position.authorised && <ValueCaseSummary summary={valueCase} base={base} />}

      {position.authorised && (
        <>
          <div className="mb-3 grid gap-3" data-testid="overview-assurance">
            <GovernedPosition
              authorisedVersion={position.authorised.versionNumber}
              authorisedTotal={position.authorisedTotal}
              totals={position.latest?.totals ?? null}
              reviewSequence={position.latest?.review.sequence ?? null}
              againstVersion={position.latest?.againstVersionNumber ?? null}
              currency={currency}
              prefix="overview"
            />
            <WorkingPicture workspace={state.workspace} currency={currency} href={`${base}/assurance#continuous`} />
          </div>

          <ValueTrajectory chart={trajectory} currency={currency} id="trajectory" />

          <ValueCaseSummary summary={valueCase} base={base} />

          {latestDecision && (
            <AlternativeValueOutcomes
              data={latestDecision}
              variant="compact"
              reviewHref={`${base}/assurance/${latestDecision.review.id}#outcomes`}
            />
          )}

          <div className="mb-6 grid gap-6 lg:grid-cols-[3fr_2fr]">
            <Section
              title="Needs attention"
              description="Derived from open matters' stage, owner and dates. Nothing here is a task or a notification."
              actions={<TextLink href={`${base}/assurance?stage=attention#continuous`}>All in Assurance</TextLink>}
            >
              {attentionMatters.length === 0 ? (
                <Empty>No open Assurance matter needs attention.</Empty>
              ) : (
                <ul className="space-y-2 text-sm" data-testid="overview-attention">
                  {attentionMatters.slice(0, 6).map((m) => (
                    <li key={m.entry.leakage.id} className="flex flex-wrap items-start justify-between gap-2">
                      <TextLink href={`${base}/assurance/matters/${m.entry.leakage.id}`}>
                        {m.entry.leakage.code} {m.entry.leakage.title}
                      </TextLink>
                      <AttentionBadges items={m.attention} />
                    </li>
                  ))}
                  {attentionMatters.length > 6 && (
                    <li className="text-xs text-slate-500">+ {attentionMatters.length - 6} more in Assurance</li>
                  )}
                </ul>
              )}
            </Section>

            <Section title="Governance">
              <div className="space-y-2 text-sm">
                <p data-testid="overview-authorised-version">
                  <span className="text-slate-500">Authorised Value Case in force: </span>
                  <TextLink href={`${base}/value-case/v/${position.authorised.versionNumber}`}>
                    V{position.authorised.versionNumber}
                  </TextLink>
                  {position.authorised.authorisedOn && ` · authorised ${formatDate(position.authorised.authorisedOn)}`}
                  {response.openChange && (
                    <>
                      {" "}
                      · open change{" "}
                      <TextLink href={`${base}/changes/${response.openChange.id}`}>
                        {response.openChange.code} ({response.openChange.status})
                      </TextLink>
                    </>
                  )}
                </p>
                <p>
                  <span className="text-slate-500">Last Assurance Review: </span>
                  {state.lastReview ? (
                    <TextLink href={`${base}/assurance/${state.lastReview.review.id}`}>
                      #{state.lastReview.review.sequence} · {formatDate(state.lastReview.review.reviewDate)} (
                      {state.lastReview.review.status})
                    </TextLink>
                  ) : (
                    "None"
                  )}
                </p>
                <p data-testid="overview-next-requirement">
                  <span className="text-slate-500">Next Assurance Requirement: </span>
                  {cadence.next ? (
                    <>
                      {cadence.next.label} <RequirementBadge status={cadence.next.status} />
                      {cadence.next.date && ` ${formatDate(cadence.next.date)}`}
                    </>
                  ) : (
                    "None derivable"
                  )}
                </p>
                <p data-testid="overview-recommendation">
                  <span className="text-slate-500">Latest Cardaxia recommendation: </span>
                  {response.recommendation
                    ? `${response.recommendation.scenario.label} ${formatMoneyShort(response.recommendation.scenario.totalValue, currency)} (Review #${response.recommendation.review.sequence})`
                    : "None issued"}
                </p>
                <p data-testid="overview-decision">
                  <span className="text-slate-500">Latest client decision: </span>
                  {response.decision
                    ? `${response.decision.scenario.label} ${formatMoneyShort(response.decision.scenario.totalValue, currency)}${response.decision.difference ? ` (${change(response.decision.difference, currency)} vs recommendation)` : ""}`
                    : "None recorded"}
                </p>
                <p data-testid="overview-drivers">
                  <span className="text-slate-500">Value Drivers: </span>
                  <TextLink href={`${base}/value-drivers`}>
                    {state.drivers.inValueCase} in Value Case
                    {state.drivers.emerging > 0 && ` · ${state.drivers.emerging} emerging`}
                    {state.drivers.outsideCurrent > 0 && ` · ${state.drivers.outsideCurrent} outside current`}
                  </TextLink>
                </p>
              </div>
            </Section>
          </div>

          <Section
            title={
              <span className="inline-flex flex-wrap items-center gap-2">
                Formal Value Leakage <GovernedTag>Latest finalised assessments</GovernedTag>
              </span>
            }
            description="What finalised Assurance Reviews have recorded for open matters. Independent of Value Gap and of the working picture above."
          >
            <div className="grid gap-3 sm:grid-cols-3" data-testid="overview-leakage">
              <Figure
                label={`Open Value Leakage (${response.openLeakageCount})`}
                value={
                  response.leakage.total === null
                    ? response.openLeakageCount
                      ? NOT_ASSESSED
                      : "None"
                    : formatMoneyShort(response.leakage.total, currency)
                }
                note={
                  response.openLeakageCount
                    ? `${response.leakage.assessedCount} of ${response.openLeakageCount} assessed in a finalised review`
                    : "Independent of Value Gap"
                }
                testId="overview-leakage-total"
              />
              <Figure
                label="Recoverable VL"
                value={
                  response.leakage.recoverable === null ? "—" : formatMoneyShort(response.leakage.recoverable, currency)
                }
                testId="overview-leakage-recoverable"
              />
              <Figure
                label="Unrecoverable VL"
                value={
                  response.leakage.unrecoverable === null
                    ? "—"
                    : formatMoneyShort(response.leakage.unrecoverable, currency)
                }
                testId="overview-leakage-unrecoverable"
              />
            </div>
          </Section>
        </>
      )}

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

        {/* 4D.9H: retitled — this is the V0 → V1 re-qualification baseline; the governed commitment is summarised above. */}
        <Section
          title="Re-Qualification baseline (V0 → V1)"
          actions={<TextLink href={`${base}/value-case`}>Open Value Case</TextLink>}
        >
          <div className="space-y-3 text-sm" data-testid="overview-value-case">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-slate-500">Inherited Business Case</p>
                {o.inherited ? (
                  <VersionBadge kind="inherited_business_case" status={o.inherited.version.status} versionNumber={0} />
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
                    {formatMoneyChange(moneyChange(o.inherited.headlineTotal, requalifiedTotal), currency)} vs inherited
                  </p>
                )}
              </div>
            </div>
          </div>
        </Section>

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
    </>
  );
}
