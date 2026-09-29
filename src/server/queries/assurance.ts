import { and, asc, eq, isNotNull } from "drizzle-orm";

import {
  computeValuePosition,
  type DriverBasis,
  type PositionTotals,
  type PositionValues,
  type PriorPosition,
} from "@/domain/assurance";
import { deriveAssuranceRequirements, nextRequirement } from "@/domain/assurance-cadence";
import { db, schema } from "@/server/db/client";

import { loadVersionDrivers } from "./value-case";

type ReviewRow = typeof schema.assuranceReview.$inferSelect;
type PositionRow = typeof schema.valuePosition.$inferSelect;

const today = () => new Date().toISOString().slice(0, 10);

async function driverBasis(versionId: string): Promise<DriverBasis[]> {
  return (await loadVersionDrivers(versionId)).map((d) => ({
    valueDriverId: d.valueDriverId,
    code: d.code,
    name: d.name,
    authorisedValue: d.financialValue,
    qualificationStatus: d.qualificationStatus,
    evidenceStatus: d.evidenceStatus,
  }));
}

async function positionsOf(reviewId: string): Promise<PositionRow[]> {
  return db().select().from(schema.valuePosition).where(eq(schema.valuePosition.assuranceReviewId, reviewId));
}

const values = (rows: readonly PositionRow[]): PositionValues[] =>
  rows.map((p) => ({
    valueDriverId: p.valueDriverId,
    currentForecast: p.currentForecast,
    realisedValue: p.realisedValue,
    forecastNotAssessed: p.forecastNotAssessed,
  }));

async function listReviews(projectId: string): Promise<ReviewRow[]> {
  return db()
    .select()
    .from(schema.assuranceReview)
    .where(eq(schema.assuranceReview.projectId, projectId))
    .orderBy(asc(schema.assuranceReview.sequence));
}

async function priorFor(review: ReviewRow, all: readonly ReviewRow[]): Promise<PriorPosition> {
  const prev = review.previousReviewId ? all.find((r) => r.id === review.previousReviewId) : undefined;
  if (!prev) return { kind: "authorised" };
  return { kind: "review", reviewId: prev.id, sequence: prev.sequence, positions: values(await positionsOf(prev.id)) };
}

async function versionLabel(versionId: string) {
  const [v] = await db()
    .select({
      versionNumber: schema.valueCaseVersion.versionNumber,
      status: schema.valueCaseVersion.status,
      title: schema.valueCaseVersion.title,
    })
    .from(schema.valueCaseVersion)
    .where(eq(schema.valueCaseVersion.id, versionId));
  return v!;
}

// ---------------------------------------------------------------------------

export type ReviewListEntry = {
  review: ReviewRow;
  againstVersionNumber: number;
  totals: PositionTotals;
};

/** Every review with its derived totals, oldest first. */
export async function getAssuranceReviewList(projectId: string): Promise<ReviewListEntry[]> {
  const reviews = await listReviews(projectId);
  const bases = new Map<string, DriverBasis[]>();
  const out: ReviewListEntry[] = [];
  for (const review of reviews) {
    if (!bases.has(review.againstVersionId))
      bases.set(review.againstVersionId, await driverBasis(review.againstVersionId));
    const { totals } = computeValuePosition(
      bases.get(review.againstVersionId)!,
      values(await positionsOf(review.id)),
      await priorFor(review, reviews),
      { unattributedRealised: review.unattributedRealisedValue },
    );
    out.push({ review, againstVersionNumber: (await versionLabel(review.againstVersionId)).versionNumber, totals });
  }
  return out;
}

/** The Authorised Value Case in force and the latest finalised Value Position. */
export async function getValuePositionSummary(projectId: string) {
  const [authorised] = await db()
    .select()
    .from(schema.valueCaseVersion)
    .where(and(eq(schema.valueCaseVersion.projectId, projectId), eq(schema.valueCaseVersion.status, "authorised")));
  if (!authorised) return { authorised: null, authorisedTotal: null, latest: null, reviews: [] as ReviewListEntry[] };

  const basis = await driverBasis(authorised.id);
  const authorisedTotal = computeValuePosition(basis, [], { kind: "authorised" }).totals.authorisedTotal;
  const reviews = await getAssuranceReviewList(projectId);
  const latest = reviews.filter((r) => r.review.status === "finalised").at(-1) ?? null;
  return { authorised, authorisedTotal, latest, reviews };
}

export type ValuePositionSummary = Awaited<ReturnType<typeof getValuePositionSummary>>;

