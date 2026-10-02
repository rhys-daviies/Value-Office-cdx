import { and, asc, desc, eq } from "drizzle-orm";

import { arrangeOutcomes, differenceFromRecommendation, type Outcome } from "@/domain/outcomes";
import type { AssuranceTrigger } from "@/domain/statuses";
import { db, schema } from "@/server/db/client";

import { getAssuranceWorkspace } from "./assurance";

// Alternative Value Outcomes (Phase 4D.6): one review's decision economics, as recorded at that review.
// References (not options): the Authorised Value of the version the review measured against, and the
// review's own formal Current Forecast. Outcomes: the review's stored scenarios with Cardaxia's issued
// recommendation and the client decision marked on them. Never later reviews, later versions, Value
// Changes or working values. Amounts are decimal strings.

export type AlternativeValueOutcomes = {
  currency: string;
  review: {
    id: string;
    sequence: number;
    date: string;
    trigger: AssuranceTrigger;
    finalised: boolean;
    againstVersionNumber: number;
  };
  /** Reference: Authorised Value of the version this review measured against. */
  authorisedValue: string;
  /** Reference: this review's formal Current Forecast; null when the forecast is incomplete. */
  currentFormalForecast: string | null;
  outcomes: Outcome[];
  recommendation: { id: string; scenarioId: string; narrative: string; issuedAt: Date } | null;
  decision: {
    id: string;
    selectedScenarioId: string;
    decidedOn: string;
    deciderName: string | null;
    rationale: string | null;
  } | null;
  /** Client-selected total − recommended total (decimal string, signed); null unless both exist. */
  differenceFromRecommendation: string | null;
};

export async function getAlternativeValueOutcomes(
  projectId: string,
  reviewId: string,
): Promise<AlternativeValueOutcomes | null> {
  const ws = await getAssuranceWorkspace(projectId, reviewId);
  if (!ws) return null;
  const [[project], scenarios, [rec], [dec]] = await Promise.all([
    db().select({ currency: schema.project.currency }).from(schema.project).where(eq(schema.project.id, projectId)),
    db()
      .select({
        id: schema.scenario.id,
        label: schema.scenario.label,
        kind: schema.scenario.kind,
        totalValue: schema.scenario.totalValue,
        narrative: schema.scenario.narrative,
      })
      .from(schema.scenario)
      .where(eq(schema.scenario.assuranceReviewId, reviewId))
      .orderBy(asc(schema.scenario.sortOrder), asc(schema.scenario.createdAt), asc(schema.scenario.id)),
    db().select().from(schema.recommendation).where(eq(schema.recommendation.assuranceReviewId, reviewId)),
    db()
      .select({ decision: schema.decision, deciderName: schema.person.name })
      .from(schema.decision)
      .leftJoin(schema.person, eq(schema.person.id, schema.decision.decidedByPersonId))
      .where(eq(schema.decision.assuranceReviewId, reviewId)),
  ]);

  // Only an issued recommendation is governed; a saved draft is not presented as Cardaxia's position.
  const recommendation = rec?.issuedAt
    ? { id: rec.id, scenarioId: rec.scenarioId, narrative: rec.narrative, issuedAt: rec.issuedAt }
    : null;
  const outcomes = arrangeOutcomes(
    scenarios,
    recommendation?.scenarioId ?? null,
    dec?.decision.selectedScenarioId ?? null,
  );
  return {
    currency: project?.currency ?? "USD",
    review: {
      id: ws.review.id,
      sequence: ws.review.sequence,
      date: ws.review.reviewDate,
      trigger: ws.review.trigger,
      finalised: ws.review.status === "finalised",
      againstVersionNumber: ws.againstVersion.versionNumber,
    },
    authorisedValue: ws.totals.authorisedTotal,
    currentFormalForecast: ws.totals.forecastTotal,
    outcomes,
    recommendation,
    decision: dec
      ? {
          id: dec.decision.id,
          selectedScenarioId: dec.decision.selectedScenarioId,
          decidedOn: dec.decision.decidedOn,
          deciderName: dec.deciderName,
          rationale: dec.decision.rationale,
        }
      : null,
    differenceFromRecommendation: differenceFromRecommendation(outcomes),
  };
}

/** Whether a review carries decision context worth showing: stored outcomes plus a recommendation or decision. */
export function hasDecisionContext(o: AlternativeValueOutcomes): boolean {
  return o.outcomes.length > 0 && (o.recommendation !== null || o.decision !== null);
}

/**
 * Overview (Phase 4D.9L): the latest formal position and the latest recorded value decision are distinct.
 * `recorded` is the management decision at the latest finalised review that has one (governed Assurance history,
 * ordered by review sequence) — it may belong to an earlier review than the latest formal position. `awaiting` is
 * the latest finalised review's issued Cardaxia recommendation when no management decision is recorded against it:
 * a recommendation, never presented as a decision.
 */
export type LatestValueDecision = {
  recorded: AlternativeValueOutcomes | null;
  awaiting: AlternativeValueOutcomes | null;
};

export async function getLatestValueDecision(projectId: string): Promise<LatestValueDecision> {
  const finalised = and(
    eq(schema.assuranceReview.projectId, projectId),
    eq(schema.assuranceReview.status, "finalised"),
  );
  const [[latest], [decided]] = await Promise.all([
    db()
      .select({ id: schema.assuranceReview.id })
      .from(schema.assuranceReview)
      .where(finalised)
      .orderBy(desc(schema.assuranceReview.sequence))
      .limit(1),
    db()
      .select({ id: schema.assuranceReview.id })
      .from(schema.assuranceReview)
      .innerJoin(schema.decision, eq(schema.decision.assuranceReviewId, schema.assuranceReview.id))
      .where(finalised)
      .orderBy(desc(schema.assuranceReview.sequence))
      .limit(1),
  ]);
  const recorded = decided ? await getAlternativeValueOutcomes(projectId, decided.id) : null;
  let awaiting: AlternativeValueOutcomes | null = null;
  if (latest && latest.id !== decided?.id) {
    const o = await getAlternativeValueOutcomes(projectId, latest.id);
    if (o && o.outcomes.length > 0 && o.recommendation && !o.decision) awaiting = o;
  }
  return { recorded: recorded && hasDecisionContext(recorded) ? recorded : null, awaiting };
}
