import type { PositionTotals } from "./assurance";
import type { LeakageSummary } from "./response";
import type {
  EvidenceStatus,
  QualificationStatus,
  ReportType,
  ScenarioKind,
  ValueChangeStatus,
  VersionStatus,
} from "./statuses";

// Client-facing report view models (Phase 4A).
//
// A report model is a plain, JSON-serialisable projection of the governed Value
// Record, built by src/server/queries/reports.ts from the same read models the
// application uses. Every figure is copied from those read models — reports
// compute nothing of their own. An issued report stores its model verbatim as
// the snapshot; `canonicalJson` + sha256 fingerprints it.
//
// Money is a decimal string (or null when not established). Dates are ISO strings.

/**
 * Bump when a model's shape changes, so issued snapshots stay interpretable.
 * 1 — Phase 4A models. 2 — Phase 4D.7: the Assurance model also snapshots `evolution` and `outcomes`
 * (report visuals). Issued v1 snapshots are never rewritten; they render through the v1 layout.
 */
export const REPORT_MODEL_VERSION = 2;
export type ReportModelVersion = 1 | typeof REPORT_MODEL_VERSION;

export const REPORT_TITLES: Record<ReportType, string> = {
  information_request: "Information Request",
  requalification: "Re-Qualification Report",
  assurance: "Value Assurance Report",
  value_change_notice: "Value Change Notice",
};

export type ReportHeader = {
  /** New models carry REPORT_MODEL_VERSION; issued snapshots keep the version they were built with. */
  modelVersion: ReportModelVersion;
  type: ReportType;
  title: string;
  /** e.g. "Assurance Review 1" */
  subjectLabel: string;
  /** Subject status at the time the model was built (recorded on issue). */
  subjectStatus: string;
  clientName: string;
  projectName: string;
  projectCode: string;
  currency: string;
  /** The date the report describes (review date, authorisation date, …). */
  asAt: string | null;
  valueBasis: { description: string | null; periodStart: string | null; periodEnd: string | null };
};

export type EvidenceRef = { code: string; title: string };

// ---------------------------------------------------------------------------
// Information Request

export type InformationRequestItemStatus = "open" | "partially_received" | "received" | "not_available";

export type InformationRequestReport = {
  header: ReportHeader & { type: "information_request" };
  request: { reference: string; title: string; status: string; issuedOn: string | null; closedOn: string | null };
  summary: Record<InformationRequestItemStatus, number> & { total: number };
  items: {
    sequence: number;
    description: string;
    requestedFrom: string | null;
    dueOn: string | null;
    status: InformationRequestItemStatus;
    driver: { code: string; name: string } | null;
    notes: string | null;
  }[];
};

// ---------------------------------------------------------------------------
// Re-Qualification

export type RequalificationDriver = {
  code: string;
  name: string;
  description: string | null;
  metric: string | null;
  metricUnit: string | null;
  baselineValue: string | null;
  targetValue: string | null;
  /** null = non-financial driver. */
  financialValue: string | null;
  timing: string | null;
  avoName: string | null;
  qualificationStatus: QualificationStatus;
  evidenceStatus: EvidenceStatus;
  economicRationale: string | null;
  /** The driver's value in the inherited Business Case, where it was decomposed there. */
  inherited: { present: boolean; financialValue: string | null; change: string | null };
  assumptions: { statement: string; evidenceStatus: EvidenceStatus; notes: string | null; evidence: EvidenceRef[] }[];
  evidence: EvidenceRef[];
};

export type RequalificationReport = {
  header: ReportHeader & { type: "requalification" };
  inherited: { title: string; total: string | null; driverCount: number } | null;
  authorised: {
    versionNumber: number;
    title: string;
    summary: string | null;
    status: VersionStatus;
    total: string;
    authorisedOn: string | null;
    authorisedBy: string | null;
    evidence: EvidenceRef | null;
    note: string | null;
    supersededOn: string | null;
  };
  /** Authorised − inherited (null when the inherited total is not recorded). */
  movement: string | null;
  /**
   * The Authorised Value Case in force when this is not V1 (V1 superseded by a Value Change).
   * Absent from snapshots issued before Phase 4B.
   */
  currentVersion?: { versionNumber: number; title: string; total: string } | null;
  drivers: RequalificationDriver[];
  /** Inherited drivers that are not part of the Re-Qualified Value Case. */
  notCarriedForward: { code: string; name: string; financialValue: string | null }[];
  counts: {
    driverCount: number;
    financialCount: number;
    nonFinancialCount: number;
    qualification: Record<QualificationStatus, number>;
    evidence: Record<EvidenceStatus, number>;
    withoutEvidenceLinks: number;
    withoutAvo: number;
    assumptionCount: number;
    assumptionEvidence: Record<EvidenceStatus, number>;
  };
};

