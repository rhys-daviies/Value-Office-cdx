"use server";

import { redirect } from "next/navigation";

import { EVIDENCE_STATUSES, QUALIFICATION_STATUSES } from "@/domain/statuses";
import {
  addDriverAssumption,
  createEmergingDriver,
  initialiseDriverRecord,
  removeDriverAssumption,
  setDriverAvo,
  setDriverEstimate,
  setDriverEvidenceStatus,
  setDriverQualification,
  updateDriverAssumption,
  updateDriverWorking,
} from "@/server/commands/drivers";

import { clear, FormInputError, metricField, moneyField, opt, required } from "./form";
import { perform } from "./perform";
import type { ActionState } from "./state";

// Living Value Driver actions (Phase 4D.3): FormData → one named command each. Working only —
// none of these touches a Value Case version, a Value Position or any authorised total.

const projectOf = (fd: FormData) => required(fd, "projectId");
const driverOf = (fd: FormData) => required(fd, "valueDriverId");

function oneOf<T extends string>(fd: FormData, name: string, values: readonly T[]): T {
  const v = required(fd, name);
  if (!(values as readonly string[]).includes(v)) throw new FormInputError(name, "Choose a value");
  return v as T;
}

export async function createEmergingDriverAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let driverId: string | undefined;
  const state = await perform(projectOf(fd), async (actor) => {
    const { driver } = await createEmergingDriver(actor, {
      projectId: projectOf(fd),
      code: required(fd, "code").toUpperCase(),
      name: required(fd, "name"),
      description: opt(fd, "description"),
      metric: opt(fd, "metric"),
      metricUnit: opt(fd, "metricUnit"),
      baselineValue: metricField(fd, "baselineValue", "create") ?? undefined,
      targetValue: metricField(fd, "targetValue", "create") ?? undefined,
      calculationRationale: opt(fd, "calculationRationale"),
      workingEstimate: moneyField(fd, "workingEstimate", "create"),
      avoPersonId: opt(fd, "avoPersonId"),
      qualificationStatus: QUALIFICATION_STATUSES.find((s) => s === opt(fd, "qualificationStatus")),
      evidenceStatus: EVIDENCE_STATUSES.find((s) => s === opt(fd, "evidenceStatus")),
      notes: opt(fd, "notes"),
      identifiedOn: opt(fd, "identifiedOn"),
      originValueLeakageId: opt(fd, "originValueLeakageId"),
    });
    driverId = driver.id;
  });
  if (state.status === "ok" && driverId) redirect(`/projects/${projectOf(fd)}/value-drivers/${driverId}`);
  return state;
}

export async function initialiseDriverRecordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await initialiseDriverRecord(actor, { valueDriverId: driverOf(fd) });
    return "Working record started";
  });
}

export async function updateDriverWorkingAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await updateDriverWorking(actor, {
      valueDriverId: driverOf(fd),
      name: required(fd, "name"),
      description: clear(fd, "description"),
      metric: clear(fd, "metric"),
      metricUnit: clear(fd, "metricUnit"),
      baselineValue: metricField(fd, "baselineValue", "update"),
      targetValue: metricField(fd, "targetValue", "update"),
      calculationRationale: clear(fd, "calculationRationale"),
      notes: clear(fd, "notes"),
    });
    return "Working details saved";
  });
}

export async function setDriverAvoAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await setDriverAvo(actor, { valueDriverId: driverOf(fd), avoPersonId: opt(fd, "avoPersonId") ?? null });
    return "Working AVO updated";
  });
}

export async function setDriverQualificationAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await setDriverQualification(actor, {
      valueDriverId: driverOf(fd),
      qualificationStatus: oneOf(fd, "qualificationStatus", QUALIFICATION_STATUSES),
    });
    return "Working qualification updated";
  });
}

export async function setDriverEvidenceStatusAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await setDriverEvidenceStatus(actor, {
      valueDriverId: driverOf(fd),
      evidenceStatus: oneOf(fd, "evidenceStatus", EVIDENCE_STATUSES),
    });
    return "Working evidence status updated";
  });
}

/** intent=clear → not yet quantified. */
export async function setDriverEstimateAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const clearIt = required(fd, "intent") === "clear";
    const estimate = clearIt ? null : moneyField(fd, "workingEstimate", "update");
    if (!clearIt && !estimate) throw new FormInputError("workingEstimate", "Required");
    await setDriverEstimate(actor, { valueDriverId: driverOf(fd), workingEstimate: estimate ?? null });
    return clearIt ? "Working estimate cleared" : "Working estimate recorded";
  });
}

export async function addDriverAssumptionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await addDriverAssumption(actor, {
      valueDriverId: driverOf(fd),
      statement: required(fd, "statement"),
      evidenceStatus: EVIDENCE_STATUSES.find((s) => s === opt(fd, "evidenceStatus")),
      notes: opt(fd, "notes"),
    });
    return "Working assumption added";
  });
}

export async function updateDriverAssumptionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await updateDriverAssumption(actor, {
      assumptionId: required(fd, "assumptionId"),
      statement: required(fd, "statement"),
      evidenceStatus: oneOf(fd, "evidenceStatus", EVIDENCE_STATUSES),
      notes: clear(fd, "notes"),
    });
    return "Working assumption saved";
  });
}

export async function removeDriverAssumptionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await removeDriverAssumption(actor, { assumptionId: required(fd, "assumptionId") });
    return "Working assumption removed";
  });
}
