import Link from "next/link";

import { createMatterAction } from "@/server/actions/matters";
import type { AttentionItem, AttentionKind } from "@/domain/attention";
import type { LeakageEntry } from "@/server/queries/response";
import type { ContinuousAssuranceWorkspace, StageFilter } from "@/server/queries/workspace";

import { ActionForm, SubmitButton } from "../components/action-form";
import { PlainBadge, WorkingTag } from "../components/badges";
import { DateField, FormGrid, Hidden, SelectField, TextArea, TextField } from "../components/fields";
import { Empty, Expander, Table } from "../components/layout";
import { formatDate, formatMoneyShort } from "../format";
import { ASSURANCE_STAGE_LABELS } from "../labels";

type Option = { value: string; label: string };
type Driver = { driverId: string; code: string; name: string };

export const WORKING_LABEL = "Working assessment — not formally reviewed";

/** Stage badge for a living matter; legacy matters without a stage read simply as Open. */
export function StageBadge({ entry }: { entry: Pick<LeakageEntry, "leakage"> }) {
  const { status, stage } = entry.leakage;
  if (status === "closed") return <PlainBadge tone="slate">Closed</PlainBadge>;
  return (
    <PlainBadge tone={stage === "escalated" ? "red" : "amber"}>
      {stage ? ASSURANCE_STAGE_LABELS[stage] : "Open"}
    </PlainBadge>
  );
}

/** Working Value Leakage of a living matter, never styled as a formal position. */
export function WorkingAmount({ entry, currency }: { entry: Pick<LeakageEntry, "working">; currency: string }) {
  if (!entry.working) {
    return (
      <span className="text-amber-700 italic" data-testid="working-amount">
        Not yet quantified
      </span>
    );
  }
  return (
    <span
      className="border-b border-dashed border-violet-400 text-violet-900"
      data-testid="working-amount"
      title={WORKING_LABEL}
    >
      {formatMoneyShort(entry.working.total, currency)} working
      <span className="text-xs text-violet-700">
        {" "}
        ({formatMoneyShort(entry.working.unrecoverable, currency)} unrecoverable)
      </span>
    </span>
  );
}

const FILTERS: { value: StageFilter | "attention"; label: string }[] = [
  { value: "all", label: "All open" },
  { value: "attention", label: "Needs attention" },
  { value: "identified", label: "Identified" },
  { value: "awaiting_evidence", label: "Awaiting evidence" },
  { value: "assessing", label: "Assessing" },
  { value: "remediation", label: "Remediation" },
  { value: "monitoring", label: "Monitoring" },
  { value: "escalated", label: "Escalated" },
];

export type MatterFilter = StageFilter | "attention";

export function parseMatterFilter(value: string | string[] | undefined): MatterFilter {
  const v = typeof value === "string" ? value : undefined;
  return FILTERS.some((f) => f.value === v) ? (v as MatterFilter) : "all";
}

const ATTENTION_TONE: Partial<Record<AttentionKind, "red" | "amber" | "slate">> = {
  escalated: "red",
  decision_overdue: "red",
  decision_approaching: "amber",
  awaiting_evidence: "amber",
  no_owner: "amber",
  monitor_ended: "amber",
  monitor_ending: "slate",
};

/** Derived "needs attention" conditions. "Not yet quantified" is shown in the Working VL column instead. */
export function AttentionBadges({ items }: { items: AttentionItem[] }) {
  const shown = items.filter((a) => a.kind !== "unquantified");
  if (shown.length === 0) return <span className="text-xs text-slate-400">—</span>;
  return (
    <span className="flex flex-wrap gap-1" data-testid="matter-attention">
      {shown.map((a) => (
        <PlainBadge key={a.kind} tone={ATTENTION_TONE[a.kind] ?? "slate"}>
          {a.label}
          {a.date ? ` ${formatDate(a.date)}` : ""}
        </PlainBadge>
      ))}
    </span>
  );
}