// ---------------------------------------------------------------------------
// Value Assurance

export type AssuranceDriverRow = {
  code: string;
  name: string;
  financial: boolean;
  authorisedValue: string | null;
  previousForecast: string | null;
  currentForecast: string | null;
  forecastNotAssessed: boolean;
  forecastRationale: string | null;
  movement: string | null;
  valueGap: string | null;
  realisedValue: string | null;
  qualificationStatus: QualificationStatus;
  evidenceStatus: EvidenceStatus;
};

export type AssuranceLeakageItem = {
  code: string;
  title: string;
  description: string | null;
  drivers: { code: string; name: string }[];
  responseOwner: string | null;
  status: "open" | "closed";
  requiredDecisionDate: string | null;
  consultantAssessment: string | null;
  /** Review the matter was raised in; null when raised in Continuous Assurance (Phase 4D). */
  identifiedInReview: number | null;
  /** Date raised in Continuous Assurance (absent on snapshots issued before Phase 4D). */
  identifiedOn?: string | null;
  /** null = not yet quantified in this review. Never rendered as zero. */
  assessment: {
    total: string;
    recoverable: string;
    unrecoverable: string;
    unrecoverableRationale: string | null;
    note: string | null;
  } | null;
};

export type AssuranceScenario = {
  label: string;
  kind: ScenarioKind;
  totalValue: string;
  narrative: string | null;
  vsCurrent: string | null;
  vsRecommended: string | null;
  isRecommendation: boolean;
  isClientSelection: boolean;
};

export type AssuranceValueChange = {
  code: string;
  status: ValueChangeStatus;
  fromVersion: number;
  toVersion: number;
  fromTotal: string;
  /** Driver-level total of the new version. */
  toTotal: string;
  statedChange: string | null;
  projectedValue: string | null;
  reconciled: boolean | null;
  reason: string | null;
};

/** Follow-ups that are recorded in the Value Record (never generated action plans). */
export type AssuranceNextAction =
  | {
      kind: "leakage_response";
      code: string;
      title: string;
      owner: string | null;
      requiredDecisionDate: string | null;
      quantified: boolean;
    }
  | { kind: "value_change"; code: string; reconciled: boolean | null }
  | { kind: "forecast"; code: string; name: string; notAssessed: boolean };

export type AssuranceReport = {
  header: ReportHeader & { type: "assurance" };
  review: {
    sequence: number;
    reviewDate: string;
    trigger: string;
    triggerEvidence: EvidenceRef | null;
    againstVersion: { number: number; title: string };
    previous: { sequence: number; reviewDate: string } | null;
    finalisedOn: string | null;
    finalisedBy: string | null;
    whatChanged: string | null;
    whyItMatters: string | null;
    summary: string | null;
    evidence: (EvidenceRef & { note: string | null; materialChange: boolean })[];
  };
  position: Pick<
    PositionTotals,
    | "financialDriverCount"
    | "authorisedTotal"
    | "previousTotal"
    | "forecastAssessed"
    | "forecastTotal"
    | "valueGap"
    | "movement"
    | "realisedAssessed"
    | "realisedAttributedTotal"
    | "unattributedRealised"
    | "realisedTotal"
    | "forecastBlockers"
  > & { unattributedRationale: string | null };
  drivers: AssuranceDriverRow[];
  leakage: { items: AssuranceLeakageItem[]; summary: LeakageSummary };
  scenarios: AssuranceScenario[];
  recommendation: { label: string; totalValue: string; narrative: string; issuedOn: string | null } | null;
  decision: {
    label: string;
    kind: ScenarioKind;
    totalValue: string;
    decidedBy: string;
    decidedOn: string;
    rationale: string | null;
    economicConsequence: string | null;
    evidence: EvidenceRef | null;
    /** Selected − recommended (derived by the read model). */
    clientElectedDifference: string | null;
  } | null;
  valueChanges: AssuranceValueChange[];
  nextActions: AssuranceNextAction[];
  /** Model v2+: governed Value Case history up to and including this review (absent on v1 snapshots). */
  evolution?: AssuranceEvolution;
  /** Model v2+: this review's decision economics; null when it has no options with a recommendation or decision. */
  outcomes?: AssuranceOutcomes | null;
};

/**
 * Value Case Evolution as snapshotted in an issued report (Phase 4D.7). Copied from the application's
 * governed read model — Original Business Case, Authorised versions, finalised reviews only — in event
 * order. No working values, drafts or proposed Value Changes.
 */
