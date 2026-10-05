import { and, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { AssuranceStage, AssuranceTrigger, LeakageStatus } from "@/domain/statuses";
import type { LeakageAmounts } from "@/domain/response";
import type { RecommendationState } from "@/domain/recommendation";
import { realisedPositionComplete } from "@/domain/trajectory";
import { db, schema } from "@/server/db/client";

import { getAssuranceWorkspace } from "./assurance";
import { getReviewResponse } from "./response";

// Review story (Phase 4D.9G): the management context of one Assurance Review — what changed, the value affected, the
// options and Cardaxia's response, the client decision, and any Value Change it led to. Composition of existing
// governed records through EXPLICIT relationships only:
//   matter ↔ review     leakage_assessment (a finalised review's matter snapshot; a draft review's own assessments)
//   matter ↔ driver     the snapshot's driver ids (finalised) / value_leakage_driver (draft, living)
//   driver movement     this review's Value Position rows
//   evidence            the review's formal evidence (trigger + review links); matter evidence links are working
//                       links and are not presented as formal review evidence
//   Value Change        value_change.assurance_review_id = review, or value_change.decision_id = its decision
// Nothing is inferred from dates or amounts; no figures are recalculated beyond the existing exact-decimal helpers.

export type StoryMatter = {
  id: string;
  code: string;
  title: string;
  status: LeakageStatus;
  stage: AssuranceStage | null;
  ownerName: string | null;
  raisedInThisReview: boolean;
  /** Affected drivers with this review's formal forecast movement (null when the driver has no position here). */
  drivers: {
    code: string;
    name: string | null;
    previousForecast: string | null;
    currentForecast: string | null;
    movement: string | null;
  }[];
  /** This review's Value Leakage for the matter (Total = Recoverable + Unrecoverable); null = not yet quantified. */
  leakage: LeakageAmounts | null;
};

export type ReviewStory = {
  /** Finalised review = the governed record; draft = working context only. */
  governed: boolean;
  review: {
    sequence: number;
    date: string;
    trigger: AssuranceTrigger;
    whatChanged: string | null;
    whyItMatters: string | null;
    againstVersionNumber: number;
  };
  /** The review's formal (or, on a draft, working) value position. Value Gap stays distinct from Value Leakage. */
  position: {
    authorisedTotal: string;
    forecastTotal: string | null;
    valueGap: string | null;
    realisedTotal: string | null;
    realisedComplete: boolean;
  };
  evidence: { code: string; title: string; trigger: boolean }[];
  /**
   * finalised + snapshot: the matters the review recorded; legacy finalised: matters raised in or assessed in it;
   * draft: open matters (to be snapshotted at finalisation) and any assessed in this draft.
   */
  matterBasis: "snapshot" | "legacy" | "working";
  matters: StoryMatter[];
  recommendation: {
    issued: boolean;
    /** Phase 4D.10G lifecycle state (draft / in internal review / returned / ready to issue / issued). */
    state: RecommendationState;
    label: string;
    totalValue: string;
    milestones: number;
  } | null;
  decision: {
    label: string;
    totalValue: string;
    milestones: number;
    deciderName: string;
    decidedOn: string;
    rationale: string | null;
    economicConsequence: string | null;
    /** Selected − recommended stored totals (exact decimal); null without a recommendation. */
    differenceFromRecommendation: string | null;
  } | null;
  valueChanges: {
    id: string;
    code: string;
    status: string;
    fromVersionNumber: number;
    toVersionNumber: number;
    authorisedOn: string | null;
    /** Which explicit relationship links it to this review. */
    linkedBy: ("review" | "decision")[];
  }[];
};

export async function getReviewStory(projectId: string, reviewId: string): Promise<ReviewStory | null> {
  const [ws, response] = await Promise.all([
    getAssuranceWorkspace(projectId, reviewId),
    getReviewResponse(projectId, reviewId),
  ]);
  if (!ws) return null;
  const governed = ws.review.status === "finalised";
  const rows = new Map(ws.rows.map((r) => [r.valueDriverId, r]));

  // Matters genuinely related to this review (see header). The legacy basis of getReviewResponse also lists matters
  // raised in earlier reviews; the story keeps only those raised or assessed in THIS review.
  const basis: ReviewStory["matterBasis"] =
    response.leakageBasis === "snapshot" ? "snapshot" : response.leakageBasis === "legacy" ? "legacy" : "working";
  const related = response.leakage.filter((e) =>
    basis === "snapshot"
      ? true
      : basis === "legacy"
        ? e.leakage.identifiedInReviewId === reviewId || e.thisReview !== null
        : e.leakage.status === "open" || e.thisReview !== null,
  );
  const driverNames = new Map(ws.rows.map((r) => [r.valueDriverId, r.name]));
  const matters: StoryMatter[] = related.map((e) => ({
    id: e.leakage.id,
    code: e.leakage.code,
    title: e.leakage.title,
    status: e.leakage.status,
    stage: e.leakage.stage,
    ownerName: e.ownerName,
    raisedInThisReview: e.leakage.identifiedInReviewId === reviewId,
    drivers: e.drivers.map((d) => {
      const r = rows.get(d.valueDriverId);
      return {
        code: d.code,
        name: driverNames.get(d.valueDriverId) ?? null,
        previousForecast: r?.previousForecast ?? null,
        currentForecast: r?.currentForecast ?? null,
        movement: r?.movement ?? null,
      };
    }),
    leakage: e.thisReview?.amounts ?? null,
  }));

  const scenarioIds = response.scenarios.map((s) => s.id);
  const points = scenarioIds.length
    ? await db()
        .select({ scenarioId: schema.valueTrajectoryPoint.scenarioId })
        .from(schema.valueTrajectoryPoint)
        .where(inArray(schema.valueTrajectoryPoint.scenarioId, scenarioIds))
    : [];
  const milestones = (id: string) => points.filter((p) => p.scenarioId === id).length;

  const rec = response.recommendation;
  const dec = response.decision;
  const fromV = alias(schema.valueCaseVersion, "from_v");
  const toV = alias(schema.valueCaseVersion, "to_v");
  const changes = await db()
    .select({
      change: schema.valueChange,
      fromNumber: fromV.versionNumber,
      toNumber: toV.versionNumber,
    })
    .from(schema.valueChange)
    .innerJoin(fromV, eq(fromV.id, schema.valueChange.fromVersionId))
    .innerJoin(toV, eq(toV.id, schema.valueChange.toVersionId))
    .where(
      and(
        eq(schema.valueChange.projectId, projectId),
        dec
          ? or(eq(schema.valueChange.assuranceReviewId, reviewId), eq(schema.valueChange.decisionId, dec.id))
          : eq(schema.valueChange.assuranceReviewId, reviewId),
      ),
    )
    .orderBy(schema.valueChange.code);

  const evidence = [
    ...(ws.triggerEvidence ? [{ code: ws.triggerEvidence.code, title: ws.triggerEvidence.title, trigger: true }] : []),
    ...ws.evidence
      .filter((e) => e.evidenceId !== ws.triggerEvidence?.id)
      .map((e) => ({ code: e.code, title: e.title, trigger: false })),
  ];

  return {
    governed,
    review: {
      sequence: ws.review.sequence,
      date: ws.review.reviewDate,
      trigger: ws.review.trigger,
      whatChanged: ws.review.whatChanged,
      whyItMatters: ws.review.whyItMatters,
      againstVersionNumber: ws.againstVersion.versionNumber,
    },
    position: {
      authorisedTotal: ws.totals.authorisedTotal,
      forecastTotal: ws.totals.forecastTotal,
      valueGap: ws.totals.valueGap,
      realisedTotal: ws.totals.realisedTotal,
      realisedComplete: realisedPositionComplete(ws.totals),
    },
    evidence,
    matterBasis: basis,
    matters,
    recommendation:
      rec && rec.scenario
        ? {
            issued: rec.issuedAt !== null,
            state: rec.state,
            label: rec.scenario.label,
            totalValue: rec.scenario.totalValue,
            milestones: milestones(rec.scenario.id),
          }
        : null,
    decision:
      dec && dec.scenario
        ? {
            label: dec.scenario.label,
            totalValue: dec.scenario.totalValue,
            milestones: milestones(dec.scenario.id),
            deciderName: dec.deciderName,
            decidedOn: dec.decidedOn,
            rationale: dec.rationale,
            economicConsequence: dec.economicConsequence,
            differenceFromRecommendation: dec.clientElectedDifference,
          }
        : null,
    valueChanges: changes.map(({ change, fromNumber, toNumber }) => ({
      id: change.id,
      code: change.code,
      status: change.status,
      fromVersionNumber: fromNumber,
      toVersionNumber: toNumber,
      authorisedOn: change.authorisedOn,
      linkedBy: [
        ...(change.assuranceReviewId === reviewId ? (["review"] as const) : []),
        ...(dec && change.decisionId === dec.id ? (["decision"] as const) : []),
      ],
    })),
  };
}
