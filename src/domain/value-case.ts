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
    return status === "draft" ? "Inherited Business Case (being captured)" : "Inherited Business Case";
  }
  switch (status) {
    case "draft":
      return "Draft Re-Qualified Value Case";
    case "proposed":
      return "Proposed Value Case — awaiting VCO authorisation";
    case "authorised":
      return `Authorised Value Case V${versionNumber}`;
    case "superseded":
      return `Superseded Value Case V${versionNumber}`;
    case "recorded":
      return "Recorded";
  }
}

export function isLocked(status: VersionStatus): boolean {
  return status !== "draft";
}
