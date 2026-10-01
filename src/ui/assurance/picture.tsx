import type { PositionTotals } from "@/domain/assurance";
import type { ContinuousAssuranceWorkspace } from "@/server/queries/workspace";

import { GovernedTag, WorkingTag } from "../components/badges";
import { formatMoneyShort } from "../format";
import { change, Figure, forecastHeadline, headline, NOT_ASSESSED, realisedHeadline } from "./display";

// The operating picture (Phase 4D.4): the governed position and the working picture side by side,
// each labelled, never summed or netted together. Working Value Leakage is not the Value Gap.

export function GovernedPosition({
  authorisedVersion,
  authorisedTotal,
  totals,
  reviewSequence,
  againstVersion = null,
  currency,
  prefix,
}: {
  authorisedVersion: number;
  authorisedTotal: string | null;
  totals: PositionTotals | null;
  reviewSequence: number | null;
  /** Version the latest review measured against; after a Value Change it can predate the version in force. */
  againstVersion?: number | null;
  currency: string;
  /** Test-id prefix, kept per page for the existing journeys ("assurance" / "overview"). */
  prefix: "assurance" | "overview";
}) {
  const forecast = totals
    ? forecastHeadline(totals, currency)
    : { value: NOT_ASSESSED, note: "No finalised review yet" };
  const realised = totals
    ? realisedHeadline(totals, currency)
    : { value: NOT_ASSESSED, note: "No finalised review yet" };
  // The latest formal position keeps its own basis: its Value Gap is against the version it measured,
  // never recomputed against a later Authorised version. Say so when the two differ.
  const olderBasis = totals !== null && againstVersion !== null && againstVersion !== authorisedVersion;
  return (
    <div className="rounded-lg border border-slate-300 bg-slate-50 p-3" data-testid={`${prefix}-governed`}>
      <h3 className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
        Governed position
        <GovernedTag>
          Authorised V{authorisedVersion}
          {reviewSequence !== null ? ` · Review #${reviewSequence}${olderBasis ? ` vs V${againstVersion}` : ""}` : ""}
        </GovernedTag>
      </h3>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label={`Authorised Value (V${authorisedVersion})`}
          value={formatMoneyShort(authorisedTotal, currency)}
          testId={`${prefix}-authorised${prefix === "overview" ? "-value" : ""}`}
        />
        <Figure
          label="Current Forecast (latest formal)"
          value={forecast.value}
          note={forecast.note}
          testId={`${prefix}-forecast`}
          emphasis
        />
        <Figure label="Realised Value" value={realised.value} note={realised.note} testId={`${prefix}-realised`} />
        <Figure
          label="Value Gap"
          value={totals ? headline(totals.valueGap, currency, "Incomplete") : NOT_ASSESSED}
          note={
            olderBasis
              ? `Review #${reviewSequence} vs Authorised V${againstVersion} (${formatMoneyShort(totals!.authorisedTotal, currency)}) · no formal review against V${authorisedVersion} yet`
              : totals
                ? `Authorised − Forecast · movement ${change(totals.movement, currency, "incomplete")}`
                : "Authorised − Forecast"
          }
          testId={`${prefix}-gap`}
        />
      </div>
    </div>
  );
}

export function WorkingPicture({
  workspace,
  currency,
  href,
}: {
  workspace: ContinuousAssuranceWorkspace;
  currency: string;
  href?: string;
}) {
  const { working, attention, stageCounts } = workspace;
  return (
    <div
      className="rounded-lg border border-dashed border-violet-300 bg-violet-50/60 p-3"
      data-testid="working-picture"
    >
      <h3 className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
        Working picture
        <WorkingTag>Working · not formally reviewed</WorkingTag>
        {href && (
          <a href={href} className="ml-auto text-xs font-normal text-sky-800 underline">
            Open matters
          </a>
        )}
      </h3>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <WorkingFigure
          label="Active Assurance matters"
          value={String(working.openCount)}
          note={
            attention.needsAttention
              ? `${attention.needsAttention} need attention`
              : working.openCount
                ? "None need attention"
                : undefined
          }
          testId="working-active-matters"
        />
        <WorkingFigure
          label="Working Value Leakage"
          value={
            working.total === null
              ? working.openCount
                ? "Not yet quantified"
                : "None"
              : formatMoneyShort(working.total, currency)
          }
          note={
            working.unquantifiedCount > 0 && working.total !== null
              ? `+ ${working.unquantifiedCount} matter${working.unquantifiedCount === 1 ? "" : "s"} not yet quantified`
              : working.unquantifiedCount > 0
                ? `${working.unquantifiedCount} matter${working.unquantifiedCount === 1 ? "" : "s"} not yet quantified`
                : working.quantifiedCount
                  ? `${working.quantifiedCount} quantified matter${working.quantifiedCount === 1 ? "" : "s"}`
                  : undefined
          }
          testId="working-leakage-total"
          dashed
        />
        <WorkingFigure
          label="Recoverable / Unrecoverable (working)"
          value={
            working.total === null
              ? "—"
              : `${formatMoneyShort(working.recoverable, currency)} / ${formatMoneyShort(working.unrecoverable, currency)}`
          }
          note="Recoverable = Total − Unrecoverable"
          testId="working-leakage-split"
          dashed
        />
        <WorkingFigure
          label="Awaiting evidence / Escalated"
          value={`${stageCounts.awaiting_evidence} / ${stageCounts.escalated}`}
          note={
            attention.noOwner || attention.decisionDates
              ? [
                  attention.noOwner && `${attention.noOwner} without owner`,
                  attention.decisionDates &&
                    `${attention.decisionDates} decision date${attention.decisionDates === 1 ? "" : "s"} due`,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : undefined
          }
          testId="working-attention"
        />
      </div>
      <p className="mt-2 text-xs text-violet-900">
        Working figures are the consultant&apos;s current view. They are not added to or netted against the Value Gap,
        and become formal only through an Assurance Review.
      </p>
    </div>
  );
}

function WorkingFigure({
  label,
  value,
  note,
  testId,
  dashed,
}: {
  label: string;
  value: string;
  note?: string;
  testId: string;
  dashed?: boolean;
}) {
  return (
    <div className="rounded-lg border border-violet-200 bg-white p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p
        className={`mt-1 font-semibold text-violet-950 ${value.length > 12 ? "text-lg" : "text-2xl"} ${dashed ? "w-fit border-b border-dashed border-violet-400" : ""}`}
        data-testid={testId}
      >
        {value}
      </p>
      {note && (
        <p className="mt-0.5 text-xs text-slate-600" data-testid={`${testId}-note`}>
          {note}
        </p>
      )}
    </div>
  );
}
