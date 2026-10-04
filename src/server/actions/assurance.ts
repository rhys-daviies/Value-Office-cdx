"use server";

import { redirect } from "next/navigation";

import { ASSURANCE_TRIGGERS, type AssuranceTrigger } from "@/domain/statuses";
import {
  createReview,
  finaliseReview,
  linkReviewEvidence,
  unlinkReviewEvidence,
  updateReview,
  upsertValuePositions,
} from "@/server/commands/assurance";

import { bool, clear, moneyField, opt, required } from "./form";
import { perform } from "./perform";
import type { ActionState } from "./state";

const projectOf = (fd: FormData) => required(fd, "projectId");

function triggerOf(fd: FormData): AssuranceTrigger {
  const v = required(fd, "trigger");
  return (ASSURANCE_TRIGGERS as readonly string[]).includes(v) ? (v as AssuranceTrigger) : ("" as AssuranceTrigger);
}

export async function createReviewAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let reviewId: string | undefined;
  const state = await perform(projectOf(fd), async (actor) => {
    const review = await createReview(actor, {
      projectId: projectOf(fd),
      trigger: triggerOf(fd),
      reviewDate: required(fd, "reviewDate"),
      triggerEvidenceId: opt(fd, "triggerEvidenceId"),
      whatChanged: opt(fd, "whatChanged"),
      whyItMatters: opt(fd, "whyItMatters"),
    });
    reviewId = review.id;
  });
  if (state.status === "ok" && reviewId) redirect(`/projects/${projectOf(fd)}/assurance/${reviewId}`);
  return state;
}

export async function updateReviewAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await updateReview(actor, {
      reviewId: required(fd, "reviewId"),
      trigger: fd.has("trigger") ? triggerOf(fd) : undefined,
      reviewDate: fd.has("reviewDate") ? required(fd, "reviewDate") : undefined,
      triggerEvidenceId: clear(fd, "triggerEvidenceId"),
      whatChanged: clear(fd, "whatChanged"),
      whyItMatters: clear(fd, "whyItMatters"),
      summary: clear(fd, "summary"),
      unattributedRealisedValue: fd.has("unattributedRealisedValue")
        ? moneyField(fd, "unattributedRealisedValue", "update")
        : undefined,
      unattributedRealisedRationale: clear(fd, "unattributedRealisedRationale"),
    });
    return "Review saved";
  });
}

/**
 * Saves every driver's position in one command. Inputs are named
 * `<field>__<valueDriverId>`; a blank amount means "not assessed" (null).
 */
export async function saveValuePositionsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const driverIds = required(fd, "driverIds").split(",").filter(Boolean);
    await upsertValuePositions(actor, {
      reviewId: required(fd, "reviewId"),
      positions: driverIds.map((id) => ({
        valueDriverId: id,
        forecastNotAssessed: fd.has(`forecast__${id}`) ? bool(fd, `notAssessed__${id}`) : undefined,
        currentForecast: moneyField(fd, `forecast__${id}`, "update"),
        realisedValue: moneyField(fd, `realised__${id}`, "update"),
        forecastRationale: clear(fd, `forecastRationale__${id}`),
        realisedValueRationale: clear(fd, `realisedRationale__${id}`),
        valueLeakageId: clear(fd, `matter__${id}`),
      })),
    });
    return "Value Positions saved";
  });
}

export async function linkReviewEvidenceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await linkReviewEvidence(actor, {
      reviewId: required(fd, "reviewId"),
      evidenceId: required(fd, "evidenceId"),
      relevanceNote: opt(fd, "relevanceNote"),
    });
    return "Evidence linked to the review";
  });
}

export async function unlinkReviewEvidenceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    await unlinkReviewEvidence(actor, { evidenceLinkId: required(fd, "evidenceLinkId") });
    return "Evidence unlinked";
  });
}

export async function finaliseReviewAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return perform(projectOf(fd), async (actor) => {
    const review = await finaliseReview(actor, { reviewId: required(fd, "reviewId") });
    return `Assurance Review #${review.sequence} finalised — it is now read-only`;
  });
}