/** A review with its per-driver position, comparison to the prior position, and evidence. */
export async function getAssuranceWorkspace(projectId: string, reviewId: string) {
  const all = await listReviews(projectId);
  const review = all.find((r) => r.id === reviewId);
  if (!review) return null;

  const prior = await priorFor(review, all);
  const positions = await positionsOf(review.id);
  const { rows, totals } = computeValuePosition(await driverBasis(review.againstVersionId), values(positions), prior, {
    unattributedRealised: review.unattributedRealisedValue,
  });
  const byDriver = new Map(positions.map((p) => [p.valueDriverId, p]));
  const previous = prior.kind === "review" ? all.find((r) => r.id === prior.reviewId)! : null;
  const previousPositions = previous
    ? new Map((await positionsOf(previous.id)).map((p) => [p.valueDriverId, p]))
    : null;

  const evidence = await db()
    .select({
      linkId: schema.evidenceLink.id,
      evidenceId: schema.evidence.id,
      code: schema.evidence.code,
      title: schema.evidence.title,
      isMaterialChange: schema.evidence.isMaterialChange,
      relevanceNote: schema.evidenceLink.relevanceNote,
    })
    .from(schema.evidenceLink)
    .innerJoin(schema.evidence, eq(schema.evidence.id, schema.evidenceLink.evidenceId))
    .where(eq(schema.evidenceLink.assuranceReviewId, review.id))
    .orderBy(asc(schema.evidence.code));

  const [triggerEvidence] = review.triggerEvidenceId
    ? await db()
        .select({ id: schema.evidence.id, code: schema.evidence.code, title: schema.evidence.title })
        .from(schema.evidence)
        .where(eq(schema.evidence.id, review.triggerEvidenceId))
    : [];

  const [createdBy] = await db()
    .select({ name: schema.appUser.displayName })
    .from(schema.appUser)
    .where(eq(schema.appUser.id, review.createdBy));
  const [finalisedBy] = review.finalisedBy
    ? await db()
        .select({ name: schema.appUser.displayName, email: schema.appUser.email })
        .from(schema.appUser)
        .where(eq(schema.appUser.id, review.finalisedBy))
    : [];

  return {
    review,
    againstVersion: await versionLabel(review.againstVersionId),
    previous,
    rows: rows.map((r) => ({
      ...r,
      forecastRationale: byDriver.get(r.valueDriverId)?.forecastRationale ?? null,
      realisedValueRationale: byDriver.get(r.valueDriverId)?.realisedValueRationale ?? null,
      previousRealised: previousPositions?.get(r.valueDriverId)?.realisedValue ?? null,
    })),
    totals,
    missingPositions: rows.filter((r) => !r.hasPosition).length,
    evidence,
    triggerEvidence: triggerEvidence ?? null,
    createdByName: createdBy?.name ?? null,
    finalisedBy: finalisedBy ?? null,
  };
}

export type AssuranceWorkspace = NonNullable<Awaited<ReturnType<typeof getAssuranceWorkspace>>>;

/** Per-driver comparison of a review with its prior position (previous review, or Authorised Value). */
export async function getReviewComparison(projectId: string, reviewId: string) {
  const ws = await getAssuranceWorkspace(projectId, reviewId);
  if (!ws) return null;
  return {
    comparedWith: ws.previous
      ? { kind: "review" as const, sequence: ws.previous.sequence }
      : { kind: "authorised" as const },
    rows: ws.rows.map((r) => ({
      code: r.code,
      name: r.name,
      financial: r.financial,
      authorisedValue: r.authorisedValue,
      previousForecast: r.previousForecast,
      currentForecast: r.currentForecast,
      movement: r.movement,
      valueGap: r.valueGap,
    })),
    totals: ws.totals,
  };
}

/** Mandatory-cadence status derived from key dates, reviews and material-change evidence. */
export async function getNextAssuranceRequirement(projectId: string) {
  const [authorised] = await db()
    .select({ recordedAt: schema.valueCaseVersion.authorisationRecordedAt })
    .from(schema.valueCaseVersion)
    .where(and(eq(schema.valueCaseVersion.projectId, projectId), eq(schema.valueCaseVersion.status, "authorised")));
  const [keyDates, reviews, material, links] = await Promise.all([
    db().select().from(schema.keyDate).where(eq(schema.keyDate.projectId, projectId)),
    listReviews(projectId),
    db()
      .select({
        id: schema.evidence.id,
        code: schema.evidence.code,
        title: schema.evidence.title,
        createdAt: schema.evidence.createdAt,
      })
      .from(schema.evidence)
      .where(and(eq(schema.evidence.projectId, projectId), eq(schema.evidence.isMaterialChange, true))),
    db()
      .select({ evidenceId: schema.evidenceLink.evidenceId, reviewId: schema.evidenceLink.assuranceReviewId })
      .from(schema.evidenceLink)
      .where(and(eq(schema.evidenceLink.projectId, projectId), isNotNull(schema.evidenceLink.assuranceReviewId))),
  ]);

  const requirements = deriveAssuranceRequirements({
    today: today(),
    authorised: Boolean(authorised),
    authorisationRecordedAt: authorised?.recordedAt ?? null,
    keyDates,
    reviews: reviews.map((r) => ({
      id: r.id,
      sequence: r.sequence,
      trigger: r.trigger,
      status: r.status,
      reviewDate: r.reviewDate,
      finalisedAt: r.finalisedAt,
      triggerEvidenceId: r.triggerEvidenceId,
    })),
    materialEvidence: material.map((e) => ({
      ...e,
      reviewIds: [
        ...reviews.filter((r) => r.triggerEvidenceId === e.id).map((r) => r.id),
        ...links.filter((l) => l.evidenceId === e.id).map((l) => l.reviewId!),
      ],
    })),
  });
  return { requirements, next: nextRequirement(requirements) };
}

/** Evidence choices for a review: material-change items first. */
export async function listReviewEvidenceOptions(projectId: string) {
  return db()
    .select({
      id: schema.evidence.id,
      code: schema.evidence.code,
      title: schema.evidence.title,
      isMaterialChange: schema.evidence.isMaterialChange,
    })
    .from(schema.evidence)
    .where(eq(schema.evidence.projectId, projectId))
    .orderBy(asc(schema.evidence.code));
}
