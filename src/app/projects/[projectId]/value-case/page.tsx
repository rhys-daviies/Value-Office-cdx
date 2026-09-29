import Link from "next/link";

import { moneyChange, versionAuthority } from "@/domain/value-case";
import { createInheritedBusinessCaseAction } from "@/server/actions/value-case";
import { getValueCaseTimeline, type TimelineEntry } from "@/server/queries/value-case";
import { ActionForm, SubmitButton } from "@/ui/components/action-form";
import { Fragment } from "react";

import { NonFinancialBadge, VersionBadge, versionBorder } from "@/ui/components/badges";
import { Hidden, MoneyField, TextArea, TextField } from "@/ui/components/fields";
import { ButtonLink, Notice, Section } from "@/ui/components/layout";
import { formatDate, formatMoneyChange, formatMoneyShort } from "@/ui/format";
import { requireProject } from "@/ui/require";

export const metadata = { title: "Value Case" };

export default async function ValueCasePage({ params }: PageProps<"/projects/[projectId]/value-case">) {
  const { projectId } = await params;
  const { project } = await requireProject(projectId);
  const timeline = await getValueCaseTimeline(projectId);
  const inherited = timeline.find((t) => t.version.kind === "inherited_business_case");
  const valueCases = timeline.filter((t) => t.version.kind === "value_case");
  const base = `/projects/${projectId}`;

  return (
    <>
      <p className="mb-4 max-w-3xl text-sm text-slate-600">
        What the client originally claimed, what Cardaxia has re-qualified, and whether management has authorised it.
      </p>

      <ol className="max-w-3xl space-y-2" data-testid="value-case-timeline">
        {inherited ? (
          <TimelineCard entry={inherited} currency={project.currency} href={`${base}/value-case/v/0`} />
        ) : (
          <li>
            <Section
              title="Inherited Business Case (V0)"
              description="Capture the Business Case the engagement inherited — at minimum its headline value. Driver-level detail is optional."
            >
              <ActionForm action={createInheritedBusinessCaseAction} testId="create-v0-form">
                <Hidden name="projectId" value={projectId} />
                <div className="space-y-3">
                  <TextField name="title" label="Title" required defaultValue="Original Business Case" />
                  <MoneyField
                    name="statedTotalValue"
                    label="Stated total value"
                    currency={project.currency}
                    hint={`${project.currency}. The headline value as stated in the inherited Business Case.`}
                  />
                  <TextArea
                    name="summary"
                    label="Summary"
                    rows={2}
                    placeholder="Source, date and scope of the inherited Business Case"
                  />
                  <SubmitButton>Start capturing V0</SubmitButton>
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
              <p className="font-medium">V1 · Re-Qualified Value Case — not started</p>
              <p className="mt-1">
                Re-Qualification converts the inherited Business Case into a structured, defensible Value Case.{" "}
                <Link className="text-sky-800 underline" href={`${base}/requalification`}>
                  Go to Re-Qualification
                </Link>
              </p>
            </li>
          </>
        )}
      </ol>

      {valueCases.some((v) => v.version.status === "authorised") && (
        <div className="mt-6 max-w-3xl">
          <Notice tone="info">
            Later changes to an Authorised Value Case will require an approved Value Change authorised by the VCO (a
            later phase). The authorised version above remains historically preserved.
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
            <p className="text-xs text-slate-500">{formatMoneyChange(change, currency)} vs inherited</p>
          )}
        </div>
      </div>
      <div className="mt-3">
        <ButtonLink variant="secondary" href={href}>
          Open V{version.versionNumber}
        </ButtonLink>
      </div>
    </li>
  );
}
