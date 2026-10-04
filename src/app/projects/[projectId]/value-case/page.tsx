import Link from "next/link";

import { moneyChange, versionAuthority } from "@/domain/value-case";
import { createInheritedBusinessCaseAction } from "@/server/actions/value-case";
import { getValueCaseEvolution } from "@/server/queries/evolution";
import { getValueTrajectoryChart } from "@/server/queries/trajectory";
import { listValueChanges } from "@/server/queries/response";
import { getValueCaseTimeline, type TimelineEntry } from "@/server/queries/value-case";
import { getValueCaseSummary } from "@/server/queries/value-case-summary";
import { getGovernedCommitment } from "@/server/queries/workspace";
import { ActionForm, SubmitButton } from "@/ui/components/action-form";
import { Fragment } from "react";

import {
  EvidenceBadge,
  GovernedTag,
  NonFinancialBadge,
  QualificationBadge,
  VersionBadge,
  versionBorder,
} from "@/ui/components/badges";
import { Hidden, MoneyField, TextArea, TextField } from "@/ui/components/fields";
import { ButtonLink, Notice, Section, Table, TextLink } from "@/ui/components/layout";
import { formatDate, formatMoneyAdaptiveChange, formatMoneyChange, formatMoneyShort, formatPeriod } from "@/ui/format";
import { money } from "@/domain/money";
import { VALUE_BASIS_LABELS } from "@/ui/labels";
import { ValueCaseEvolution } from "@/ui/evolution/evolution";
import { ValueTrajectory } from "@/ui/trajectory/trajectory";
import { requireProject } from "@/ui/require";

export const metadata = { title: "Value Case" };

