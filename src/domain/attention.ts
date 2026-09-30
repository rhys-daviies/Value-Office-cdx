import type { AssuranceStage } from "./statuses";

// "Needs attention" (Phase 4D.4): conditions derived at read time from fields a matter already has.
// Nothing here is stored, scheduled, assigned or scored — it is a lens on existing data, not a task
// system. Dates are ISO calendar dates (YYYY-MM-DD) compared as UTC days, so the answer is the same
// wherever the server runs.

/** How far ahead a decision or monitor date counts as approaching. A presentation choice, not methodology. */
export const ATTENTION_WINDOW_DAYS = 14;

export type AttentionKind =
  | "escalated"
  | "awaiting_evidence"
  | "no_owner"
  | "unquantified"
  | "decision_overdue"
  | "decision_approaching"
  | "monitor_ended"
  | "monitor_ending";

export type AttentionItem = { kind: AttentionKind; label: string; date?: string };

export type AttentionInput = {
  stage: AssuranceStage | null;
  ownerPersonId: string | null;
  quantified: boolean;
  requiredDecisionDate: string | null;
  monitorUntil: string | null;
};

/** Whole UTC days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const utc = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** Attention conditions for one OPEN matter, most pressing first. */
export function deriveMatterAttention(m: AttentionInput, today: string): AttentionItem[] {
  const out: AttentionItem[] = [];
  if (m.stage === "escalated") out.push({ kind: "escalated", label: "Escalated — decision required" });
  if (m.requiredDecisionDate) {
    const days = daysBetween(today, m.requiredDecisionDate);
    if (days < 0) out.push({ kind: "decision_overdue", label: "Decision date passed", date: m.requiredDecisionDate });
    else if (days <= ATTENTION_WINDOW_DAYS)
      out.push({ kind: "decision_approaching", label: "Decision date approaching", date: m.requiredDecisionDate });
  }
  if (m.stage === "awaiting_evidence") out.push({ kind: "awaiting_evidence", label: "Awaiting evidence" });
  if (!m.ownerPersonId) out.push({ kind: "no_owner", label: "No Risk / Leakage Owner" });
  if (!m.quantified) out.push({ kind: "unquantified", label: "Not yet quantified" });
  if (m.monitorUntil) {
    const days = daysBetween(today, m.monitorUntil);
    if (days < 0) out.push({ kind: "monitor_ended", label: "Monitoring period ended", date: m.monitorUntil });
    else if (days <= ATTENTION_WINDOW_DAYS)
      out.push({ kind: "monitor_ending", label: "Monitoring period ending", date: m.monitorUntil });
  }
  return out;
}

/** Today's ISO date in UTC — the same convention as the rest of the application. */
export const todayIso = () => new Date().toISOString().slice(0, 10);
