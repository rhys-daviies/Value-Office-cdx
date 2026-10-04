import { money, sumMoney, toDbMoney } from "./money";
import {
  EVIDENCE_STATUSES,
  QUALIFICATION_STATUSES,
  type EvidenceStatus,
  type QualificationStatus,
  type VersionKind,
  type VersionStatus,
} from "./statuses";

// Counts and totals only. This deliberately computes no score, weighting or
// "readiness" measure — that would be methodology (PMO decision).

export type DriverForSummary = {
  financialValue: string | null;
  qualificationStatus: QualificationStatus;
  evidenceStatus: EvidenceStatus;
  avoPersonId: string | null;
  evidenceLinkCount: number;
};

export type DriverSummary = {
  driverCount: number;
  /** Sum of financial drivers only; non-financial drivers (null value) are excluded. */
  financialTotal: string;
  financialCount: number;
  nonFinancialCount: number;
  qualification: Record<QualificationStatus, number>;
  evidence: Record<EvidenceStatus, number>;
  withoutEvidenceLinks: number;
  withoutAvo: number;
};

export function summariseDrivers(drivers: readonly DriverForSummary[]): DriverSummary {
  const financial = drivers.flatMap((d) => (d.financialValue === null ? [] : [d.financialValue]));
  const count = <T extends string>(keys: readonly T[], pick: (d: DriverForSummary) => T) =>
    Object.fromEntries(keys.map((k) => [k, drivers.filter((d) => pick(d) === k).length])) as Record<T, number>;
  return {
    driverCount: drivers.length,
    financialTotal: toDbMoney(sumMoney(financial)),
    financialCount: financial.length,
    nonFinancialCount: drivers.length - financial.length,
    qualification: count(QUALIFICATION_STATUSES, (d) => d.qualificationStatus),
    evidence: count(EVIDENCE_STATUSES, (d) => d.evidenceStatus),
    withoutEvidenceLinks: drivers.filter((d) => d.evidenceLinkCount === 0).length,
    withoutAvo: drivers.filter((d) => d.avoPersonId === null).length,
  };
}

/** Difference between two amounts (b − a), or null when either is unknown. */
export function moneyChange(from: string | null, to: string | null): string | null {
  if (from === null || to === null) return null;
  return toDbMoney(money(to).minus(money(from)));
}

/** The authority a version carries, for display. Phase 1 has no forecast concept. */
export function versionAuthority(kind: VersionKind, status: VersionStatus, versionNumber: number): string {
  if (kind === "inherited_business_case") {
    return status === "draft" ? "Original Business Case (being captured)" : "Original Business Case";
  }
  switch (status) {
    case "draft":
      return versionNumber === 1
        ? "Draft Value Case (in definition)"
        : `Draft Value Case V${versionNumber} (Value Change)`;
    case "proposed":
      return versionNumber === 1
        ? "Proposed Value Case — awaiting VCO authorisation"
        : `Proposed Value Case V${versionNumber} — Value Change awaiting VCO authorisation`;
    case "authorised":
      return `Authorised Value Case V${versionNumber}`;
    case "superseded":
      return `Superseded Value Case V${versionNumber}`;
    case "rejected":
      return `Proposed V${versionNumber} — Value Change rejected by the VCO`;
    case "withdrawn":
      return `Proposed V${versionNumber} — Value Change withdrawn`;
    case "recorded":
      return "Recorded";
  }
}

export function isLocked(status: VersionStatus): boolean {
  return status !== "draft";
}

/**
 * Value Case Definition (4D.10D): how a driver in the proposed V1 relates to the Original Business Case, by stable
 * driver identity. "Adjusted" means its financial value differs (a non-financial driver becoming financial, or the
 * reverse, is an adjustment). Descriptive only — no reconciliation rule is implied.
 */
export type DefinitionChange = "unchanged" | "adjusted" | "new" | "not_carried_forward";

export function classifyDefinitionChange(
  original: { financialValue: string | null } | null,
  proposed: { financialValue: string | null } | null,
): DefinitionChange {
  if (!proposed) return "not_carried_forward";
  if (!original) return "new";
  const [a, b] = [original.financialValue, proposed.financialValue];
  if (a === null || b === null) return a === b ? "unchanged" : "adjusted";
  return money(a).equals(money(b)) ? "unchanged" : "adjusted";
}

/**
 * Governed Value Case Definition movement (4D.10E). A driver's contribution to the Value Case financial total is its
 * financial value; a non-financial row or an absent driver contributes nothing (the existing total semantics). A
 * proposed V1 driver whose contribution differs from its recorded Original Business Case counterpart's — or that is
 * introduced with a non-zero value where there is no counterpart — needs an adjustment rationale before V1 can be
 * proposed; so does a financial Original Business Case driver not carried into V1. Mirrors vo_version_rationale_gate.
 * `original` is the counterpart in the RECORDED Original Business Case only (a draft one is not a governed baseline).
 */
export function definitionRationaleRequired(
  original: { financialValue: string | null } | null,
  proposed: { financialValue: string | null } | null,
): boolean {
  const contribution = (row: { financialValue: string | null } | null) => money(row?.financialValue ?? "0");
  return !contribution(proposed).equals(contribution(original));
}

/** Blank or whitespace-only text is no rationale. */
export const hasRationale = (text: string | null | undefined) => Boolean(text && text.trim());
