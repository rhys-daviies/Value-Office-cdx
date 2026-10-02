import type { ReactNode } from "react";

import {
  setVersionBasisAction,
  removeTrajectoryPointAction,
  saveTrajectoryPointAction,
} from "@/server/actions/trajectory";
import { VALUE_BASIS_KINDS, type ValueBasisKind } from "@/domain/statuses";
import { comparePhasing, sortMilestones, type TerminalReconciliation } from "@/domain/trajectory";
import type {
  ReviewTrajectoryAuthoring,
  TrajectoryPoint,
  VersionTrajectoryAuthoring,
} from "@/server/queries/trajectory";
import { ActionForm, FieldError, SubmitButton } from "@/ui/components/action-form";
import { LockedBadge } from "@/ui/components/badges";
import { DateField, Hidden, SelectField } from "@/ui/components/fields";
import { KeyValues, Notice } from "@/ui/components/layout";
import { formatDate, formatMoneyChange, formatMoneyShort, formatPeriod, moneyInputValue } from "@/ui/format";
import { TRAJECTORY_STATUS_LABELS, VALUE_BASIS_LABELS, VALUE_BASIS_TRAJECTORY_NOTES } from "@/ui/labels";

// Value Trajectory authoring (Phase 4D.9D). Consultants establish dated value milestones; nothing is generated,
// interpolated or auto-reconciled. Server components: amounts and differences arrive as decimal strings computed on
// the server, so the browser does no financial arithmetic. Edit controls appear only while the parent is editable.

type Parent = "version" | "review" | "scenario";

const CHANGE_TAG = {
  unchanged: { label: "as authorised", cls: "border-slate-200 text-slate-500" },
  changed: { label: "re-phased", cls: "border-amber-300 text-amber-800" },
  added: { label: "new", cls: "border-sky-300 text-sky-800" },
} as const;

/** One-line terminal reconciliation status. */
export function ReconciliationLine({
  reconciliation,
  governedLabel,
  gate,
  currency,
  testId,
}: {
  reconciliation: TerminalReconciliation;
  governedLabel: string;
  gate: string;
  currency: string;
  testId: string;
}) {
  const r = reconciliation;
  const base = "mt-2 rounded border px-3 py-2 text-sm";
  if (r.state === "no_points") {
    return (
      <p className={`${base} border-slate-200 bg-slate-50 text-slate-600`} data-testid={testId} data-state={r.state}>
        {TRAJECTORY_STATUS_LABELS.phasing_not_entered}. Phasing is optional.
      </p>
    );
  }
  if (r.state === "reconciled") {
    return (
      <p
        className={`${base} border-emerald-200 bg-emerald-50 text-emerald-900`}
        data-testid={testId}
        data-state={r.state}
      >
        Terminal milestone {formatMoneyShort(r.terminal, currency)} · {governedLabel}{" "}
        {formatMoneyShort(r.governed, currency)} · <strong>Reconciled</strong>
      </p>
    );
  }
  const message =
    r.state === "no_terminal"
      ? `No milestone on the Value Period end (${formatDate(r.periodEnd)}) — must reconcile before ${gate}`
      : r.state === "governed_missing"
        ? `${governedLabel} is not complete yet — milestones cannot be kept at ${gate} until it is`
        : `Terminal milestone ${formatMoneyShort(r.terminal, currency)} · ${governedLabel} ${formatMoneyShort(r.governed, currency)} · ${formatMoneyChange(r.difference, currency)} difference — must reconcile before ${gate}`;
  return (
    <p className={`${base} border-amber-300 bg-amber-50 text-amber-900`} data-testid={testId} data-state={r.state}>
      {message}
    </p>
  );
}

const compactInput =
  "block w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none";

