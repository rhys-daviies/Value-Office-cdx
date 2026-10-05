// Approved Value Office status vocabularies (PMO decision, Phase 1).
// Do not add methodology statuses here without PMO review.

export const QUALIFICATION_STATUSES = ["unqualified", "partially_qualified", "qualified"] as const;
export type QualificationStatus = (typeof QUALIFICATION_STATUSES)[number];

export const EVIDENCE_STATUSES = ["unevidenced", "partially_evidenced", "evidenced"] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

// Workflow (non-methodology) vocabularies.

/** V0 records the inherited Business Case; V1+ are Value Case versions. */
export const VERSION_KINDS = ["inherited_business_case", "value_case"] as const;
export type VersionKind = (typeof VERSION_KINDS)[number];

/**
 * draft       – editable
 * recorded    – V0 only: inherited Business Case captured and locked
 * proposed    – submitted for VCO authorisation; locked (return to draft to edit)
 * authorised  – the Authorised Value Case in force; immutable
 * superseded  – previously authorised, replaced by the version an approved Value Change authorised
 * rejected    – V2+ only: its Value Change was rejected by the VCO; preserved, immutable
 * withdrawn   – V2+ only: its Value Change was withdrawn before authorisation; preserved, immutable
 */
export const VERSION_STATUSES = [
  "draft",
  "recorded",
  "proposed",
  "authorised",
  "superseded",
  "rejected",
  "withdrawn",
] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

/**
 * Phase 4D.9: the economic basis a Value Case version is expressed on (the free-text Value Basis
 * description still describes it). Only some kinds support a time trajectory; kinds are never converted.
 */
export const VALUE_BASIS_KINDS = ["cumulative_benefit", "annual_run_rate", "net_present_value", "other"] as const;
export type ValueBasisKind = (typeof VALUE_BASIS_KINDS)[number];
export const TRAJECTORY_BASIS_KINDS = [
  "cumulative_benefit",
  "annual_run_rate",
] as const satisfies readonly ValueBasisKind[];

export const KEY_DATE_KINDS = ["kickoff", "go_live", "six_month_review", "other"] as const;
export type KeyDateKind = (typeof KEY_DATE_KINDS)[number];

export const PROJECT_STATUSES = ["active", "archived"] as const;

export const INFORMATION_REQUEST_STATUSES = ["draft", "issued", "closed"] as const;
/** Why an Information Request was raised (Phase 4D.2). Legacy requests have none and read as Mobilisation. */
export const INFORMATION_REQUEST_PURPOSES = ["mobilisation", "assurance"] as const;
export type InformationRequestPurpose = (typeof INFORMATION_REQUEST_PURPOSES)[number];

export const INFORMATION_REQUEST_ITEM_STATUSES = ["open", "partially_received", "received", "not_available"] as const;

// Value Assurance (PMO-approved, Phase 2).

export const ASSURANCE_TRIGGERS = ["kickoff", "go_live", "six_month", "material_evidence_change", "ad_hoc"] as const;
export type AssuranceTrigger = (typeof ASSURANCE_TRIGGERS)[number];

/** draft – editable · finalised – immutable; corrections require a new review. */
export const ASSURANCE_REVIEW_STATUSES = ["draft", "finalised"] as const;
export type AssuranceReviewStatus = (typeof ASSURANCE_REVIEW_STATUSES)[number];

// Phase 3: management response.

/**
 * Lifecycle of an Assurance matter (the value_leakage record). Authoritative: open | closed.
 * Resolved = closed with a closure note.
 */
export const LEAKAGE_STATUSES = ["open", "closed"] as const;
export type LeakageStatus = (typeof LEAKAGE_STATUSES)[number];

/**
 * Phase 4D (provisional, PMO): working stage of an open Assurance matter. Not a workflow —
 * consultants move freely between stages; every change is audited. Null on legacy matters.
 */
export const ASSURANCE_STAGES = [
  "identified",
  "awaiting_evidence",
  "assessing",
  "remediation",
  "monitoring",
  "escalated",
] as const;
export type AssuranceStage = (typeof ASSURANCE_STAGES)[number];

/** Alternative trajectory kinds. Values are consultant-entered, never derived. */
export const SCENARIO_KINDS = ["current", "recommended", "alternative", "no_action"] as const;
export type ScenarioKind = (typeof SCENARIO_KINDS)[number];

/**
 * Phase 4D.10G internal Cardaxia review of an unissued recommendation (stored; null = draft). Issued is recorded by
 * recommendation.issued_at, so historical issued rows need no backfill. See src/domain/recommendation.ts.
 */
export const RECOMMENDATION_REVIEW_STATUSES = ["in_internal_review", "returned", "ready_to_issue"] as const;
export type RecommendationReviewStatus = (typeof RECOMMENDATION_REVIEW_STATUSES)[number];

/** Durable internal review history, one row per step (insert-only). */
export const RECOMMENDATION_REVIEW_EVENT_KINDS = ["submitted", "returned", "approved"] as const;
export type RecommendationReviewEventKind = (typeof RECOMMENDATION_REVIEW_EVENT_KINDS)[number];

/**
 * Phase 4D.10H: after a management decision, does the Authorised Value Case need to change? Recorded once per
 * decision (insert-only). Neither answer changes the Value Case; a Value Change stays a separate governed step.
 */
export const VALUE_CHANGE_DETERMINATIONS = ["no_value_change_required", "value_change_proposed"] as const;
export type ValueChangeDetermination = (typeof VALUE_CHANGE_DETERMINATIONS)[number];

/** draft ⇄ proposed → authorised | rejected; draft/proposed → withdrawn. */
export const VALUE_CHANGE_STATUSES = ["draft", "proposed", "authorised", "rejected", "withdrawn"] as const;
export type ValueChangeStatus = (typeof VALUE_CHANGE_STATUSES)[number];

// Phase 4A: client outputs.

/** Client-facing report types issued from the Value Record. */
export const REPORT_TYPES = ["information_request", "requalification", "assurance", "value_change_notice"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
