import type { RecommendationState } from "./recommendation";
import type { ValueChangeDetermination, ValueChangeStatus } from "./statuses";

// Phase 4D.10H: the governance loop from a management decision to the Authorised Value Case, and the single next
// governed action after authorisation. Read-time derivations from stored facts only — nothing is scheduled or stored,
// and neither a forecast movement nor a decision ever changes the Authorised Value Case by itself.

export const DETERMINATION_LABELS: Record<ValueChangeDetermination, string> = {
  no_value_change_required: "No Value Change Required",
  value_change_proposed: "Value Change Proposed",
};

/** Where one review stands on the question "does this decision require a change to the Authorised Value Case?" */
export type ValueCaseImpactStage =
  | "no_decision" // before a management decision: nothing to determine
  | "awaiting_determination" // decision recorded, impact not yet determined
  | "no_value_change" // determined: no change; the Authorised Value Case stands
  | "proposed_not_prepared" // determined: change proposed; no Value Change prepared yet
  | "change_in_progress" // the resulting Value Change is draft or proposed
  | "change_authorised" // the resulting Value Change was authorised (a new version is in force or superseded)
  | "change_closed"; // the resulting Value Change was rejected or withdrawn

export function valueCaseImpactStage(f: {
  decided: boolean;
  determination: ValueChangeDetermination | null;
  /** Value Change citing the decision, if any (most recent). */
  change: { status: ValueChangeStatus } | null;
}): ValueCaseImpactStage {
  if (!f.decided) return "no_decision";
  if (f.change) {
    if (f.change.status === "authorised") return "change_authorised";
    if (f.change.status === "rejected" || f.change.status === "withdrawn") return "change_closed";
    return "change_in_progress";
  }
  if (!f.determination) return "awaiting_determination";
  return f.determination === "no_value_change_required" ? "no_value_change" : "proposed_not_prepared";
}

export type NextAction = { label: string; href: string };

export type GovernanceFacts = {
  /** An open draft or proposed Value Change (only one can be open). */
  openChange: { id: string; code: string; status: "draft" | "proposed" } | null;
  /** The most recent decision, when it has no determination and no Value Change cites it. */
  awaitingDetermination: { reviewId: string; sequence: number } | null;
  /** The most recent decision, when determined Value Change Proposed and no Value Change cites it yet. */
  proposedNotPrepared: { reviewId: string; sequence: number } | null;
  draftReview: { id: string; sequence: number; recommendation: RecommendationState | null } | null;
  /** Latest review with an issued recommendation and no decision. */
  awaitingDecision: { reviewId: string; sequence: number } | null;
};

/**
 * The single next governed action after authorisation, in a fixed order: finish an open Value Change, determine or
 * act on a decision's Value Case impact, progress the draft review's recommendation, continue the draft review, then
 * record an outstanding management decision. Null when no governed action is pending. (Pre-V1 guidance stays with
 * Mobilisation and ends permanently at authorisation — 4D.10C.)
 */
export function postAuthorisationNextAction(f: GovernanceFacts, base: string): NextAction | null {
  if (f.openChange) {
    return {
      label:
        f.openChange.status === "draft"
          ? `Complete and propose ${f.openChange.code}`
          : `Record the VCO's decision on ${f.openChange.code}`,
      href: `${base}/changes/${f.openChange.id}`,
    };
  }
  if (f.awaitingDetermination) {
    return {
      label: `Determine the Value Case impact of the Review #${f.awaitingDetermination.sequence} decision`,
      href: `${base}/assurance/${f.awaitingDetermination.reviewId}#value-change`,
    };
  }
  if (f.proposedNotPrepared) {
    return {
      label: `Prepare the Value Change proposed in Review #${f.proposedNotPrepared.sequence}`,
      href: `${base}/assurance/${f.proposedNotPrepared.reviewId}#value-change`,
    };
  }
  if (f.draftReview) {
    const { id, sequence, recommendation } = f.draftReview;
    const at = `${base}/assurance/${id}`;
    if (recommendation === "in_internal_review")
      return {
        label: `Complete the internal recommendation review (Review #${sequence})`,
        href: `${at}#recommendation`,
      };
    if (recommendation === "ready_to_issue")
      return { label: `Issue the recommendation to management (Review #${sequence})`, href: `${at}#recommendation` };
  }
  if (f.awaitingDecision) {
    return {
      label: `Record the management decision (Review #${f.awaitingDecision.sequence})`,
      href: `${base}/assurance/${f.awaitingDecision.reviewId}#decision`,
    };
  }
  if (f.draftReview) {
    return {
      label: `Continue draft Assurance Review #${f.draftReview.sequence}`,
      href: `${base}/assurance/${f.draftReview.id}`,
    };
  }
  return null;
}
