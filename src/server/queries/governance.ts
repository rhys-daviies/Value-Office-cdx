import { desc, eq, inArray } from "drizzle-orm";

import { recommendationState, type RecommendationState } from "@/domain/recommendation";
import type { ValueChangeDetermination, ValueChangeStatus } from "@/domain/statuses";
import {
  type GovernanceFacts,
  type NextAction,
  postAuthorisationNextAction,
  valueCaseImpactStage,
  type ValueCaseImpactStage,
} from "@/domain/value-case-impact";
import { db, schema } from "@/server/db/client";

import { getNextAssuranceRequirement } from "./assurance";

// Phase 4D.10H: what is happening in governance after authorisation — the draft review and its recommendation, the
// most recent management decision and its Value Case impact, any open Value Change — and the one next governed
// action. Stored facts only; nothing is inferred from dates or amounts.

export type GovernanceState = {
  draftReview: { id: string; sequence: number; recommendation: RecommendationState | null } | null;
  awaitingDecision: { reviewId: string; sequence: number } | null;
  latestDecision: {
    reviewId: string;
    sequence: number;
    stage: ValueCaseImpactStage;
    determination: ValueChangeDetermination | null;
    change: { id: string; code: string; status: ValueChangeStatus } | null;
  } | null;
  openChange: { id: string; code: string; status: "draft" | "proposed" } | null;
  nextAction: NextAction | null;
};

export async function getGovernanceState(projectId: string): Promise<GovernanceState> {
  const cadence = await getNextAssuranceRequirement(projectId);
  const reviews = await db()
    .select({
      id: schema.assuranceReview.id,
      sequence: schema.assuranceReview.sequence,
      status: schema.assuranceReview.status,
    })
    .from(schema.assuranceReview)
    .where(eq(schema.assuranceReview.projectId, projectId))
    .orderBy(desc(schema.assuranceReview.sequence));
  const ids = reviews.map((r) => r.id);
  const [recs, decisions, changes] = ids.length
    ? await Promise.all([
        db().select().from(schema.recommendation).where(inArray(schema.recommendation.assuranceReviewId, ids)),
        db().select().from(schema.decision).where(inArray(schema.decision.assuranceReviewId, ids)),
        db()
          .select()
          .from(schema.valueChange)
          .where(eq(schema.valueChange.projectId, projectId))
          .orderBy(desc(schema.valueChange.createdAt)),
      ])
    : [[], [], await db().select().from(schema.valueChange).where(eq(schema.valueChange.projectId, projectId))];
  const determinations = decisions.length
    ? await db()
        .select()
        .from(schema.valueChangeDetermination)
        .where(
          inArray(
            schema.valueChangeDetermination.decisionId,
            decisions.map((d) => d.id),
          ),
        )
    : [];

  const stateOf = (reviewId: string) => {
    const r = recs.find((x) => x.assuranceReviewId === reviewId);
    return r ? recommendationState(r) : null;
  };
  const draft = reviews.find((r) => r.status === "draft");
  const awaiting = reviews.find(
    (r) => stateOf(r.id) === "issued" && !decisions.some((d) => d.assuranceReviewId === r.id),
  );
  const decided = reviews.find((r) => decisions.some((d) => d.assuranceReviewId === r.id));
  let latestDecision: GovernanceState["latestDecision"] = null;
  if (decided) {
    const d = decisions.find((x) => x.assuranceReviewId === decided.id)!;
    const det = determinations.find((x) => x.decisionId === d.id) ?? null;
    const change = changes.find((c) => c.decisionId === d.id) ?? null;
    latestDecision = {
      reviewId: decided.id,
      sequence: decided.sequence,
      determination: det?.determination ?? null,
      change: change ? { id: change.id, code: change.code, status: change.status } : null,
      stage: valueCaseImpactStage({
        decided: true,
        determination: det?.determination ?? null,
        change: change ? { status: change.status } : null,
      }),
    };
  }
  const open = changes.find((c) => c.status === "draft" || c.status === "proposed");
  const openChange = open ? { id: open.id, code: open.code, status: open.status as "draft" | "proposed" } : null;
  const at = (stage: ValueCaseImpactStage) =>
    latestDecision?.stage === stage ? { reviewId: latestDecision.reviewId, sequence: latestDecision.sequence } : null;
  const facts: GovernanceFacts = {
    openChange,
    awaitingDetermination: at("awaiting_determination"),
    proposedNotPrepared: at("proposed_not_prepared"),
    draftReview: draft ? { id: draft.id, sequence: draft.sequence, recommendation: stateOf(draft.id) } : null,
    awaitingDecision: awaiting ? { reviewId: awaiting.id, sequence: awaiting.sequence } : null,
    dueRequirement: cadence.next?.status === "due" ? { label: cadence.next.label } : null,
  };
  return {
    draftReview: facts.draftReview,
    awaitingDecision: facts.awaitingDecision,
    latestDecision,
    openChange,
    nextAction: postAuthorisationNextAction(facts, `/projects/${projectId}`),
  };
}