export function ContinuousAssurance({
  projectId,
  currency,
  workspace,
  filter,
  stakeholders,
  drivers,
}: {
  projectId: string;
  currency: string;
  workspace: ContinuousAssuranceWorkspace;
  filter: MatterFilter;
  stakeholders: Option[];
  drivers: Driver[];
}) {
  const base = `/projects/${projectId}/assurance`;
  const { matters, stageCounts, attention } = workspace;
  const shown = matters.filter((m) =>
    filter === "all" ? true : filter === "attention" ? m.needsAttention : m.entry.leakage.stage === filter,
  );
  const countFor = (f: MatterFilter) =>
    f === "all" ? matters.length : f === "attention" ? attention.needsAttention : stageCounts[f];
  return (
    <section
      id="continuous"
      aria-labelledby="continuous-heading"
      className="mb-8 rounded-lg border border-violet-200 bg-white p-4 shadow-sm"
      data-testid="continuous-assurance"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2
            id="continuous-heading"
            className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900"
          >
            Continuous Assurance <WorkingTag>Live · working</WorkingTag>
          </h2>
          <p className="mt-0.5 max-w-3xl text-sm text-slate-600">
            What threatens the Authorised Value today and what is being done about it. Stages are flexible — a matter
            moves between them as evidence changes. Working figures are not a formal position.
          </p>
        </div>
        <a
          href="#raise-matter"
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
        >
          + Raise Assurance Matter
        </a>
      </div>

      <nav aria-label="Filter Assurance matters" className="mb-3">
        <ul className="flex flex-wrap gap-1 text-sm" data-testid="matter-filters">
          {FILTERS.map((f) => {
            const active = f.value === filter;
            return (
              <li key={f.value}>
                <Link
                  href={f.value === "all" ? `${base}#continuous` : `${base}?stage=${f.value}#continuous`}
                  aria-current={active ? "true" : undefined}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 ${
                    active
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 text-slate-700 hover:border-slate-500"
                  }`}
                >
                  {f.label}
                  <span className={active ? "text-slate-300" : "text-slate-400"}>{countFor(f.value)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {shown.length === 0 ? (
        <Empty>{matters.length === 0 ? "No open Assurance matters." : "No open matters match this filter."}</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Matter</th>
              <th>Working stage</th>
              <th>Risk / Leakage Owner</th>
              <th>Working Value Leakage</th>
              <th>Evidence</th>
              <th>Remediation / monitoring</th>
              <th>Needs attention</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ entry: e, evidenceCount, requestsOutstanding, requestsTotal, attention: items }) => (
              <tr key={e.leakage.id} data-testid="matter-row">
                <td className="min-w-48">
                  <Link
                    href={`${base}/matters/${e.leakage.id}`}
                    className="font-medium text-sky-800 underline decoration-sky-300"
                  >
                    <span className="font-mono text-slate-500">{e.leakage.code}</span> {e.leakage.title}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {e.identifiedInSequence !== null
                      ? `Raised in Review #${e.identifiedInSequence}`
                      : `Raised ${formatDate(e.leakage.identifiedOn)}`}
                    {e.drivers.length > 0 && ` · ${e.drivers.map((d) => d.code).join(", ")}`}
                  </div>
                </td>
                <td>
                  <StageBadge entry={e} />
                </td>
                <td>{e.ownerName ?? <span className="text-amber-700">Not assigned</span>}</td>
                <td>
                  <WorkingAmount entry={e} currency={currency} />
                </td>
                <td className="text-xs whitespace-nowrap" data-testid="matter-evidence-state">
                  {evidenceCount} supporting
                  {requestsTotal > 0 && (
                    <div className={requestsOutstanding ? "text-amber-700" : "text-slate-500"}>
                      {requestsOutstanding
                        ? `${requestsOutstanding} request${requestsOutstanding === 1 ? "" : "s"} outstanding`
                        : "All requests answered"}
                    </div>
                  )}
                </td>
                <td className="text-xs text-slate-600">
                  {e.leakage.remediationPlan ? "Plan recorded" : "No plan"}
                  {e.leakage.monitorUntil && <div>Monitor until {formatDate(e.leakage.monitorUntil)}</div>}
                  {e.leakage.requiredDecisionDate && (
                    <div>Decision by {formatDate(e.leakage.requiredDecisionDate)}</div>
                  )}
                </td>
                <td>
                  <AttentionBadges items={items} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {workspace.closedCount > 0 && (
        <p className="mt-2 text-xs text-slate-500">{workspace.closedCount} closed matter(s) not shown.</p>
      )}

      <div className="mt-4 scroll-mt-4" id="raise-matter">
        <Expander summary="+ Raise an Assurance matter" testId="create-matter">
          <ActionForm action={createMatterAction} testId="create-matter-form">
            <Hidden name="projectId" value={projectId} />
            <div className="space-y-2">
              <FormGrid cols={3}>
                <TextField name="code" label="Code" required defaultValue={workspace.nextCode} />
                <TextField name="title" label="Issue" required />
                <DateField name="identifiedOn" label="Identified on" />
              </FormGrid>
              <TextArea name="description" label="Description" rows={2} />
              <FormGrid>
                <SelectField
                  name="responseOwnerPersonId"
                  label="Risk / Leakage Owner"
                  placeholder="—"
                  options={stakeholders}
                />
                <DateField name="requiredDecisionDate" label="Required decision date" />
              </FormGrid>
              <fieldset className="text-sm">
                <legend className="font-medium text-slate-700">Affected Value Drivers</legend>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {drivers.map((d) => (
                    <label key={d.driverId} className="inline-flex items-center gap-1">
                      <input type="checkbox" name="driverIds" value={d.driverId} />
                      <span className="font-mono text-xs text-slate-500">{d.code}</span> {d.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="text-xs text-slate-500">
                No formal review is needed. The matter starts at stage &ldquo;Identified&rdquo;.
              </p>
              <SubmitButton>Raise matter</SubmitButton>
            </div>
          </ActionForm>
        </Expander>
      </div>
    </section>
  );
}
