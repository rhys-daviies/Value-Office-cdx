import Link from "next/link";

import { createMatterAction } from "@/server/actions/matters";
import type { LeakageEntry } from "@/server/queries/response";

import { ActionForm, SubmitButton } from "../components/action-form";
import { PlainBadge } from "../components/badges";
import { DateField, FormGrid, Hidden, SelectField, TextArea, TextField } from "../components/fields";
import { Empty, Expander, Section, Table } from "../components/layout";
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

export function ContinuousAssurance({
  projectId,
  currency,
  open,
  closedCount,
  nextCode,
  stakeholders,
  drivers,
}: {
  projectId: string;
  currency: string;
  open: LeakageEntry[];
  closedCount: number;
  nextCode: string;
  stakeholders: Option[];
  drivers: Driver[];
}) {
  const base = `/projects/${projectId}/assurance/matters`;
  return (
    <Section
      id="continuous"
      title="Continuous Assurance"
      description="The day-to-day record of what threatens the Authorised Value and what is being done about it. Working figures here are not a formal position; formal reviews snapshot every open matter when they are finalised."
    >
      {open.length === 0 ? (
        <Empty>No open Assurance matters.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Matter</th>
              <th>Working stage</th>
              <th>Risk / Leakage Owner</th>
              <th>Working Value Leakage</th>
              <th>Remediation / monitoring</th>
            </tr>
          </thead>
          <tbody>
            {open.map((e) => (
              <tr key={e.leakage.id} data-testid="matter-row">
                <td>
                  <Link
                    href={`${base}/${e.leakage.id}`}
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
                <td className="text-xs text-slate-600">
                  {e.leakage.remediationPlan ? "Plan recorded" : "No plan"}
                  {e.leakage.monitorUntil && ` · monitor until ${formatDate(e.leakage.monitorUntil)}`}
                  {e.leakage.requiredDecisionDate && ` · decision by ${formatDate(e.leakage.requiredDecisionDate)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {closedCount > 0 && <p className="mt-2 text-xs text-slate-500">{closedCount} closed matter(s).</p>}

      <div className="mt-4">
        <Expander summary="Raise an Assurance matter" testId="create-matter">
          <ActionForm action={createMatterAction} testId="create-matter-form">
            <Hidden name="projectId" value={projectId} />
            <div className="space-y-2">
              <FormGrid cols={3}>
                <TextField name="code" label="Code" required defaultValue={nextCode} />
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
    </Section>
  );
}
