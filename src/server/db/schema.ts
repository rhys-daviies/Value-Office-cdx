import { sql } from "drizzle-orm";
import {
  bigserial,
  bigint,
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  ASSURANCE_REVIEW_STATUSES,
  ASSURANCE_TRIGGERS,
  EVIDENCE_STATUSES,
  INFORMATION_REQUEST_ITEM_STATUSES,
  LEAKAGE_STATUSES,
  SCENARIO_KINDS,
  VALUE_CHANGE_STATUSES,
  INFORMATION_REQUEST_STATUSES,
  KEY_DATE_KINDS,
  PROJECT_STATUSES,
  QUALIFICATION_STATUSES,
  REPORT_TYPES,
  VERSION_KINDS,
  VERSION_STATUSES,
} from "@/domain/statuses";

// Conventions
// - Column names are snake_case in the database (drizzle `casing: "snake_case"`).
// - Every project-scoped row carries project_id. Composite foreign keys on
//   (id, project_id) make cross-project references impossible.
// - Money is numeric(18,2). Metric values are numeric(20,6) with a free-text unit.
// - Immutability, state transitions and audit capture are enforced by triggers
//   in drizzle/0001_integrity_and_audit.sql.

export const qualificationStatus = pgEnum("qualification_status", QUALIFICATION_STATUSES);
export const evidenceStatus = pgEnum("evidence_status", EVIDENCE_STATUSES);
export const versionKind = pgEnum("version_kind", VERSION_KINDS);
export const versionStatus = pgEnum("version_status", VERSION_STATUSES);
export const keyDateKind = pgEnum("key_date_kind", KEY_DATE_KINDS);
export const projectStatus = pgEnum("project_status", PROJECT_STATUSES);
export const assuranceTrigger = pgEnum("assurance_trigger", ASSURANCE_TRIGGERS);
export const assuranceReviewStatus = pgEnum("assurance_review_status", ASSURANCE_REVIEW_STATUSES);
export const leakageStatus = pgEnum("leakage_status", LEAKAGE_STATUSES);
export const scenarioKind = pgEnum("scenario_kind", SCENARIO_KINDS);
export const valueChangeStatus = pgEnum("value_change_status", VALUE_CHANGE_STATUSES);
export const reportType = pgEnum("report_type", REPORT_TYPES);
export const informationRequestStatus = pgEnum("information_request_status", INFORMATION_REQUEST_STATUSES);
export const informationRequestItemStatus = pgEnum(
  "information_request_item_status",
  INFORMATION_REQUEST_ITEM_STATUSES,
);

const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const moneyCol = () => numeric({ precision: 18, scale: 2 });
const metricCol = () => numeric({ precision: 20, scale: 6 });

// ---------------------------------------------------------------------------
// Consultants (Cardaxia users). Client people are `person`, never users.

export const appUser = pgTable(
  "app_user",
  {
    id: id(),
    email: text().notNull(),
    displayName: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("app_user_email_lower_uq").on(sql`lower(${t.email})`)],
);

// ---------------------------------------------------------------------------
// Client / project

export const client = pgTable("client", {
  id: id(),
  name: text().notNull(),
  createdAt: createdAt(),
});

