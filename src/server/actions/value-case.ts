"use server";

import {
  EVIDENCE_STATUSES,
  QUALIFICATION_STATUSES,
  type EvidenceStatus,
  type QualificationStatus,
} from "@/domain/statuses";
import {
  addAssumption,
  addValueDriver,
  authoriseInitialVersion,
  createDraftVersion,
  createInheritedBusinessCase,
  proposeVersion,
  recordInheritedBusinessCase,
  removeAssumption,
  removeValueDriver,
  returnVersionToDraft,
  updateAssumption,
  updateDriverVersion,
  updateVersionDetails,
} from "@/server/commands/value-case";

import { bool, clear, FormInputError, metricField, moneyField, opt, required } from "./form";
import { perform } from "./perform";
import type { ActionState } from "./state";

const projectOf = (fd: FormData) => required(fd, "projectId");

function qualification(fd: FormData): QualificationStatus | undefined {
  const v = opt(fd, "qualificationStatus");
  return (QUALIFICATION_STATUSES as readonly string[]).includes(v ?? "") ? (v as QualificationStatus) : undefined;
}
function evidenceStatus(fd: FormData): EvidenceStatus | undefined {
  const v = opt(fd, "evidenceStatus");
  return (EVIDENCE_STATUSES as readonly string[]).includes(v ?? "") ? (v as EvidenceStatus) : undefined;
}

/**
 * Financial value unless the consultant marks the driver non-financial, which
 * stores null (PMO decision: non-financial drivers carry no value and are
 * excluded from the financial total).
 */
function financialValue(fd: FormData, mode: "create"): string | undefined;
function financialValue(fd: FormData, mode: "update"): string | null | undefined;
function financialValue(fd: FormData, mode: "create" | "update") {
  if (bool(fd, "nonFinancial")) return mode === "create" ? undefined : null;
  const value =
    mode === "create" ? moneyField(fd, "financialValue", "create") : moneyField(fd, "financialValue", "update");
  if (value === undefined || value === null) {
    throw new FormInputError(
      "financialValue",
      "Enter a financial value (negative values are allowed), or mark the driver as non-financial",
    );
  }
  return value;
}

// --- V0 ----------------------------------------------------------------------

export async function createInheritedBusinessCaseAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await createInheritedBusinessCase(actor, {
      projectId: projectOf(fd),
      title: required(fd, "title"),
      summary: opt(fd, "summary"),
      statedTotalValue: moneyField(fd, "statedTotalValue", "create"),
    });
    return "Original Business Case started";
  });
}

export async function updateVersionDetailsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await updateVersionDetails(actor, {
      versionId: required(fd, "versionId"),
      title: required(fd, "title"),
      summary: clear(fd, "summary"),
      statedTotalValue: fd.has("statedTotalValue") ? moneyField(fd, "statedTotalValue", "update") : undefined,
    });
    return "Version details saved";
  });
}

export async function recordInheritedBusinessCaseAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await recordInheritedBusinessCase(actor, { versionId: required(fd, "versionId") });
    return "Original Business Case recorded and locked";
  });
}

// --- Draft V1 ----------------------------------------------------------------

export async function createDraftVersionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await createDraftVersion(actor, {
      projectId: projectOf(fd),
      title: required(fd, "title"),
      summary: opt(fd, "summary"),
      basedOnVersionId: opt(fd, "basedOnVersionId"),
    });
    return "Draft Value Case (V1) created";
  });
}

export async function addValueDriverAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const { driver } = await addValueDriver(actor, {
      versionId: required(fd, "versionId"),
      code: required(fd, "code").toUpperCase(),
      name: required(fd, "name"),
      metric: opt(fd, "metric"),
      metricUnit: opt(fd, "metricUnit"),
      baselineValue: metricField(fd, "baselineValue", "create") ?? undefined,
      targetValue: metricField(fd, "targetValue", "create") ?? undefined,
      financialValue: financialValue(fd, "create"),
      sortOrder: Number(opt(fd, "sortOrder") ?? 0) || 0,
    });
    return `Value Driver ${driver.code} added`;
  });
}

export async function updateDriverVersionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await updateDriverVersion(actor, {
      driverVersionId: required(fd, "driverVersionId"),
      name: required(fd, "name"),
      description: clear(fd, "description"),
      metric: clear(fd, "metric"),
      metricUnit: clear(fd, "metricUnit"),
      baselineValue: metricField(fd, "baselineValue", "update"),
      targetValue: metricField(fd, "targetValue", "update"),
      calculationRationale: clear(fd, "calculationRationale"),
      financialValue: financialValue(fd, "update"),
      timingDescription: clear(fd, "timingDescription"),
      benefitStartDate: clear(fd, "benefitStartDate"),
      benefitFullDate: clear(fd, "benefitFullDate"),
      avoPersonId: clear(fd, "avoPersonId"),
      qualificationStatus: qualification(fd),
      evidenceStatus: evidenceStatus(fd),
      notes: clear(fd, "notes"),
    });
    return "Value Driver saved";
  });
}

export async function removeValueDriverAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await removeValueDriver(actor, { driverVersionId: required(fd, "driverVersionId") });
    return "Value Driver removed from the draft";
  });
}

export async function addAssumptionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await addAssumption(actor, {
      driverVersionId: required(fd, "driverVersionId"),
      statement: required(fd, "statement"),
      evidenceStatus: evidenceStatus(fd),
      notes: opt(fd, "notes"),
    });
    return "Assumption added";
  });
}

export async function updateAssumptionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await updateAssumption(actor, {
      assumptionId: required(fd, "assumptionId"),
      statement: required(fd, "statement"),
      evidenceStatus: evidenceStatus(fd),
      notes: clear(fd, "notes"),
    });
    return "Assumption saved";
  });
}

export async function removeAssumptionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await removeAssumption(actor, { assumptionId: required(fd, "assumptionId") });
    return "Assumption removed";
  });
}

// --- Proposal & authorisation --------------------------------------------------

export async function proposeVersionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await proposeVersion(actor, { versionId: required(fd, "versionId") });
    return "V1 proposed for VCO authorisation — the draft is now locked";
  });
}

export async function returnVersionToDraftAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await returnVersionToDraft(actor, { versionId: required(fd, "versionId") });
    return "Returned to draft — editing re-enabled";
  });
}

export async function authoriseInitialVersionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await authoriseInitialVersion(actor, {
      versionId: required(fd, "versionId"),
      authorisedByPersonId: required(fd, "authorisedByPersonId"),
      authorisedOn: required(fd, "authorisedOn"),
      authorisationEvidenceId: required(fd, "authorisationEvidenceId"),
      authorisationNote: opt(fd, "authorisationNote"),
    });
    return "Authorisation recorded — Authorised Value Case V1 is now in force and read-only";
  });
}