export type AssuranceEvolution = {
  originalBusinessCase: { title: string; value: string | null } | null;
  events: AssuranceEvolutionEvent[];
};

export type AssuranceEvolutionEvent =
  | { kind: "original"; key: string; title: string; value: string | null }
  | {
      kind: "authorisation";
      key: string;
      versionNumber: number;
      authorisedValue: string;
      authorisedOn: string | null;
      vcoName: string | null;
      valueChangeCode: string | null;
    }
  | {
      kind: "review";
      key: string;
      sequence: number;
      reviewDate: string;
      againstVersionNumber: number;
      currentForecast: string | null;
      realisedValue: string | null;
      valueGap: string | null;
      /** Authorised Value in force at this point in the event order. */
      inForceValue: string | null;
      /** This report's own review. */
      isThisReview: boolean;
    };

/**
 * Alternative Value Outcomes as snapshotted in an issued report (Phase 4D.7): a point-in-time comparison
 * of this review's stored, quantified options — not a trajectory. Ordered recommendation, stored order,
 * client choice; a scenario holding both roles appears once.
 */
export type AssuranceOutcomes = {
  againstVersionNumber: number;
  /** Reference: Authorised Value of the version this review measured against. */
  authorisedValue: string;
  /** Reference: this review's formal Current Forecast. */
  currentFormalForecast: string | null;
  outcomes: {
    label: string;
    kind: ScenarioKind;
    totalValue: string;
    narrative: string | null;
    recommended: boolean;
    selected: boolean;
  }[];
  /** Selected − recommended; null unless both exist. */
  differenceFromRecommendation: string | null;
};

// ---------------------------------------------------------------------------
// Value Change Notice

export type ValueChangeNotice = {
  header: ReportHeader & { type: "value_change_notice" };
  change: {
    code: string;
    status: ValueChangeStatus;
    reason: string | null;
    economicImpactNarrative: string | null;
    statedChange: string | null;
    proposedOn: string | null;
  };
  current: { versionNumber: number; title: string; status: VersionStatus; total: string };
  proposed: { versionNumber: number; title: string; status: VersionStatus; total: string };
  /** Current authorised value + stated change. */
  projectedFromStated: string | null;
  /** Driver-level change: proposed total − current total. */
  actualChange: string;
  /** null when no stated change was recorded. */
  reconciled: boolean | null;
  readyForAuthorisation: boolean;
  changedDrivers: {
    code: string;
    name: string;
    fromValue: string | null;
    toValue: string | null;
    change: string | null;
    added: boolean;
    removed: boolean;
  }[];
  unchangedDriverCount: number;
  origin: {
    review: { sequence: number; reviewDate: string } | null;
    recommendation: { label: string; totalValue: string } | null;
    decision: {
      label: string;
      totalValue: string;
      decidedBy: string;
      decidedOn: string;
      clientElectedDifference: string | null;
    } | null;
  };
  authorisation: {
    vco: string | null;
    authorisedBy: string | null;
    authorisedOn: string | null;
    evidence: EvidenceRef | null;
    note: string | null;
  } | null;
};

export type ReportModel = InformationRequestReport | RequalificationReport | AssuranceReport | ValueChangeNotice;

// ---------------------------------------------------------------------------
// Issuability — mirrors the database guard (vo_report_issue_guard), which is authoritative.

export function issuability(type: ReportType, subjectStatus: string, extra: { versionNumber?: number } = {}) {
  const ok = (() => {
    switch (type) {
      case "information_request":
        return subjectStatus === "issued" || subjectStatus === "closed";
      case "requalification":
        return extra.versionNumber === 1 && (subjectStatus === "authorised" || subjectStatus === "superseded");
      case "assurance":
        return subjectStatus === "finalised";
      case "value_change_notice":
        return subjectStatus === "proposed" || subjectStatus === "authorised";
    }
  })();
  const reason: Record<ReportType, string> = {
    information_request: "The Information Request must be issued before it can be issued as a report.",
    requalification: "The Re-Qualification Report requires the Authorised Value Case (V1).",
    assurance: "The Value Assurance Report requires a finalised Assurance Review.",
    value_change_notice: "A Value Change Notice requires a proposed or authorised Value Change.",
  };
  return ok ? { ok: true as const, reason: null } : { ok: false as const, reason: reason[type] };
}

// ---------------------------------------------------------------------------
// Snapshot fingerprinting

/** Deterministic JSON: object keys sorted recursively; array order preserved; undefined omitted. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("Non-finite number in snapshot");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}
