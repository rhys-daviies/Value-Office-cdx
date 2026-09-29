import type { AssuranceTrigger } from "./statuses";

// Mandatory Value Assurance cadence (PMO): Kick-off, Go-Live, every six months,
// and material change to evidence. This derives only what existing data supports.
// Nothing is scheduled, monitored or notified — consultants open reviews manually.
//
// Six-monthly cadence is anchored on Go-Live (PMO decision): Go-Live + 6k months.
// Without a Go-Live date it is not derived unless six-month key dates are recorded.
// The basis is stated alongside each date so no false precision is implied.

export type RequirementStatus = "due" | "in_progress" | "upcoming" | "satisfied" | "unknown";

export type AssuranceRequirement = {
  trigger: AssuranceTrigger;
  label: string;
  status: RequirementStatus;
  date: string | null;
  basis: string;
  evidence?: { id: string; code: string; title: string }[];
};

export type CadenceInput = {
  today: string;
  authorised: boolean;
  /** When V1 authorisation was recorded; material evidence before it belongs to Re-Qualification. */
  authorisationRecordedAt: Date | null;
  keyDates: readonly { kind: string; date: string }[];
  reviews: readonly {
    id: string;
    sequence: number;
    trigger: AssuranceTrigger;
    status: "draft" | "finalised";
    reviewDate: string;
    finalisedAt: Date | null;
    triggerEvidenceId: string | null;
  }[];
  /** Material-change evidence with the reviews it is already associated with (trigger or link). */
  materialEvidence: readonly {
    id: string;
    code: string;
    title: string;
    createdAt: Date;
    reviewIds: readonly string[];
  }[];
};

/** Adds calendar months to an ISO date, clamping to the month's last day (31 Aug + 6 → 28/29 Feb). */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function deriveAssuranceRequirements(input: CadenceInput): AssuranceRequirement[] {
  if (!input.authorised) return [];
  const { today, reviews } = input;
  const finalised = reviews.filter((r) => r.status === "finalised");
  const draft = reviews.find((r) => r.status === "draft");
  const byTrigger = (t: AssuranceTrigger) => ({
    done: finalised.some((r) => r.trigger === t),
    inProgress: draft?.trigger === t,
  });
  const dated = (date: string | null): RequirementStatus => (date === null || date <= today ? "due" : "upcoming");
  const keyDate = (kind: string) => input.keyDates.find((k) => k.kind === kind)?.date ?? null;
  const out: AssuranceRequirement[] = [];

  // Kick-off
  {
    const date = keyDate("kickoff");
    const s = byTrigger("kickoff");
    out.push({
      trigger: "kickoff",
      label: "Kick-off review",
      status: s.done ? "satisfied" : s.inProgress ? "in_progress" : dated(date),
      date,
      basis: date ? "Kick-off key date" : "No kick-off date recorded",
    });
  }

  // Go-Live
  {
    const date = keyDate("go_live");
    const s = byTrigger("go_live");
    out.push({
      trigger: "go_live",
      label: "Go-Live review",
      status: s.done ? "satisfied" : s.inProgress ? "in_progress" : date === null ? "unknown" : dated(date),
      date,
      basis: date ? "Go-Live key date" : "Record the Go-Live date in Setup to derive this",
    });
  }

  // Six-monthly, anchored on Go-Live: Go-Live + 6, +12, +18 … months. Each
  // occurrence is computed from the anchor (never chained), so month-end clamping
  // cannot drift, and a review done early or late does not move later dates.
  // Finalised six-month reviews satisfy occurrences in order.
  {
    const goLive = keyDate("go_live");
    const done = finalised.filter((r) => r.trigger === "six_month").length;
    const inProgress = draft?.trigger === "six_month";
    const explicit = input.keyDates
      .filter((k) => k.kind === "six_month_review")
      .map((k) => k.date)
      .sort();
    if (goLive) {
      const occurrence = done + 1;
      const date = addMonths(goLive, 6 * occurrence);
      out.push({
        trigger: "six_month",
        label: "Six-month review",
        status: inProgress ? "in_progress" : dated(date),
        date,
        basis: `Go-Live (${goLive}) + ${6 * occurrence} months; ${done} six-month review${done === 1 ? "" : "s"} finalised`,
      });
    } else if (explicit.length > 0) {
      const date = explicit[done] ?? null;
      out.push({
        trigger: "six_month",
        label: "Six-month review",
        status: inProgress ? "in_progress" : date === null ? "satisfied" : dated(date),
        date,
        basis: "Recorded six-month review key date (no Go-Live date recorded)",
      });
    } else {
      out.push({
        trigger: "six_month",
        label: "Six-month review",
        status: inProgress ? "in_progress" : "unknown",
        date: null,
        basis: "Record the Go-Live date in Setup to derive the six-monthly cadence",
      });
    }
  }

  // Material evidence change
  {
    const since = finalised.reduce<Date | null>(
      (latest, r) => (r.finalisedAt && (!latest || r.finalisedAt > latest) ? r.finalisedAt : latest),
      input.authorisationRecordedAt,
    );
    const pending = input.materialEvidence.filter(
      (e) => (!since || e.createdAt > since) && !e.reviewIds.some((id) => finalised.some((r) => r.id === id)),
    );
    if (pending.length > 0) {
      const inDraft = draft && pending.every((e) => e.reviewIds.includes(draft.id));
      out.push({
        trigger: "material_evidence_change",
        label: "Material evidence review",
        status: inDraft ? "in_progress" : "due",
        date: null,
        basis: "Material-change evidence recorded since the latest finalised position and not yet reviewed",
        evidence: pending.map(({ id, code, title }) => ({ id, code, title })),
      });
    }
  }

  return out;
}

/** The single most pressing requirement: due first, then in progress, then the next upcoming date. */
export function nextRequirement(reqs: readonly AssuranceRequirement[]): AssuranceRequirement | null {
  return (
    reqs.find((r) => r.status === "due") ??
    reqs.find((r) => r.status === "in_progress") ??
    [...reqs].filter((r) => r.status === "upcoming").sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))[0] ??
    null
  );
}