export default async function ValueCasePage({ params }: PageProps<"/projects/[projectId]/value-case">) {
  const { projectId } = await params;
  const { project } = await requireProject(projectId);
  const [timeline, commitment, evolution, trajectory, changes] = await Promise.all([
    getValueCaseTimeline(projectId),
    getGovernedCommitment(projectId),
    getValueCaseEvolution(projectId),
    getValueTrajectoryChart(projectId),
    listValueChanges(projectId),
  ]);
  const { pending } = await getValueCaseSummary(projectId, evolution);
  const inherited = timeline.find((t) => t.version.kind === "inherited_business_case");
  const valueCases = timeline.filter((t) => t.version.kind === "value_case");
  const base = `/projects/${projectId}`;

  return (
    <>
      <p className="mb-4 max-w-3xl text-sm text-slate-600">
        What management has formally committed to. The Authorised Value Case changes only through an authorised Value
        Change; Cardaxia&apos;s current working view of each driver is in{" "}
        <TextLink href={`${base}/value-drivers`}>Value Drivers</TextLink>.
      </p>

      {commitment && (
        <section
          aria-labelledby="commitment-heading"
          className="mb-8 rounded-lg border-2 border-emerald-600 bg-white p-4 shadow-sm"
          data-testid="current-commitment"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 id="commitment-heading" className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                Current Authorised Value Case
                <GovernedTag>Authorised V{commitment.version.versionNumber}</GovernedTag>
              </h2>
              <p className="mt-1 text-sm text-slate-600" data-testid="commitment-authorisation">
                {commitment.version.title} · authorised {formatDate(commitment.version.authorisedOn)}
                {commitment.authorisedByName && ` by ${commitment.authorisedByName} (VCO)`}
              </p>
              <p className="mt-0.5 text-xs text-slate-500" data-testid="commitment-basis">
                In force ·{" "}
                {commitment.version.valueBasisKind
                  ? `Value Basis ${VALUE_BASIS_LABELS[commitment.version.valueBasisKind]}`
                  : "Value Basis not classified"}{" "}
                ·{" "}
                {commitment.version.valuePeriodStart && commitment.version.valuePeriodEnd
                  ? `Value Period ${formatPeriod(commitment.version.valuePeriodStart, commitment.version.valuePeriodEnd)}`
                  : "Value Period not set"}
              </p>
              {pending.map((p) => (
                <p key={p.id} className="mt-1 text-sm text-slate-700" data-testid="commitment-pending">
                  Proposed V{p.toVersionNumber} via <TextLink href={`${base}/changes/${p.id}`}>{p.code}</TextLink> (
                  {p.status}) — not in force until the VCO authorises it.
                </p>
              ))}
            </div>
            <div className="text-right">
              <p className="text-3xl font-semibold text-slate-900" data-testid="commitment-total">
                {formatMoneyShort(commitment.authorisedTotal, project.currency)}
              </p>
              <p className="text-xs text-slate-500">
                {commitment.latestReview && commitment.forecastTotal !== null
                  ? `Latest formal forecast ${formatMoneyShort(commitment.forecastTotal, project.currency)} (Review #${commitment.latestReview.sequence}, ${formatDate(commitment.latestReview.date)})`
                  : "No finalised review measured against this version yet"}
              </p>
            </div>
          </div>
          <div className="mt-4">
            <Table>
              <thead>
                <tr>
                  <th>Driver</th>
                  <th className="text-right">Authorised Value</th>
                  <th className="text-right">Latest formal forecast</th>
                  <th>Qualification / evidence</th>
                  <th>AVO (as authorised)</th>
                </tr>
              </thead>
              <tbody>
                {commitment.drivers.map(({ driver: d, forecast }) => (
                  <tr key={d.driverVersionId} data-testid={`commitment-driver-${d.code}`}>
                    <td>
                      <span className="font-mono text-slate-500">{d.code}</span> {d.name}
                    </td>
                    <td className="text-right font-semibold">
                      {d.financialValue === null ? (
                        <NonFinancialBadge />
                      ) : (
                        formatMoneyShort(d.financialValue, project.currency)
                      )}
                    </td>
                    <td className="text-right">
                      {!forecast
                        ? "—"
                        : forecast.notAssessed
                          ? "Not assessed"
                          : forecast.value === null
                            ? "—"
                            : formatMoneyShort(forecast.value, project.currency)}
                    </td>
                    <td className="space-x-1">
                      <QualificationBadge status={d.qualificationStatus} />
                      <EvidenceBadge status={d.evidenceStatus} />
                    </td>
                    <td>{d.avoName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <ButtonLink variant="secondary" href={`${base}/value-case/v/${commitment.version.versionNumber}`}>
              View authorised version detail
            </ButtonLink>
            <TextLink href={`${base}/changes`}>Value Changes</TextLink>
          </div>
        </section>
      )}

      {commitment && <ValueTrajectory chart={trajectory} currency={project.currency} id="trajectory" />}
      {/* Governance history: shown whether or not the project has adopted trajectories (4D.9H). */}
      <ValueCaseEvolution evolution={evolution} id="evolution" tableOpen />

      <section aria-labelledby="value-change-history" className="mb-6" data-testid="value-change-history">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="value-change-history" className="text-base font-semibold text-slate-900">
            Value Change history
          </h2>
          {/* 4D.10B: Value Changes left the navigation; this is their home entry point. */}
          <span className="text-sm" data-testid="value-case-changes-link">
            <TextLink href={`${base}/changes`}>Open Value Changes</TextLink>
          </span>
        </div>
        <p className="mb-2 text-sm text-slate-600">
          The governed actions that produced the movement above: each authorised Value Change created the next version.
          Value Changes are prepared from a recorded management decision in an Assurance Review.
        </p>
        {changes.length === 0 ? (
          <p className="text-sm text-slate-600" data-testid="no-value-changes">
            No Value Changes — the commitment is as first authorised.
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Value Change</th>
                <th>Versions</th>
                <th>Status</th>
                <th className="text-right">Change to Authorised Value</th>
              </tr>
            </thead>
            <tbody>
              {[...changes].reverse().map((c) => (
                <tr key={c.change.id} data-testid="value-change-row">
                  <td>
                    <TextLink href={`${base}/changes/${c.change.id}`}>{c.change.code}</TextLink>
                    {c.change.reason && <span className="block text-xs text-slate-500">{c.change.reason}</span>}
                  </td>
                  <td>
                    V{c.fromNumber} → V{c.toNumber}
                  </td>
                  <td>
                    {c.change.status === "authorised"
                      ? `Authorised ${formatDate(c.change.authorisedOn)}`
                      : c.change.status === "draft" || c.change.status === "proposed"
                        ? `${c.change.status === "draft" ? "Draft" : "Proposed"} — not in force`
                        : c.change.status.charAt(0).toUpperCase() + c.change.status.slice(1)}
                  </td>
                  <td className="text-right">
                    {c.change.status === "draft" || c.change.status === "proposed" ? (
                      c.change.statedChangeAmount !== null &&
                      !money(c.change.statedChangeAmount).equals(money(c.actualChange)) ? (
                        // Existing invariant surfaced: stated ≠ draft movement; neither is adjusted.
                        <span data-testid="value-change-unreconciled">
                          Stated {formatMoneyAdaptiveChange(c.change.statedChangeAmount, project.currency)} · draft
                          movement {formatMoneyAdaptiveChange(c.actualChange, project.currency)} · does not reconcile
                        </span>
                      ) : (
                        `Proposed change ${formatMoneyAdaptiveChange(c.actualChange, project.currency)}`
                      )
                    ) : (
                      formatMoneyAdaptiveChange(c.actualChange, project.currency)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <h2 className="mb-2 text-base font-semibold text-slate-900">Version history</h2>
      <ol className="max-w-3xl space-y-2" data-testid="value-case-timeline">
        {inherited ? (
          <TimelineCard entry={inherited} currency={project.currency} href={`${base}/value-case/v/0`} />
        ) : (
          <li>
            <Section
              title="Original Business Case"
              description="Capture the Original Business Case the engagement inherited — at minimum its headline value. Driver-level detail is optional."
            >
              <ActionForm action={createInheritedBusinessCaseAction} testId="create-v0-form">
                <Hidden name="projectId" value={projectId} />
                <div className="space-y-3">
                  <TextField name="title" label="Title" required defaultValue="Original Business Case" />
                  <MoneyField
                    name="statedTotalValue"
                    label="Stated total value"
                    currency={project.currency}
                    hint={`${project.currency}. The headline value as stated in the Original Business Case.`}
                  />
                  <TextArea
                    name="summary"
                    label="Summary"
                    rows={2}
                    placeholder="Source, date and scope of the Original Business Case"
                  />
                  <SubmitButton>Start capturing the Original Business Case</SubmitButton>
                </div>
              </ActionForm>
            </Section>
          </li>
        )}

        {valueCases.map((entry) => (
          <Fragment key={entry.version.id}>
            <li aria-hidden className="pl-6 text-slate-400">
              ↓
            </li>
            <TimelineCard
              entry={entry}
              currency={project.currency}
              href={`${base}/value-case/v/${entry.version.versionNumber}`}
              compareTo={inherited?.headlineTotal ?? null}
            />
          </Fragment>
        ))}

        {valueCases.length === 0 && (
          <>
            <li aria-hidden className="pl-6 text-slate-400">
              ↓
            </li>
            <li className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">
              <p className="font-medium">V1 · Value Case Definition — not started</p>
              <p className="mt-1">
                Value Case Definition turns the Original Business Case into a structured, defensible Value Case.{" "}
                <Link className="text-sky-800 underline" href={`${base}/requalification`}>
                  Go to Value Case Definition
                </Link>
              </p>
            </li>
          </>
        )}
      </ol>

      {valueCases.some((v) => v.version.status === "authorised") && (
        <div className="mt-6 max-w-3xl">
          <Notice tone="info">
            Changes to the Authorised Value Case are made only through a{" "}
            <TextLink href={`${base}/changes`}>Value Change</TextLink> authorised by the VCO. Earlier versions remain
            historically preserved.
          </Notice>
        </div>
      )}
    </>
  );
}

function TimelineCard({
  entry,
  currency,
  href,
  compareTo,
}: {
  entry: TimelineEntry;
  currency: string;
  href: string;
  compareTo?: string | null;
}) {
  const { version, summary, headlineTotal } = entry;
  const change = compareTo !== undefined ? moneyChange(compareTo, headlineTotal) : null;
  return (
    <li
      className={`rounded-lg border-2 bg-white p-4 shadow-sm ${versionBorder(version.kind, version.status)}`}
      data-testid={`timeline-v${version.versionNumber}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <VersionBadge kind={version.kind} status={version.status} versionNumber={version.versionNumber} />
            <span className="text-sm text-slate-500">{version.title}</span>
          </div>
          <p className="mt-1 text-sm font-semibold text-slate-800">
            {versionAuthority(version.kind, version.status, version.versionNumber)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {summary.driverCount === 0
              ? version.kind === "inherited_business_case"
                ? "No driver breakdown"
                : "No Value Drivers yet"
              : `${summary.driverCount} Value ${summary.driverCount === 1 ? "Driver" : "Drivers"}`}
            {summary.nonFinancialCount > 0 && (
              <>
                {" "}
                · {summary.nonFinancialCount} <NonFinancialBadge />
              </>
            )}
            {version.status === "authorised" && ` · authorised ${formatDate(version.authorisedOn)}`}
            {version.status === "recorded" &&
              ` · recorded ${formatDate(version.recordedAt?.toISOString().slice(0, 10))}`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-semibold text-slate-900" data-testid={`timeline-v${version.versionNumber}-total`}>
            {formatMoneyShort(headlineTotal, currency)}
          </p>
          {change !== null && (
            <p className="text-xs text-slate-500">{formatMoneyChange(change, currency)} vs original</p>
          )}
        </div>
      </div>
      <div className="mt-3">
        <ButtonLink variant="secondary" href={href}>
          {version.kind === "inherited_business_case"
            ? "Open Original Business Case"
            : `Open V${version.versionNumber}`}
        </ButtonLink>
      </div>
    </li>
  );
}
