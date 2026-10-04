import { DomainError, type InputIssue } from "@/domain/errors";

import { FormInputError } from "./form";
import type { ActionState } from "./state";

// Maps command-layer errors to consultant-facing messages. The rules themselves
// live in commands and the database; this only explains them.

type Explanation = { field?: string; message: string };

const CONSTRAINTS: Record<string, Explanation> = {
  project_code_uq: { field: "code", message: "That project code is already in use." },
  project_currency_iso: { field: "currency", message: "Use a three-letter ISO currency code, e.g. USD." },
  project_value_period_order: { field: "valuePeriodEnd", message: "The period end must be on or after the start." },
  key_date_single_kickoff_golive_uq: {
    field: "kind",
    message: "This project already has that key date. Remove the existing one first.",
  },
  value_driver_code_uq: { field: "code", message: "A Value Driver with this code already exists in this Value Case." },
  evidence_code_uq: { field: "code", message: "Evidence with this code already exists in this project." },
  evidence_not_self_superseding: { field: "supersedesEvidenceId", message: "Evidence cannot supersede itself." },
  information_request_reference_uq: {
    field: "reference",
    message: "An Information Request with this reference already exists.",
  },
  information_request_item_sequence_uq: { message: "Another item was added at the same time. Please retry." },
  value_case_one_open_version_uq: { message: "There is already a draft or proposed Value Case version." },
  value_case_version_number_uq: { message: "That version already exists." },
  value_driver_version_benefit_dates_order: {
    field: "benefitFullDate",
    message: "The full run-rate date must be on or after the realisation start.",
  },
  evidence_link_driver_version_uq: { field: "evidenceId", message: "That evidence is already linked here." },
  evidence_link_assumption_uq: { field: "evidenceId", message: "That evidence is already linked here." },
  value_case_vco_fk: { field: "personId", message: "The Value Case Owner must be a stakeholder on this project." },
  value_driver_version_avo_fk: { field: "avoPersonId", message: "The AVO must be a stakeholder on this project." },
  value_case_version_authorised_by_fk: {
    field: "authorisedByPersonId",
    message: "The authoriser must be a stakeholder on this project.",
  },
  value_case_version_authorisation_evidence_fk: {
    field: "authorisationEvidenceId",
    message: "Authorisation evidence must belong to this project.",
  },
  assurance_review_one_draft_uq: { message: "A draft Assurance Review is already open — finalise it first." },
  assurance_review_sequence_uq: { message: "Another review was opened at the same time. Please retry." },
  assurance_review_trigger_evidence_fk: {
    field: "triggerEvidenceId",
    message: "Trigger evidence must belong to this project.",
  },
  evidence_link_review_uq: { field: "evidenceId", message: "That evidence is already linked to this review." },
  value_leakage_code_uq: {
    field: "code",
    message: "An Assurance matter with this code already exists in this project.",
  },
  value_leakage_working_range: {
    field: "workingUnrecoverableAmount",
    message: "Working amounts cannot be negative, and unrecoverable cannot exceed the working total.",
  },
  value_leakage_working_rationale: {
    field: "workingUnrecoverableRationale",
    message: "Required when unrecoverable is above zero",
  },
  value_leakage_owner_fk: {
    field: "responseOwnerPersonId",
    message: "The Risk / Leakage Owner must be a stakeholder on this project.",
  },
  value_leakage_driver_driver_fk: { field: "driverIds", message: "Affected drivers must belong to this Value Case." },
  leakage_assessment_unrecoverable_range: {
    field: "unrecoverableAmount",
    message: "Unrecoverable must be between zero and the total leakage.",
  },
  leakage_assessment_total_non_negative: { field: "totalAmount", message: "Total leakage cannot be negative." },
  scenario_one_current_uq: { field: "kind", message: "This review already has a Current trajectory scenario." },
  scenario_one_recommended_uq: { field: "kind", message: "This review already has a Recommended scenario." },
  decision_review_uq: { message: "A client decision has already been recorded for this review." },
  decision_decided_by_fk: {
    field: "decidedByPersonId",
    message: "The decision maker must be a stakeholder on this project.",
  },
  value_change_code_uq: { field: "code", message: "A Value Change with this code already exists." },
  value_change_one_open_uq: { message: "Another Value Change is still open — authorise, reject or withdraw it first." },
  value_change_proposed_shape: { field: "reason", message: "Record the reason for the change before proposing it." },
  value_change_authorised_shape: {
    field: "authorisationEvidenceId",
    message: "Authorisation needs the VCO, a date and supporting evidence.",
  },
  value_case_version_authorised_shape: {
    field: "authorisationEvidenceId",
    message: "Authorisation needs the VCO, a date and supporting evidence.",
  },
};

const CODES: Record<string, string> = {
  VO_UNIQUE_VIOLATION: "That already exists.",
  VO_REFERENCE_VIOLATION: "This refers to a record outside this project, or one that is still in use.",
  VO_CHECK_VIOLATION: "Some values are inconsistent with each other.",
  VO_INVALID_VALUE: "A value is not in the allowed format.",
};

// Consultant terminology (4D.10B) for rule messages raised by commands and database guards, which keep their
// original wording. The Re-Qualification Report keeps its name (reports are unchanged).
const TERMINOLOGY: [RegExp, string][] = [
  [/\b(?:the )?inherited Business Case \(V0\)/gi, "the Original Business Case"],
  [/\binherited Business Case\b/gi, "Original Business Case"],
  [/\brecording V0\b/g, "recording the Original Business Case"],
  [/\bRe-Qualified Value Case\b/g, "Value Case"],
  [/\bRe-Qualification\b(?! Report)/g, "Value Case Definition"],
];

/** Keeps the matched text's leading capital, so "The inherited…" reads "The Original…". */
export function presentRuleMessage(message: string): string {
  return TERMINOLOGY.reduce(
    (m, [pattern, term]) =>
      m.replace(pattern, (hit) => (/^[A-Z]/.test(hit) ? term[0]!.toUpperCase() + term.slice(1) : term)),
    message,
  );
}

function friendlyIssue(issue: InputIssue): string {
  if (/>=1 character|received undefined|expected string, received null/i.test(issue.message)) return "Required";
  if (/ISO date/i.test(issue.message)) return "Enter a valid date";
  if (/Invalid UUID/i.test(issue.message)) return "Choose an option";
  return issue.message;
}

export function toActionState(err: unknown): ActionState {
  const nonce = Date.now();
  if (err instanceof FormInputError) {
    return {
      status: "error",
      message: "Please correct the highlighted field.",
      fieldErrors: { [err.field]: err.message },
      nonce,
    };
  }
  if (err instanceof DomainError) {
    if (err.code === "VO_INVALID_INPUT" && err.details.issues?.length) {
      const fieldErrors = Object.fromEntries(err.details.issues.map((i) => [i.path || "_form", friendlyIssue(i)]));
      const formLevel = fieldErrors._form;
      return {
        status: "error",
        message: formLevel ?? "Please correct the highlighted fields.",
        fieldErrors,
        nonce,
      };
    }
    const known = err.details.constraint ? CONSTRAINTS[err.details.constraint] : undefined;
    if (known) {
      return {
        status: "error",
        message: known.message,
        fieldErrors: known.field ? { [known.field]: known.message } : undefined,
        nonce,
      };
    }
    // Rule violations raised by commands/triggers already carry a readable message.
    return { status: "error", message: CODES[err.code] ?? presentRuleMessage(err.message), nonce };
  }
  console.error(err);
  return { status: "error", message: "Unexpected error — the change was not saved.", nonce };
}