/** Date · value · note inputs on one line (labels for screen readers; amounts accept 4.8m, 250k, 1,200,000). */
function MilestoneInputs({ point, submit }: { point?: TrajectoryPoint; submit: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-[9.5rem_8.5rem_1fr_auto]">
      <label>
        <span className="sr-only">Date</span>
        <input type="date" name="asOf" required defaultValue={point?.asOf} className={compactInput} />
        <FieldError name="asOf" />
      </label>
      <label>
        <span className="sr-only">Value</span>
        <input
          type="text"
          name="value"
          required
          inputMode="decimal"
          placeholder="e.g. 6m"
          defaultValue={point ? moneyInputValue(point.value) : undefined}
          className={compactInput}
        />
        <FieldError name="value" />
      </label>
      <label>
        <span className="sr-only">Note</span>
        <input
          type="text"
          name="note"
          placeholder="Note (optional)"
          defaultValue={point?.note ?? undefined}
          className={compactInput}
        />
      </label>
      <div>{submit}</div>
    </div>
  );
}

/** Dated milestones of one line: one-line rows, edited in place while editable, read-only otherwise. */
export function MilestoneEditor({
  projectId,
  parent,
  parentId,
  points,
  periodEnd,
  editable,
  currency,
  dateHint,
  previous,
  testId,
}: {
  projectId: string;
  parent: Parent;
  parentId: string;
  points: TrajectoryPoint[];
  periodEnd: string | null;
  editable: boolean;
  currency: string;
  dateHint: string;
  /** Plan copied from an earlier version (Value Change): rows are tagged against it. */
  previous?: { versionNumber: number; points: TrajectoryPoint[] };
  testId: string;
}) {
  const rows = sortMilestones(points);
  const comparison = previous ? comparePhasing(rows, previous.points) : null;
  const hidden = (
    <>
      <Hidden name="projectId" value={projectId} />
      <Hidden name="parent" value={parent} />
      <Hidden name="parentId" value={parentId} />
    </>
  );
  return (
    <div data-testid={testId}>
      {rows.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded border border-slate-200">
          {rows.map((p) => {
            const tag = comparison?.changes.get(p.asOf);
            return (
              <li key={p.id} className="px-3 py-1.5" data-testid="milestone" data-as-of={p.asOf} data-value={p.value}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="w-28 text-slate-600">{formatDate(p.asOf)}</span>
                  <span className="w-20 font-semibold tabular-nums" data-testid="milestone-value">
                    {formatMoneyShort(p.value, currency)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-slate-500">{p.note}</span>
                  {p.asOf === periodEnd && (
                    <span
                      className="rounded border border-slate-300 bg-slate-100 px-1.5 text-[11px] font-medium text-slate-700"
                      data-testid="milestone-terminal"
                    >
                      Value Period end
                    </span>
                  )}
                  {tag && (
                    <span
                      className={`rounded border px-1.5 text-[11px] ${CHANGE_TAG[tag].cls}`}
                      data-testid="milestone-change"
                    >
                      {CHANGE_TAG[tag].label}
                    </span>
                  )}
                  {editable && (
                    <ActionForm action={removeTrajectoryPointAction} showSuccess={false}>
                      {hidden}
                      <Hidden name="pointId" value={p.id} />
                      <button
                        type="submit"
                        className="text-xs text-red-700 hover:underline"
                        data-testid="milestone-remove"
                      >
                        Remove
                      </button>
                    </ActionForm>
                  )}
                </div>
                {editable && (
                  <details className="group mt-1" data-testid="milestone-edit">
                    <summary className="cursor-pointer text-xs text-slate-600 select-none hover:text-slate-900">
                      Edit
                    </summary>
                    <ActionForm action={saveTrajectoryPointAction} className="mt-1" showSuccess={false}>
                      {hidden}
                      <Hidden name="pointId" value={p.id} />
                      <Hidden name="previousAsOf" value={p.asOf} />
                      <MilestoneInputs point={p} submit={<SubmitButton variant="secondary">Save</SubmitButton>} />
                    </ActionForm>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {comparison && comparison.removed.length > 0 && (
        <p className="mt-1 text-xs text-slate-500" data-testid="milestones-removed">
          Removed from V{previous!.versionNumber}:{" "}
          {comparison.removed.map((m) => `${formatDate(m.asOf)} ${formatMoneyShort(m.value, currency)}`).join(", ")}
        </p>
      )}
      {editable && (
        <details className="mt-2" open={rows.length === 0} data-testid={`${testId}-add`}>
          <summary className="cursor-pointer text-sm font-medium text-slate-800 select-none">+ Add milestone</summary>
          <ActionForm action={saveTrajectoryPointAction} resetOnSuccess className="mt-2">
            {hidden}
            <MilestoneInputs submit={<SubmitButton variant="secondary">Add</SubmitButton>} />
            <p className="mt-1 text-xs text-slate-500">{dateHint}</p>
          </ActionForm>
        </details>
      )}
    </div>
  );
}

const kindOptions = (kinds: readonly ValueBasisKind[]) =>
  kinds.map((k) => ({ value: k, label: VALUE_BASIS_LABELS[k] }));

/** A Value Case version's basis kind, Value Period and authorised plan milestones. */
export function VersionTrajectorySection({
  projectId,
  currency,
  authoring: a,
  project,
}: {
  projectId: string;
  currency: string;
  authoring: VersionTrajectoryAuthoring;
  /** Project setup (description shown; dates offered as a pre-fill only). */
  project: { valueBasisDescription: string | null; valuePeriodStart: string | null; valuePeriodEnd: string | null };
}) {
  const v = a.version;
  const kind = v.valueBasisKind;
  const lockedKind = a.inheritedKind;
  const prefill = !v.valuePeriodStart && !v.valuePeriodEnd;
  const rephasing = a.previous && a.previous.points.length > 0;
  return (
    <div className="space-y-4" data-testid="version-trajectory" data-status={a.status}>
      <div>
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
          Value Basis and Value Period
          {!a.editable && <LockedBadge />}
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Basis description (project): {project.valueBasisDescription ?? "not recorded"}
        </p>
        {a.editable ? (
          <ActionForm action={setVersionBasisAction} className="mt-2" testId="version-basis-form">
            <Hidden name="projectId" value={projectId} />
            <Hidden name="versionId" value={v.id} />
            <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[14rem_10rem_10rem_auto]">
              {lockedKind ? (
                <div className="text-sm">
                  <span className="block text-xs font-medium text-slate-600">Value Basis</span>
                  <span className="mt-1 block py-1.5 font-medium" data-testid="basis-kind-fixed">
                    {VALUE_BASIS_LABELS[lockedKind]}
                  </span>
                  <Hidden name="valueBasisKind" value={lockedKind} />
                </div>
              ) : (
                <SelectField
                  name="valueBasisKind"
                  label="Value Basis"
                  placeholder="— Not classified —"
                  defaultValue={kind}
                  options={kindOptions(VALUE_BASIS_KINDS)}
                />
              )}
              <DateField
                name="valuePeriodStart"
                label="Period start"
                defaultValue={v.valuePeriodStart ?? project.valuePeriodStart}
              />
              <DateField
                name="valuePeriodEnd"
                label="Period end"
                defaultValue={v.valuePeriodEnd ?? project.valuePeriodEnd}
              />
              <div>
                <SubmitButton variant="secondary">Save basis</SubmitButton>
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {lockedKind
                ? `Fixed by V${a.previous?.versionNumber ?? ""} — a later version keeps the same basis.`
                : "Cumulative Benefit and Annual Run Rate support a trajectory; NPV and Other do not."}
              {prefill && (project.valuePeriodStart || project.valuePeriodEnd)
                ? " Dates pre-filled from project setup — not saved until you save."
                : ""}
            </p>
          </ActionForm>
        ) : (
          <div className="mt-2">
            <KeyValues
              items={[
                ["Value Basis", kind ? VALUE_BASIS_LABELS[kind] : TRAJECTORY_STATUS_LABELS.basis_not_classified],
                [
                  "Value Period",
                  v.valuePeriodStart || v.valuePeriodEnd
                    ? formatPeriod(v.valuePeriodStart, v.valuePeriodEnd)
                    : TRAJECTORY_STATUS_LABELS.period_not_set,
                ],
              ]}
            />
          </div>
        )}
        {kind && (
          <p className="mt-2 text-xs text-slate-600" data-testid="basis-note">
            {VALUE_BASIS_TRAJECTORY_NOTES[kind]}
            {kind === "annual_run_rate"
              ? " Realised value is cumulative, so it is not plotted against a run-rate."
              : ""}
          </p>
        )}
        {a.previous &&
          (a.previous.valuePeriodEnd !== v.valuePeriodEnd || a.previous.valuePeriodStart !== v.valuePeriodStart) && (
            <p className="mt-1 text-xs text-amber-800" data-testid="period-changed">
              Value Period changed from V{a.previous.versionNumber} (
              {formatPeriod(a.previous.valuePeriodStart, a.previous.valuePeriodEnd)}).
            </p>
          )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-800">Planned value milestones</h3>
        {a.measure === null ? (
          <p className="mt-1 text-sm text-slate-600" data-testid="trajectory-unavailable">
            {TRAJECTORY_STATUS_LABELS[a.status]}.{" "}
            {a.status === "basis_not_supported" && kind ? VALUE_BASIS_TRAJECTORY_NOTES[kind] : ""}
          </p>
        ) : !v.valuePeriodStart || !v.valuePeriodEnd ? (
          <p className="mt-1 text-sm text-slate-600" data-testid="trajectory-unavailable">
            {TRAJECTORY_STATUS_LABELS.period_not_set}. Save the Value Period to enter milestones.
          </p>
        ) : (
          <>
            <p className="mt-1 mb-2 text-xs text-slate-500">
              {a.measure === "cumulative" ? "Cumulative value" : "Annualised run-rate"} at each milestone,{" "}
              {formatPeriod(v.valuePeriodStart, v.valuePeriodEnd)}.
              {rephasing
                ? ` Copied from Authorised V${a.previous!.versionNumber}; edits here re-phase the proposed V${v.versionNumber} — V${a.previous!.versionNumber} is unchanged.`
                : ""}
            </p>
            <MilestoneEditor
              projectId={projectId}
              parent="version"
              parentId={v.id}
              points={a.points}
              periodEnd={v.valuePeriodEnd}
              editable={a.editable}
              currency={currency}
              dateHint={`Any date from ${formatDate(v.valuePeriodStart)} to ${formatDate(v.valuePeriodEnd)}. The final milestone falls on the period end.`}
              previous={
                rephasing ? { versionNumber: a.previous!.versionNumber, points: a.previous!.points } : undefined
              }
              testId="plan-milestones"
            />
            {a.reconciliation && (
              <ReconciliationLine
                reconciliation={a.reconciliation}
                governedLabel="Version total"
                gate="proposal"
                currency={currency}
                testId="plan-reconciliation"
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Why a review's forecast / option paths cannot be authored (the governing version's setup). */
function reviewUnavailable(a: ReviewTrajectoryAuthoring): ReactNode {
  const v = a.governing;
  if (a.measure === null) {
    return `${TRAJECTORY_STATUS_LABELS[v.valueBasisKind ? "basis_not_supported" : "basis_not_classified"]} on V${v.versionNumber}${
      v.valueBasisKind ? ` — ${VALUE_BASIS_TRAJECTORY_NOTES[v.valueBasisKind]}` : ""
    }`;
  }
  if (!v.valuePeriodStart || !v.valuePeriodEnd)
    return `${TRAJECTORY_STATUS_LABELS.period_not_set} on V${v.versionNumber}`;
  return null;
}

/** Formal forecast milestones of a review (after the review date, to the governing Value Period end). */
export function ForecastTrajectorySection({
  projectId,
  reviewId,
  currency,
  authoring: a,
}: {
  projectId: string;
  reviewId: string;
  currency: string;
  authoring: ReviewTrajectoryAuthoring;
}) {
  const unavailable = reviewUnavailable(a);
  const v = a.governing;
  return (
    <div data-testid="forecast-trajectory">
      {unavailable ? (
        <p className="text-sm text-slate-600" data-testid="trajectory-unavailable">
          {unavailable}. Forecast milestones are not available for this review.
        </p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-sm" data-testid="forecast-context">
            <span>
              Review date <strong>{formatDate(a.reviewDate)}</strong>
            </span>
            <span>
              Value Period end <strong>{formatDate(v.valuePeriodEnd)}</strong>
            </span>
            <span>
              Formal forecast{" "}
              <strong data-testid="forecast-terminal-amount">
                {a.forecast.total === null ? "incomplete" : formatMoneyShort(a.forecast.total, currency)}
              </strong>
            </span>
            {!a.forecast.editable && <LockedBadge />}
          </div>
          <MilestoneEditor
            projectId={projectId}
            parent="review"
            parentId={reviewId}
            points={a.forecast.points}
            periodEnd={v.valuePeriodEnd}
            editable={a.forecast.editable}
            currency={currency}
            dateHint={`After ${formatDate(a.reviewDate)}, up to ${formatDate(v.valuePeriodEnd)}. The milestone on the period end must equal the formal forecast.`}
            testId="forecast-milestones"
          />
          {a.forecast.reconciliation && (
            <ReconciliationLine
              reconciliation={a.forecast.reconciliation}
              governedLabel="Formal forecast"
              gate="finalisation"
              currency={currency}
              testId="forecast-reconciliation"
            />
          )}
        </>
      )}
    </div>
  );
}

/** Each stored option's path from the review date (no special treatment for delayed action). */
export function OptionPathsSection({
  projectId,
  currency,
  authoring: a,
}: {
  projectId: string;
  currency: string;
  authoring: ReviewTrajectoryAuthoring;
}) {
  if (a.options.length === 0) return null;
  const unavailable = reviewUnavailable(a);
  const v = a.governing;
  return (
    <div className="mt-6" data-testid="option-paths">
      <h3 className="text-sm font-semibold text-slate-800">Option paths</h3>
      {unavailable ? (
        <p className="mt-1 text-sm text-slate-600" data-testid="trajectory-unavailable">
          {unavailable}. Option paths are not available for this review.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-slate-500">
            Optional dated milestones for each option, after {formatDate(a.reviewDate)}. Each path&apos;s milestone on{" "}
            {formatDate(v.valuePeriodEnd)} must equal the option total before the recommendation is issued.
          </p>
          {a.recommendationIssued && !a.finalised && (
            <Notice tone="locked">Option paths are frozen: Cardaxia&apos;s recommendation has been issued.</Notice>
          )}
          <div className="mt-3 space-y-4">
            {a.options.map((o) => (
              <div key={o.scenarioId} className="rounded border border-slate-200 p-3" data-testid="option-path">
                <p className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <strong data-testid="option-path-label">{o.label}</strong>
                  <span className="text-slate-500">· option total {formatMoneyShort(o.totalValue, currency)}</span>
                  {!o.editable && <LockedBadge />}
                </p>
                <MilestoneEditor
                  projectId={projectId}
                  parent="scenario"
                  parentId={o.scenarioId}
                  points={o.points}
                  periodEnd={v.valuePeriodEnd}
                  editable={o.editable}
                  currency={currency}
                  dateHint={`After ${formatDate(a.reviewDate)}, up to ${formatDate(v.valuePeriodEnd)}.`}
                  testId="option-milestones"
                />
                {o.reconciliation && (
                  <ReconciliationLine
                    reconciliation={o.reconciliation}
                    governedLabel="Option total"
                    gate="the recommendation is issued"
                    currency={currency}
                    testId="option-reconciliation"
                  />
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