export const project = pgTable(
  "project",
  {
    id: id(),
    clientId: uuid()
      .notNull()
      .references(() => client.id),
    code: text().notNull(),
    name: text().notNull(),
    context: text(),
    status: projectStatus().notNull().default("active"),
    // Single currency per project; no FX in MVP.
    currency: char({ length: 3 }).notNull(),
    // Common Value Basis for every financial Value Driver in this project.
    // Required before a Value Case version can be proposed; locked once authorised.
    valueBasisDescription: text(),
    valuePeriodStart: date(),
    valuePeriodEnd: date(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("project_code_uq").on(t.code),
    unique("project_id_client_uq").on(t.id, t.clientId),
    check("project_currency_iso", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      "project_value_period_order",
      sql`${t.valuePeriodStart} is null or ${t.valuePeriodEnd} is null or ${t.valuePeriodStart} <= ${t.valuePeriodEnd}`,
    ),
  ],
);

export const keyDate = pgTable(
  "key_date",
  {
    id: id(),
    projectId: uuid()
      .notNull()
      .references(() => project.id),
    kind: keyDateKind().notNull(),
    label: text().notNull(),
    date: date().notNull(),
    notes: text(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("key_date_single_kickoff_golive_uq")
      .on(t.projectId, t.kind)
      .where(sql`${t.kind} in ('kickoff', 'go_live')`),
  ],
);

// ---------------------------------------------------------------------------
// People / stakeholders

export const person = pgTable(
  "person",
  {
    id: id(),
    clientId: uuid()
      .notNull()
      .references(() => client.id),
    name: text().notNull(),
    title: text(),
    organisation: text(),
    email: text(),
    createdAt: createdAt(),
  },
  (t) => [unique("person_id_client_uq").on(t.id, t.clientId)],
);

export const projectStakeholder = pgTable(
  "project_stakeholder",
  {
    id: id(),
    projectId: uuid().notNull(),
    personId: uuid().notNull(),
    clientId: uuid().notNull(),
    roleDescription: text(),
    notes: text(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("project_stakeholder_uq").on(t.projectId, t.personId),
    foreignKey({
      name: "project_stakeholder_project_fk",
      columns: [t.projectId, t.clientId],
      foreignColumns: [project.id, project.clientId],
    }),
    foreignKey({
      name: "project_stakeholder_person_fk",
      columns: [t.personId, t.clientId],
      foreignColumns: [person.id, person.clientId],
    }),
  ],
);

// ---------------------------------------------------------------------------
// Documents & evidence
//
// Phase 1 documents are references (URI / location + metadata + optional hash).
// `storage_key` is reserved for the later object-storage upgrade.

export const document = pgTable(
  "document",
  {
    id: id(),
    projectId: uuid()
      .notNull()
      .references(() => project.id),
    title: text().notNull(),
    sourceDescription: text().notNull(),
    sourcePersonId: uuid(),
    uri: text(),
    storageKey: text(),
    originalFilename: text(),
    mimeType: text(),
    sizeBytes: bigint({ mode: "number" }),
    sha256: char({ length: 64 }),
    receivedOn: date(),
    recordedBy: uuid()
      .notNull()
      .references(() => appUser.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("document_id_project_uq").on(t.id, t.projectId),
    foreignKey({
      name: "document_source_person_fk",
      columns: [t.projectId, t.sourcePersonId],
      foreignColumns: [projectStakeholder.projectId, projectStakeholder.personId],
    }),
    check("document_sha256_hex", sql`${t.sha256} is null or ${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check("document_size_non_negative", sql`${t.sizeBytes} is null or ${t.sizeBytes} >= 0`),
  ],
);

export const evidence = pgTable(
  "evidence",
  {
    id: id(),
    projectId: uuid()
      .notNull()
      .references(() => project.id),
    code: text().notNull(),
    title: text().notNull(),
    summary: text(),
    documentId: uuid(),
    sourcePersonId: uuid(),
    evidenceDate: date(),
    receivedOn: date(),
    supersedesEvidenceId: uuid(),
    isMaterialChange: boolean().notNull().default(false),
    materialChangeNote: text(),
    recordedBy: uuid()
      .notNull()
      .references(() => appUser.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("evidence_code_uq").on(t.projectId, t.code),
    unique("evidence_id_project_uq").on(t.id, t.projectId),
    foreignKey({
      name: "evidence_document_fk",
      columns: [t.documentId, t.projectId],
      foreignColumns: [document.id, document.projectId],
    }),
    foreignKey({
      name: "evidence_source_person_fk",
      columns: [t.projectId, t.sourcePersonId],
      foreignColumns: [projectStakeholder.projectId, projectStakeholder.personId],
    }),
    foreignKey({
      name: "evidence_supersedes_fk",
      columns: [t.supersedesEvidenceId, t.projectId],
      foreignColumns: [t.id, t.projectId],
    }),
    check("evidence_not_self_superseding", sql`${t.supersedesEvidenceId} is distinct from ${t.id}`),
  ],
);

// ---------------------------------------------------------------------------
// Value Case (versioned)
//
// value_driver          – stable identity of a driver across versions (code VD-01)
// value_case_version    – V0 inherited Business Case, V1 Re-Qualified/Authorised, V2+ via Value Change (later)
// value_driver_version  – a driver's content within one version (copy-on-write)

export const valueCase = pgTable(
  "value_case",
  {
    id: id(),
    projectId: uuid()
      .notNull()
      .references(() => project.id),
    // Value Case Owner: the only client role able to authorise the Value Case.
    vcoPersonId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("value_case_project_uq").on(t.projectId),
    unique("value_case_id_project_uq").on(t.id, t.projectId),
    foreignKey({
      name: "value_case_vco_fk",
      columns: [t.projectId, t.vcoPersonId],
      foreignColumns: [projectStakeholder.projectId, projectStakeholder.personId],
    }),
  ],
);

export const valueCaseVersion = pgTable(
  "value_case_version",
  {
    id: id(),
    valueCaseId: uuid().notNull(),
    projectId: uuid().notNull(),
    versionNumber: integer().notNull(),
    kind: versionKind().notNull(),
    status: versionStatus().notNull().default("draft"),
    basedOnVersionId: uuid(),
    title: text().notNull(),
    summary: text(),
    // V0 only: headline value as stated in the inherited Business Case, which may
    // not be decomposed into drivers. Value Case versions derive totals from drivers.
    statedTotalValue: moneyCol(),
    createdBy: uuid()
      .notNull()
      .references(() => appUser.id),
    createdAt: createdAt(),
    recordedAt: timestamp({ withTimezone: true }),
    proposedAt: timestamp({ withTimezone: true }),
    proposedBy: uuid().references(() => appUser.id),
    // VCO authorisation, recorded by a consultant with supporting evidence.
    authorisedOn: date(),
    authorisedByPersonId: uuid(),
    authorisationEvidenceId: uuid(),
    authorisationNote: text(),
    authorisationRecordedBy: uuid().references(() => appUser.id),
    authorisationRecordedAt: timestamp({ withTimezone: true }),
    supersededAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique("value_case_version_number_uq").on(t.valueCaseId, t.versionNumber),
    unique("value_case_version_scope_uq").on(t.id, t.valueCaseId, t.projectId),
    unique("value_case_version_id_project_uq").on(t.id, t.projectId),
    unique("value_case_version_id_case_uq").on(t.id, t.valueCaseId),
    foreignKey({
      name: "value_case_version_case_fk",
      columns: [t.valueCaseId, t.projectId],
      foreignColumns: [valueCase.id, valueCase.projectId],
    }),
    foreignKey({
      name: "value_case_version_based_on_fk",
      columns: [t.basedOnVersionId, t.valueCaseId],
      foreignColumns: [t.id, t.valueCaseId],
    }),
    foreignKey({
      name: "value_case_version_authorised_by_fk",
      columns: [t.projectId, t.authorisedByPersonId],
      foreignColumns: [projectStakeholder.projectId, projectStakeholder.personId],
    }),
    foreignKey({
      name: "value_case_version_authorisation_evidence_fk",
      columns: [t.authorisationEvidenceId, t.projectId],
      foreignColumns: [evidence.id, evidence.projectId],
    }),
    // Exactly one authorised version in force per Value Case.
    uniqueIndex("value_case_one_authorised_uq")
      .on(t.valueCaseId)
      .where(sql`${t.status} = 'authorised'`),
    // At most one open (draft/proposed) Value Case version at a time.
    uniqueIndex("value_case_one_open_version_uq")
      .on(t.valueCaseId)
      .where(sql`${t.kind} = 'value_case' and ${t.status} in ('draft', 'proposed')`),
    check(
      "value_case_version_kind_shape",
      sql`(${t.kind} = 'inherited_business_case' and ${t.versionNumber} = 0 and ${t.status} in ('draft', 'recorded'))
       or (${t.kind} = 'value_case' and ${t.versionNumber} >= 1 and ${t.status} <> 'recorded' and ${t.statedTotalValue} is null)`,
    ),
    check("value_case_version_recorded_shape", sql`${t.status} <> 'recorded' or ${t.recordedAt} is not null`),
    check(
      "value_case_version_proposed_shape",
      sql`${t.status} not in ('proposed', 'authorised', 'superseded') or (${t.proposedAt} is not null and ${t.proposedBy} is not null)`,
    ),
    check(
      "value_case_version_authorised_shape",
      sql`${t.status} not in ('authorised', 'superseded') or (
            ${t.authorisedOn} is not null and ${t.authorisedByPersonId} is not null
        and ${t.authorisationEvidenceId} is not null and ${t.authorisationRecordedBy} is not null
        and ${t.authorisationRecordedAt} is not null)`,
    ),
    check("value_case_version_superseded_shape", sql`(${t.status} = 'superseded') = (${t.supersededAt} is not null)`),
    check("value_case_version_not_self_based", sql`${t.basedOnVersionId} is distinct from ${t.id}`),
  ],
);

export const valueDriver = pgTable(
  "value_driver",
  {
    id: id(),
    valueCaseId: uuid().notNull(),
    projectId: uuid().notNull(),
    code: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("value_driver_code_uq").on(t.valueCaseId, t.code),
    unique("value_driver_scope_uq").on(t.id, t.valueCaseId),
    unique("value_driver_id_project_uq").on(t.id, t.projectId),
    foreignKey({
      name: "value_driver_case_fk",
      columns: [t.valueCaseId, t.projectId],
      foreignColumns: [valueCase.id, valueCase.projectId],
    }),
    check("value_driver_code_not_blank", sql`length(trim(${t.code})) > 0`),
  ],
);

export const valueDriverVersion = pgTable(
  "value_driver_version",
  {
    id: id(),
    valueCaseVersionId: uuid().notNull(),
    valueDriverId: uuid().notNull(),
    valueCaseId: uuid().notNull(),
    projectId: uuid().notNull(),
    name: text().notNull(),
    description: text(),
    metric: text(),
    metricUnit: text(),
    baselineValue: metricCol(),
    targetValue: metricCol(),
    calculationRationale: text(),
    // Expressed on the project's Value Basis, in the project currency.
    financialValue: moneyCol(),
    timingDescription: text(),
    benefitStartDate: date(),
    benefitFullDate: date(),
    // Accountable Value Owner as at this version.
    avoPersonId: uuid(),
    qualificationStatus: qualificationStatus().notNull().default("unqualified"),
    evidenceStatus: evidenceStatus().notNull().default("unevidenced"),
    notes: text(),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique("value_driver_version_uq").on(t.valueCaseVersionId, t.valueDriverId),
    unique("value_driver_version_id_project_uq").on(t.id, t.projectId),
    foreignKey({
      name: "value_driver_version_version_fk",
      columns: [t.valueCaseVersionId, t.valueCaseId, t.projectId],
      foreignColumns: [valueCaseVersion.id, valueCaseVersion.valueCaseId, valueCaseVersion.projectId],
    }),
    foreignKey({
      name: "value_driver_version_driver_fk",
      columns: [t.valueDriverId, t.valueCaseId],
      foreignColumns: [valueDriver.id, valueDriver.valueCaseId],
    }),
    foreignKey({
      name: "value_driver_version_avo_fk",
      columns: [t.projectId, t.avoPersonId],
      foreignColumns: [projectStakeholder.projectId, projectStakeholder.personId],
    }),
    check(
      "value_driver_version_benefit_dates_order",
      sql`${t.benefitStartDate} is null or ${t.benefitFullDate} is null or ${t.benefitStartDate} <= ${t.benefitFullDate}`,
    ),
  ],
);

export const assumption = pgTable(
  "assumption",
  {
    id: id(),
    valueDriverVersionId: uuid().notNull(),
    projectId: uuid().notNull(),
    statement: text().notNull(),
    evidenceStatus: evidenceStatus().notNull().default("unevidenced"),
    notes: text(),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique("assumption_id_project_uq").on(t.id, t.projectId),
    foreignKey({
      name: "assumption_driver_version_fk",
      columns: [t.valueDriverVersionId, t.projectId],
      foreignColumns: [valueDriverVersion.id, valueDriverVersion.projectId],
    }).onDelete("cascade"),
  ],
);

// ---------------------------------------------------------------------------
// Value Assurance
//
// A review is a dated Value Position taken against the Authorised Value Case
// version in force when it was opened. Forecasts and realised values live here,
// never in the Value Case version. Gap and movement are derived, not stored.

export const assuranceReview = pgTable(
  "assurance_review",
  {
    id: id(),
    projectId: uuid().notNull(),
    valueCaseId: uuid().notNull(),
    sequence: integer().notNull(),
    trigger: assuranceTrigger().notNull(),
    triggerEvidenceId: uuid(),
    /** The exact Authorised Value Case version this position is measured against. */
    againstVersionId: uuid().notNull(),
    /** The latest finalised review when this one was opened; null for the first review. */
    previousReviewId: uuid(),
    reviewDate: date().notNull(),
    status: assuranceReviewStatus().notNull().default("draft"),
    whatChanged: text(),
    whyItMatters: text(),
    summary: text(),
    /**
     * Project-level realised value known but not yet responsibly attributable to
     * individual drivers. Explicitly labelled; never belongs to any driver.
     */
    unattributedRealisedValue: moneyCol(),
    unattributedRealisedRationale: text(),
    createdBy: uuid()
      .notNull()
      .references(() => appUser.id),
    createdAt: createdAt(),
    finalisedBy: uuid().references(() => appUser.id),
    finalisedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique("assurance_review_sequence_uq").on(t.projectId, t.sequence),
    unique("assurance_review_id_project_uq").on(t.id, t.projectId),
    unique("assurance_review_id_case_uq").on(t.id, t.valueCaseId),
    foreignKey({
      name: "assurance_review_case_fk",
      columns: [t.valueCaseId, t.projectId],
      foreignColumns: [valueCase.id, valueCase.projectId],
    }),
    foreignKey({
      name: "assurance_review_version_fk",
      columns: [t.againstVersionId, t.valueCaseId, t.projectId],
      foreignColumns: [valueCaseVersion.id, valueCaseVersion.valueCaseId, valueCaseVersion.projectId],
    }),
    foreignKey({
      name: "assurance_review_previous_fk",
      columns: [t.previousReviewId, t.projectId],
      foreignColumns: [t.id, t.projectId],
    }),
    foreignKey({
      name: "assurance_review_trigger_evidence_fk",
      columns: [t.triggerEvidenceId, t.projectId],
      foreignColumns: [evidence.id, evidence.projectId],
    }),
    // One draft at a time keeps the chain of positions linear (each review's
    // previous position is unambiguous).
    uniqueIndex("assurance_review_one_draft_uq")
      .on(t.projectId)
      .where(sql`${t.status} = 'draft'`),
    check("assurance_review_sequence_positive", sql`${t.sequence} >= 1`),
    check("assurance_review_not_self_previous", sql`${t.previousReviewId} is distinct from ${t.id}`),
    check(
      "assurance_review_unattributed_rationale",
      sql`${t.unattributedRealisedValue} is null or ${t.unattributedRealisedRationale} is not null`,
    ),
    check(
      "assurance_review_finalised_shape",
      sql`(${t.status} = 'finalised') = (${t.finalisedBy} is not null and ${t.finalisedAt} is not null)`,
    ),
  ],
);

/** One row per Value Driver per review. Financial values are on the project's Value Basis. */
export const valuePosition = pgTable(
  "value_position",
  {
    id: id(),
    assuranceReviewId: uuid().notNull(),
    projectId: uuid().notNull(),
    valueCaseId: uuid().notNull(),
    valueDriverId: uuid().notNull(),
    /** Consultant's current expected financial outcome. May be negative; null = not assessed / non-financial. */
    currentForecast: moneyCol(),
    /** Cumulative realised value to the review date. Null = not yet assessed. */
    realisedValue: moneyCol(),
    /** Consultant explicitly could not assess the forecast; requires a rationale. */
    forecastNotAssessed: boolean().notNull().default(false),
    forecastRationale: text(),
    realisedValueRationale: text(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("value_position_driver_uq").on(t.assuranceReviewId, t.valueDriverId),
    check(
      "value_position_not_assessed_shape",
      sql`not ${t.forecastNotAssessed} or (${t.currentForecast} is null and ${t.forecastRationale} is not null)`,
    ),
    foreignKey({
      name: "value_position_review_fk",
      columns: [t.assuranceReviewId, t.projectId],
      foreignColumns: [assuranceReview.id, assuranceReview.projectId],
    }),
    foreignKey({
      name: "value_position_review_case_fk",
      columns: [t.assuranceReviewId, t.valueCaseId],
      foreignColumns: [assuranceReview.id, assuranceReview.valueCaseId],
    }),
    foreignKey({
      name: "value_position_driver_fk",
      columns: [t.valueDriverId, t.valueCaseId],
      foreignColumns: [valueDriver.id, valueDriver.valueCaseId],
    }),
  ],
);

// ---------------------------------------------------------------------------
// Management response (Phase 3)
//
// Value Leakage is a register item (an identified issue) reassessed per review:
//   Total VL = Recoverable VL + Unrecoverable VL; Recoverable is derived.
// Leakage and Value Gap are independent — nothing reconciles one to the other.

export const valueLeakage = pgTable(
  "value_leakage",
  {
    id: id(),
    projectId: uuid().notNull(),
    valueCaseId: uuid().notNull(),
    code: text().notNull(),
    title: text().notNull(),
    description: text(),
    identifiedInReviewId: uuid().notNull(),
    /** The AVO who owns the response (no separate Risk Owner). */
    responseOwnerPersonId: uuid(),
    status: leakageStatus().notNull().default("open"),
    requiredDecisionDate: date(),
    consultantAssessment: text(),
    createdBy: uuid()
      .notNull()
      .references(() => appUser.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("value_leakage_code_uq").on(t.projectId, t.code),
    unique("value_leakage_id_project_uq").on(t.id, t.projectId),
    unique("value_leakage_id_case_uq").on(t.id, t.valueCaseId),
    foreignKey({
      name: "value_leakage_case_fk",
      columns: [t.valueCaseId, t.projectId],
      foreignColumns: [valueCase.id, valueCase.projectId],
    }),
    foreignKey({
      name: "value_leakage_review_fk",
      columns: [t.identifiedInReviewId, t.projectId],
      foreignColumns: [assuranceReview.id, assuranceReview.projectId],
    }),
    foreignKey({
      name: "value_leakage_owner_fk",
      columns: [t.projectId, t.responseOwnerPersonId],
      foreignColumns: [projectStakeholder.projectId, projectStakeholder.personId],
    }),
  ],
);

export const valueLeakageDriver = pgTable(
  "value_leakage_driver",
  {
    id: id(),
    valueLeakageId: uuid().notNull(),
    valueCaseId: uuid().notNull(),
    valueDriverId: uuid().notNull(),
    projectId: uuid().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("value_leakage_driver_uq").on(t.valueLeakageId, t.valueDriverId),
    foreignKey({
      name: "value_leakage_driver_leakage_fk",
      columns: [t.valueLeakageId, t.valueCaseId],
      foreignColumns: [valueLeakage.id, valueLeakage.valueCaseId],
    }).onDelete("cascade"),
    foreignKey({
      name: "value_leakage_driver_driver_fk",
      columns: [t.valueDriverId, t.valueCaseId],
      foreignColumns: [valueDriver.id, valueDriver.valueCaseId],
    }),
    foreignKey({
      name: "value_leakage_driver_project_fk",
      columns: [t.valueLeakageId, t.projectId],
      foreignColumns: [valueLeakage.id, valueLeakage.projectId],
    }),
  ],
);

/** A leakage item's size in one review. Editable only while that review is draft. */
export const leakageAssessment = pgTable(
  "leakage_assessment",
  {
    id: id(),
    valueLeakageId: uuid().notNull(),
    assuranceReviewId: uuid().notNull(),
    projectId: uuid().notNull(),
    totalAmount: moneyCol().notNull(),
    unrecoverableAmount: moneyCol().notNull().default("0"),
    unrecoverableRationale: text(),
    unrecoverableValidatedBy: uuid().references(() => appUser.id),
    assessmentNote: text(),
    assessedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("leakage_assessment_review_uq").on(t.valueLeakageId, t.assuranceReviewId),
    foreignKey({
      name: "leakage_assessment_leakage_fk",
      columns: [t.valueLeakageId, t.projectId],
      foreignColumns: [valueLeakage.id, valueLeakage.projectId],
    }),
    foreignKey({
      name: "leakage_assessment_review_fk",
      columns: [t.assuranceReviewId, t.projectId],
      foreignColumns: [assuranceReview.id, assuranceReview.projectId],
    }),
    // Leakage is an exposure: non-negative. Until evidence shows it is lost, it is recoverable.
    check("leakage_assessment_total_non_negative", sql`${t.totalAmount} >= 0`),
    check(
      "leakage_assessment_unrecoverable_range",
      sql`${t.unrecoverableAmount} >= 0 and ${t.unrecoverableAmount} <= ${t.totalAmount}`,
    ),
    check(
      "leakage_assessment_unrecoverable_validated",
      sql`${t.unrecoverableAmount} = 0 or (${t.unrecoverableRationale} is not null and ${t.unrecoverableValidatedBy} is not null)`,
    ),
  ],
);

/** An option / alternative trajectory. Totals are consultant-entered, never derived. */
export const scenario = pgTable(
  "scenario",
  {
    id: id(),
    assuranceReviewId: uuid().notNull(),
    projectId: uuid().notNull(),
    label: text().notNull(),
    kind: scenarioKind().notNull(),
    totalValue: moneyCol().notNull(),
    narrative: text(),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique("scenario_id_review_uq").on(t.id, t.assuranceReviewId),
    foreignKey({
      name: "scenario_review_fk",
      columns: [t.assuranceReviewId, t.projectId],
      foreignColumns: [assuranceReview.id, assuranceReview.projectId],
    }),
    uniqueIndex("scenario_one_current_uq")
      .on(t.assuranceReviewId)
      .where(sql`${t.kind} = 'current'`),
    uniqueIndex("scenario_one_recommended_uq")
      .on(t.assuranceReviewId)
      .where(sql`${t.kind} = 'recommended'`),
  ],
);

/** Cardaxia's recommendation. Immutable once issued; never rewritten by the decision. */
export const recommendation = pgTable(
  "recommendation",
  {
    id: id(),
    assuranceReviewId: uuid().notNull(),
    projectId: uuid().notNull(),
    scenarioId: uuid().notNull(),
    narrative: text().notNull(),
    issuedBy: uuid().references(() => appUser.id),
    issuedAt: timestamp({ withTimezone: true }),
    createdBy: uuid()
      .notNull()
      .references(() => appUser.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("recommendation_review_uq").on(t.assuranceReviewId),
    foreignKey({
      name: "recommendation_review_fk",
      columns: [t.assuranceReviewId, t.projectId],
      foreignColumns: [assuranceReview.id, assuranceReview.projectId],
    }),
    foreignKey({
      name: "recommendation_scenario_fk",
      columns: [t.scenarioId, t.assuranceReviewId],
      foreignColumns: [scenario.id, scenario.assuranceReviewId],
    }),
    check("recommendation_issued_shape", sql`(${t.issuedAt} is null) = (${t.issuedBy} is null)`),
  ],
);

/** The client / AVO decision. Recorded by a consultant; immutable. */
export const decision = pgTable(
  "decision",
  {
    id: id(),
    assuranceReviewId: uuid().notNull(),
    projectId: uuid().notNull(),
    selectedScenarioId: uuid().notNull(),
    decidedByPersonId: uuid().notNull(),
    decidedOn: date().notNull(),
    rationale: text(),
    economicConsequence: text(),
    supportingEvidenceId: uuid(),
    recordedBy: uuid()
      .notNull()
      .references(() => appUser.id),
    recordedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("decision_review_uq").on(t.assuranceReviewId),
    unique("decision_id_project_uq").on(t.id, t.projectId),
    foreignKey({
      name: "decision_review_fk",
      columns: [t.assuranceReviewId, t.projectId],
      foreignColumns: [assuranceReview.id, assuranceReview.projectId],
    }),
    foreignKey({
      name: "decision_scenario_fk",
      columns: [t.selectedScenarioId, t.assuranceReviewId],
      foreignColumns: [scenario.id, scenario.assuranceReviewId],
    }),
    foreignKey({
      name: "decision_decided_by_fk",
      columns: [t.projectId, t.decidedByPersonId],
      foreignColumns: [projectStakeholder.projectId, projectStakeholder.personId],
    }),
    foreignKey({
      name: "decision_evidence_fk",
      columns: [t.supportingEvidenceId, t.projectId],
      foreignColumns: [evidence.id, evidence.projectId],
    }),
  ],
);

/**
 * The only path to Authorised V2+. References the version in force (from) and
 * the copy-forward draft it proposes (to). V1's initial authorisation is not a
 * Value Change (PMO decision).
 */
export const valueChange = pgTable(
  "value_change",
  {
    id: id(),
    projectId: uuid().notNull(),
    valueCaseId: uuid().notNull(),
    code: text().notNull(),
    fromVersionId: uuid().notNull(),
    toVersionId: uuid().notNull(),
    assuranceReviewId: uuid(),
    decisionId: uuid(),
    reason: text(),
    economicImpactNarrative: text(),
    /** Stated change to Authorised Value; if set, the proposed version must reconcile to it before authorisation. */
    statedChangeAmount: moneyCol(),
    status: valueChangeStatus().notNull().default("draft"),
    createdBy: uuid()
      .notNull()
      .references(() => appUser.id),
    createdAt: createdAt(),
    proposedAt: timestamp({ withTimezone: true }),
    proposedBy: uuid().references(() => appUser.id),
    authorisedOn: date(),
    authorisedByPersonId: uuid(),
    authorisationEvidenceId: uuid(),
    authorisationNote: text(),
    authorisationRecordedBy: uuid().references(() => appUser.id),
    authorisationRecordedAt: timestamp({ withTimezone: true }),
    closedAt: timestamp({ withTimezone: true }),
    closedBy: uuid().references(() => appUser.id),
    closureNote: text(),
  },
  (t) => [
    unique("value_change_code_uq").on(t.valueCaseId, t.code),
    unique("value_change_to_version_uq").on(t.toVersionId),
    unique("value_change_id_project_uq").on(t.id, t.projectId),
    foreignKey({
      name: "value_change_case_fk",
      columns: [t.valueCaseId, t.projectId],
      foreignColumns: [valueCase.id, valueCase.projectId],
    }),
    foreignKey({
      name: "value_change_from_version_fk",
      columns: [t.fromVersionId, t.valueCaseId, t.projectId],
      foreignColumns: [valueCaseVersion.id, valueCaseVersion.valueCaseId, valueCaseVersion.projectId],
    }),
    foreignKey({
      name: "value_change_to_version_fk",
      columns: [t.toVersionId, t.valueCaseId, t.projectId],
      foreignColumns: [valueCaseVersion.id, valueCaseVersion.valueCaseId, valueCaseVersion.projectId],
    }),
    foreignKey({
      name: "value_change_review_fk",
      columns: [t.assuranceReviewId, t.projectId],
      foreignColumns: [assuranceReview.id, assuranceReview.projectId],
    }),
    foreignKey({
      name: "value_change_decision_fk",
      columns: [t.decisionId, t.projectId],
      foreignColumns: [decision.id, decision.projectId],
    }),
    foreignKey({
      name: "value_change_authorised_by_fk",
      columns: [t.projectId, t.authorisedByPersonId],
      foreignColumns: [projectStakeholder.projectId, projectStakeholder.personId],
    }),
    foreignKey({
      name: "value_change_authorisation_evidence_fk",
      columns: [t.authorisationEvidenceId, t.projectId],
      foreignColumns: [evidence.id, evidence.projectId],
    }),
    check("value_change_versions_differ", sql`${t.fromVersionId} <> ${t.toVersionId}`),
    check("value_change_code_not_blank", sql`length(trim(${t.code})) > 0`),
    check(
      "value_change_proposed_shape",
      sql`${t.status} in ('draft', 'withdrawn') or (${t.proposedAt} is not null and ${t.proposedBy} is not null and ${t.reason} is not null)`,
    ),
    check(
      "value_change_authorised_shape",
      sql`${t.status} <> 'authorised' or (
            ${t.authorisedOn} is not null and ${t.authorisedByPersonId} is not null
        and ${t.authorisationEvidenceId} is not null and ${t.authorisationRecordedBy} is not null
        and ${t.authorisationRecordedAt} is not null)`,
    ),
    check(
      "value_change_closed_shape",
      sql`(${t.status} in ('rejected', 'withdrawn')) = (${t.closedAt} is not null and ${t.closedBy} is not null)`,
    ),
    uniqueIndex("value_change_one_open_uq")
      .on(t.valueCaseId)
      .where(sql`${t.status} in ('draft', 'proposed')`),
  ],
);

/**
 * Links evidence to exactly one target: a driver version, an assumption, or an
 * Assurance Review (evidence relevant to that review's value position).
 */
export const evidenceLink = pgTable(
  "evidence_link",
  {
    id: id(),
    evidenceId: uuid().notNull(),
    projectId: uuid().notNull(),
    valueDriverVersionId: uuid(),
    assumptionId: uuid(),
    assuranceReviewId: uuid(),
    relevanceNote: text(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "evidence_link_evidence_fk",
      columns: [t.evidenceId, t.projectId],
      foreignColumns: [evidence.id, evidence.projectId],
    }),
    foreignKey({
      name: "evidence_link_driver_version_fk",
      columns: [t.valueDriverVersionId, t.projectId],
      foreignColumns: [valueDriverVersion.id, valueDriverVersion.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "evidence_link_assumption_fk",
      columns: [t.assumptionId, t.projectId],
      foreignColumns: [assumption.id, assumption.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "evidence_link_review_fk",
      columns: [t.assuranceReviewId, t.projectId],
      foreignColumns: [assuranceReview.id, assuranceReview.projectId],
    }).onDelete("cascade"),
    check(
      "evidence_link_exactly_one_target",
      sql`num_nonnulls(${t.valueDriverVersionId}, ${t.assumptionId}, ${t.assuranceReviewId}) = 1`,
    ),
    uniqueIndex("evidence_link_driver_version_uq")
      .on(t.evidenceId, t.valueDriverVersionId)
      .where(sql`${t.valueDriverVersionId} is not null`),
    uniqueIndex("evidence_link_assumption_uq")
      .on(t.evidenceId, t.assumptionId)
      .where(sql`${t.assumptionId} is not null`),
    uniqueIndex("evidence_link_review_uq")
      .on(t.evidenceId, t.assuranceReviewId)
      .where(sql`${t.assuranceReviewId} is not null`),
  ],
);

// ---------------------------------------------------------------------------
// Information Request

export const informationRequest = pgTable(
  "information_request",
  {
    id: id(),
    projectId: uuid()
      .notNull()
      .references(() => project.id),
    reference: text().notNull(),
    title: text().notNull(),
    status: informationRequestStatus().notNull().default("draft"),
    issuedOn: date(),
    closedOn: date(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("information_request_reference_uq").on(t.projectId, t.reference),
    unique("information_request_id_project_uq").on(t.id, t.projectId),
    check("information_request_issued_shape", sql`${t.status} = 'draft' or ${t.issuedOn} is not null`),
    check("information_request_closed_shape", sql`${t.status} <> 'closed' or ${t.closedOn} is not null`),
  ],
);

export const informationRequestItem = pgTable(
  "information_request_item",
  {
    id: id(),
    informationRequestId: uuid().notNull(),
    projectId: uuid().notNull(),
    sequence: integer().notNull(),
    description: text().notNull(),
    requestedFromPersonId: uuid(),
    dueOn: date(),
    // Stable driver identity (not a version): requests persist across versions.
    valueDriverId: uuid(),
    status: informationRequestItemStatus().notNull().default("open"),
    fulfilledByEvidenceId: uuid(),
    notes: text(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("information_request_item_sequence_uq").on(t.informationRequestId, t.sequence),
    foreignKey({
      name: "information_request_item_request_fk",
      columns: [t.informationRequestId, t.projectId],
      foreignColumns: [informationRequest.id, informationRequest.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "information_request_item_requested_from_fk",
      columns: [t.projectId, t.requestedFromPersonId],
      foreignColumns: [projectStakeholder.projectId, projectStakeholder.personId],
    }),
    foreignKey({
      name: "information_request_item_driver_fk",
      columns: [t.valueDriverId, t.projectId],
      foreignColumns: [valueDriver.id, valueDriver.projectId],
    }),
    foreignKey({
      name: "information_request_item_evidence_fk",
      columns: [t.fulfilledByEvidenceId, t.projectId],
      foreignColumns: [evidence.id, evidence.projectId],
    }),
  ],
);

// ---------------------------------------------------------------------------
// Issued client reports (Phase 4A). Insert-only: an issue is an immutable snapshot
// of the report view model at issue time plus a reference to the generated PDF.
// A later issue of the same subject is a new row with the next issue number.

export const reportIssue = pgTable(
  "report_issue",
  {
    id: id(),
    projectId: uuid()
      .notNull()
      .references(() => project.id),
    type: reportType().notNull(),
    // Exactly one subject, matching the type.
    informationRequestId: uuid(),
    valueCaseVersionId: uuid(),
    assuranceReviewId: uuid(),
    valueChangeId: uuid(),
    /** The subject's status when issued (e.g. a Value Change Notice issued as proposed). */
    subjectStatus: text().notNull(),
    /** 1, 2, … per subject and type. */
    issueNumber: integer().notNull(),
    title: text().notNull(),
    /** The report view model exactly as rendered. */
    snapshot: jsonb().notNull(),
    /** sha256 of the canonical JSON of `snapshot`. */
    snapshotSha256: char({ length: 64 }).notNull(),
    rendererVersion: text().notNull(),
    /** Storage key of the generated PDF (content-addressed). */
    documentKey: text().notNull(),
    documentSha256: char({ length: 64 }).notNull(),
    documentBytes: integer().notNull(),
    issuedBy: uuid()
      .notNull()
      .references(() => appUser.id),
    /** Name as printed on the issued document. */
    issuedByName: text().notNull(),
    issuedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "report_issue_information_request_fk",
      columns: [t.informationRequestId, t.projectId],
      foreignColumns: [informationRequest.id, informationRequest.projectId],
    }),
    foreignKey({
      name: "report_issue_version_fk",
      columns: [t.valueCaseVersionId, t.projectId],
      foreignColumns: [valueCaseVersion.id, valueCaseVersion.projectId],
    }),
    foreignKey({
      name: "report_issue_review_fk",
      columns: [t.assuranceReviewId, t.projectId],
      foreignColumns: [assuranceReview.id, assuranceReview.projectId],
    }),
    foreignKey({
      name: "report_issue_value_change_fk",
      columns: [t.valueChangeId, t.projectId],
      foreignColumns: [valueChange.id, valueChange.projectId],
    }),
    check(
      "report_issue_subject_shape",
      sql`(${t.type} = 'information_request') = (${t.informationRequestId} is not null)
        and (${t.type} = 'requalification') = (${t.valueCaseVersionId} is not null)
        and (${t.type} = 'assurance') = (${t.assuranceReviewId} is not null)
        and (${t.type} = 'value_change_notice') = (${t.valueChangeId} is not null)`,
    ),
    check("report_issue_number_positive", sql`${t.issueNumber} >= 1`),
    check(
      "report_issue_hashes",
      sql`${t.snapshotSha256} ~ '^[0-9a-f]{64}$' and ${t.documentSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check("report_issue_document_bytes", sql`${t.documentBytes} > 0`),
    uniqueIndex("report_issue_subject_number_uq").on(
      t.type,
      sql`coalesce(${t.informationRequestId}, ${t.valueCaseVersionId}, ${t.assuranceReviewId}, ${t.valueChangeId})`,
      t.issueNumber,
    ),
    index("report_issue_project_idx").on(t.projectId, t.issuedAt),
  ],
);

// ---------------------------------------------------------------------------
// Audit (append-only; written only by the audit trigger)

export const auditEvent = pgTable(
  "audit_event",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    transactionId: bigint({ mode: "number" }).notNull(),
    actorUserId: uuid()
      .notNull()
      .references(() => appUser.id),
    command: text().notNull(),
    tableName: text().notNull(),
    rowId: uuid().notNull(),
    action: text().notNull(),
    oldRow: jsonb(),
    newRow: jsonb(),
  },
  (t) => [
    index("audit_event_row_idx").on(t.tableName, t.rowId),
    index("audit_event_tx_idx").on(t.transactionId),
    check("audit_event_action", sql`${t.action} in ('INSERT', 'UPDATE', 'DELETE')`),
  ],
);
