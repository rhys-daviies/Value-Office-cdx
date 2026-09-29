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
 * superseded  – previously authorised, replaced by a later authorised version (Value Change, not yet built)
 */
export const VERSION_STATUSES = ["draft", "recorded", "proposed", "authorised", "superseded"] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

export const KEY_DATE_KINDS = ["kickoff", "go_live", "six_month_review", "other"] as const;
export type KeyDateKind = (typeof KEY_DATE_KINDS)[number];

export const PROJECT_STATUSES = ["active", "archived"] as const;

export const INFORMATION_REQUEST_STATUSES = ["draft", "issued", "closed"] as const;

export const INFORMATION_REQUEST_ITEM_STATUSES = ["open", "partially_received", "received", "not_available"] as const;

// Value Assurance (PMO-approved, Phase 2).

export const ASSURANCE_TRIGGERS = ["kickoff", "go_live", "six_month", "material_evidence_change", "ad_hoc"] as const;
export type AssuranceTrigger = (typeof ASSURANCE_TRIGGERS)[number];

/** draft – editable · finalised – immutable; corrections require a new review. */
export const ASSURANCE_REVIEW_STATUSES = ["draft", "finalised"] as const;
export type AssuranceReviewStatus = (typeof ASSURANCE_REVIEW_STATUSES)[number];
