import type { AssuranceStage } from "./statuses";

// Assurance operating workflow (Phase 4D.10F): read-time lenses on fields an Assurance matter already has. Nothing
// here is stored, sets a stage or blocks anything — the working stage stays the consultant's explicit choice, and
// outstanding evidence requests never gate a review. Presentation only, not methodology.

/** Information Request items linked to one matter, counted by item status. */
export type RequestCounts = { open: number; partial: number; received: number; unavailable: number };

export const NO_REQUESTS: RequestCounts = { open: 0, partial: 0, received: 0, unavailable: 0 };

export type EvidenceRequestState = {
  state: "requested" | "partial" | "received" | "unavailable";
  label: string;
  /** Items still open or partially received. */
  outstanding: number;
};

/** Status of the evidence requested for a matter; null when nothing has been requested. */
export function evidenceRequestState(c: RequestCounts): EvidenceRequestState | null {
  const total = c.open + c.partial + c.received + c.unavailable;
  if (total === 0) return null;
  const outstanding = c.open + c.partial;
  const items = (n: number) => `${n} item${n === 1 ? "" : "s"}`;
  if (outstanding > 0) {
    const some = c.partial > 0 || c.received > 0;
    return {
      state: some ? "partial" : "requested",
      label: `${some ? "Evidence partially received" : "Evidence requested"} · ${items(outstanding)} outstanding`,
      outstanding,
    };
  }
  if (c.received === 0) return { state: "unavailable", label: "Evidence unavailable", outstanding: 0 };
  return {
    state: "received",
    label: c.unavailable > 0 ? `Evidence received · ${items(c.unavailable)} unavailable` : "Evidence received",
    outstanding: 0,
  };
}

export type MatterWorkflowInput = {
  status: "open" | "closed";
  stage: AssuranceStage | null;
  evidenceLinked: number;
  requests: RequestCounts;
  quantified: boolean;
  remediationPlan: string | null;
  monitorUntil: string | null;
  /** Finalised reviews that recorded the matter. */
  formalReviews: number;
  /** The open draft review, when one exists (open matters are recorded in it at finalisation). */
  draftReviewSequence: number | null;
};

export type MatterWorkflowStep = {
  key: "identified" | "evidence" | "leakage" | "remediation" | "monitoring" | "formal";
  label: string;
  done: boolean;
  detail: string;
  /** ISO date the detail refers to (formatted by the UI). */
  date?: string;
};

/**
 * The matter's operating sequence — risk identified → evidence → Value Leakage → remediation → monitoring → formal
 * review — read from what is recorded. Steps can be completed in any order; a step is "done" only when its own field
 * is recorded.
 */
export function matterWorkflow(m: MatterWorkflowInput): MatterWorkflowStep[] {
  const req = evidenceRequestState(m.requests);
  const evidenceDetail = [
    m.evidenceLinked > 0 ? `${m.evidenceLinked} supporting` : null,
    req ? req.label : null,
  ].filter(Boolean);
  return [
    { key: "identified", label: "Risk identified", done: true, detail: m.status === "closed" ? "Closed" : "Open" },
    {
      key: "evidence",
      label: "Evidence",
      done: m.evidenceLinked > 0 || (req !== null && req.outstanding === 0),
      detail: evidenceDetail.length ? evidenceDetail.join(" · ") : "None linked or requested",
    },
    {
      key: "leakage",
      label: "Value Leakage assessed",
      done: m.quantified,
      detail: m.quantified ? "Working assessment recorded" : "Not yet quantified",
    },
    {
      key: "remediation",
      label: "Remediation planned",
      done: Boolean(m.remediationPlan),
      detail: m.remediationPlan ? "Plan recorded" : "No plan",
    },
    {
      key: "monitoring",
      label: "Monitored",
      done: Boolean(m.monitorUntil) || m.stage === "monitoring",
      detail: m.monitorUntil ? "Monitor until" : m.stage === "monitoring" ? "Monitoring" : "Not set",
      ...(m.monitorUntil ? { date: m.monitorUntil } : {}),
    },
    {
      key: "formal",
      label: "Formal review",
      done: m.formalReviews > 0,
      detail:
        m.draftReviewSequence !== null && m.status === "open"
          ? `To be recorded in Review #${m.draftReviewSequence} (draft)`
          : m.formalReviews > 0
            ? `Recorded in ${m.formalReviews} finalised review${m.formalReviews === 1 ? "" : "s"}`
            : "Recorded when the next formal review is finalised",
    },
  ];
}
