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
    return { status: "error", message: CODES[err.code] ?? err.message, nonce };
  }
  console.error(err);
  return { status: "error", message: "Unexpected error — the change was not saved.", nonce };
}
