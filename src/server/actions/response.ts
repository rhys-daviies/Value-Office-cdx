"use server";

import { SCENARIO_KINDS, type ScenarioKind } from "@/domain/statuses";
import { assessLeakage, createLeakage, setLeakageDrivers, updateLeakage } from "@/server/commands/leakage";
import {
  approveRecommendation,
  issueRecommendation,
  recordDecision,
  removeScenario,
  returnRecommendation,
  saveRecommendation,
  submitRecommendation,
  upsertScenario,
} from "@/server/commands/options";

import { clear, moneyField, opt, required } from "./form";
import { perform } from "./perform";
import type { ActionState } from "./state";

const projectOf = (fd: FormData) => required(fd, "projectId");
const driverIdsOf = (fd: FormData) => fd.getAll("driverIds").filter((v): v is string => typeof v === "string" && !!v);

function requiredMoney(fd: FormData, name: string): string {
  return moneyField(fd, name, "create") ?? "";
}

// --- Value Leakage ---------------------------------------------------------------

export async function createLeakageAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const row = await createLeakage(actor, {
      reviewId: required(fd, "reviewId"),
      code: required(fd, "code").toUpperCase(),
      title: required(fd, "title"),
      description: opt(fd, "description"),
      responseOwnerPersonId: opt(fd, "responseOwnerPersonId"),
      requiredDecisionDate: opt(fd, "requiredDecisionDate"),
      consultantAssessment: opt(fd, "consultantAssessment"),
      driverIds: driverIdsOf(fd),
    });
    return `${row.code} recorded`;
  });
}

export async function updateLeakageAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const leakageId = required(fd, "leakageId");
    await updateLeakage(actor, {
      leakageId,
      title: required(fd, "title"),
      description: clear(fd, "description"),
      responseOwnerPersonId: clear(fd, "responseOwnerPersonId"),
      requiredDecisionDate: clear(fd, "requiredDecisionDate"),
      consultantAssessment: clear(fd, "consultantAssessment"),
    });
    await setLeakageDrivers(actor, { leakageId, driverIds: driverIdsOf(fd) });
    return "Leakage item saved";
  });
}

export async function assessLeakageAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await assessLeakage(actor, {
      leakageId: required(fd, "leakageId"),
      reviewId: required(fd, "reviewId"),
      totalAmount: requiredMoney(fd, "totalAmount"),
      unrecoverableAmount: moneyField(fd, "unrecoverableAmount", "create") ?? "0.00",
      unrecoverableRationale: opt(fd, "unrecoverableRationale"),
      assessmentNote: opt(fd, "assessmentNote"),
    });
    return "Leakage assessed for this review";
  });
}

// --- Options / trajectories ----------------------------------------------------------

export async function upsertScenarioAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const kind = required(fd, "kind");
    await upsertScenario(actor, {
      reviewId: required(fd, "reviewId"),
      scenarioId: opt(fd, "scenarioId"),
      label: required(fd, "label"),
      kind: (SCENARIO_KINDS as readonly string[]).includes(kind) ? (kind as ScenarioKind) : ("" as ScenarioKind),
      totalValue: requiredMoney(fd, "totalValue"),
      narrative: clear(fd, "narrative"),
      sortOrder: Number(opt(fd, "sortOrder") ?? 0) || 0,
    });
    return "Scenario saved";
  });
}

export async function removeScenarioAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await removeScenario(actor, { scenarioId: required(fd, "scenarioId") });
    return "Scenario removed";
  });
}

export async function saveRecommendationAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await saveRecommendation(actor, {
      reviewId: required(fd, "reviewId"),
      scenarioId: required(fd, "scenarioId"),
      narrative: required(fd, "narrative"),
    });
    return "Recommendation saved (not yet issued)";
  });
}

// --- Internal Cardaxia review (Phase 4D.10G) ------------------------------------------

export async function submitRecommendationAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await submitRecommendation(actor, { reviewId: required(fd, "reviewId"), note: opt(fd, "note") });
    return "Submitted for Internal Cardaxia Review — read-only until returned or issued";
  });
}

export async function returnRecommendationAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await returnRecommendation(actor, { reviewId: required(fd, "reviewId"), feedback: required(fd, "feedback") });
    return "Returned for revision — the recommendation and options are editable again";
  });
}

export async function approveRecommendationAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await approveRecommendation(actor, { reviewId: required(fd, "reviewId"), note: opt(fd, "note") });
    return "Internal review complete — Ready to Issue";
  });
}

export async function issueRecommendationAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await issueRecommendation(actor, { reviewId: required(fd, "reviewId") });
    return "Recommendation issued to management — it and the options are now permanent";
  });
}

export async function recordDecisionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await recordDecision(actor, {
      reviewId: required(fd, "reviewId"),
      selectedScenarioId: required(fd, "selectedScenarioId"),
      decidedByPersonId: required(fd, "decidedByPersonId"),
      decidedOn: required(fd, "decidedOn"),
      rationale: opt(fd, "rationale"),
      economicConsequence: opt(fd, "economicConsequence"),
      supportingEvidenceId: opt(fd, "supportingEvidenceId"),
    });
    return "Client decision recorded";
  });
}
