import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { money, toDbMoney } from "@/domain/money";
import {
  clientElectedDifference,
  compareScenarios,
  leakageAmounts,
  projectedAuthorisedValue,
  summariseLeakage,
  type LeakageAmounts,
} from "@/domain/response";
import { db, schema } from "@/server/db/client";

import { loadVersionDrivers } from "./value-case";

// ---------------------------------------------------------------------------
// Value Leakage

type AssessmentRow = typeof schema.leakageAssessment.$inferSelect & { reviewSequence: number; reviewStatus: string };

export type LeakageEntry = {
  leakage: typeof schema.valueLeakage.$inferSelect;
  ownerName: string | null;
  identifiedInSequence: number;
  drivers: { valueDriverId: string; code: string }[];
  assessments: AssessmentRow[];
  /** Latest assessment from a finalised review (the authoritative current size). */
  latestFinalised: (AssessmentRow & { amounts: LeakageAmounts }) | null;
};

export async function getLeakageRegister(projectId: string): Promise<LeakageEntry[]> {
  const identifiedIn = alias(schema.assuranceReview, "identified_in");
  const items = await db()
    .select({
      leakage: schema.valueLeakage,
      ownerName: schema.person.name,
      identifiedInSequence: identifiedIn.sequence,
    })
    .from(schema.valueLeakage)
    .innerJoin(identifiedIn, eq(identifiedIn.id, schema.valueLeakage.identifiedInReviewId))
    .leftJoin(schema.person, eq(schema.person.id, schema.valueLeakage.responseOwnerPersonId))
    .where(eq(schema.valueLeakage.projectId, projectId))
    .orderBy(asc(schema.valueLeakage.code));
  if (items.length === 0) return [];
  const ids = items.map((i) => i.leakage.id);

  const drivers = await db()
    .select({
      valueLeakageId: schema.valueLeakageDriver.valueLeakageId,
      valueDriverId: schema.valueDriver.id,
      code: schema.valueDriver.code,
    })
    .from(schema.valueLeakageDriver)
    .innerJoin(schema.valueDriver, eq(schema.valueDriver.id, schema.valueLeakageDriver.valueDriverId))
    .where(inArray(schema.valueLeakageDriver.valueLeakageId, ids))
    .orderBy(asc(schema.valueDriver.code));

  const assessments = await db()
    .select({
      a: schema.leakageAssessment,
      reviewSequence: schema.assuranceReview.sequence,
      reviewStatus: schema.assuranceReview.status,
    })
    .from(schema.leakageAssessment)
    .innerJoin(schema.assuranceReview, eq(schema.assuranceReview.id, schema.leakageAssessment.assuranceReviewId))
    .where(inArray(schema.leakageAssessment.valueLeakageId, ids))
    .orderBy(asc(schema.assuranceReview.sequence));

  return items.map(({ leakage, ownerName, identifiedInSequence }) => {
    const mine = assessments
      .filter((x) => x.a.valueLeakageId === leakage.id)
      .map((x) => ({ ...x.a, reviewSequence: x.reviewSequence, reviewStatus: x.reviewStatus }));
    const latest = mine.filter((x) => x.reviewStatus === "finalised").at(-1) ?? null;
    return {
      leakage,
      ownerName,
      identifiedInSequence,
      drivers: drivers.filter((d) => d.valueLeakageId === leakage.id),
      assessments: mine,
      latestFinalised: latest
        ? { ...latest, amounts: leakageAmounts(latest.totalAmount, latest.unrecoverableAmount) }
        : null,
    };
  });
}

// ---------------------------------------------------------------------------
// A review's management response

export async function getReviewResponse(projectId: string, reviewId: string) {
  const register = await getLeakageRegister(projectId);
  const leakage = register.map((entry) => {
    const here = entry.assessments.find((a) => a.assuranceReviewId === reviewId) ?? null;
    return {
      ...entry,
      thisReview: here ? { ...here, amounts: leakageAmounts(here.totalAmount, here.unrecoverableAmount) } : null,
    };
  });
  const leakageSummary = summariseLeakage(
    leakage.filter((l) => l.leakage.status === "open").map((l) => ({ amounts: l.thisReview?.amounts ?? null })),
  );

  const scenarios = compareScenarios(
    await db()
      .select()
      .from(schema.scenario)
      .where(eq(schema.scenario.assuranceReviewId, reviewId))
      .orderBy(asc(schema.scenario.sortOrder), asc(schema.scenario.createdAt)),
  );

  const issuer = alias(schema.appUser, "issuer");
  const [rec] = await db()
    .select({ recommendation: schema.recommendation, issuerName: issuer.displayName })
    .from(schema.recommendation)
    .leftJoin(issuer, eq(issuer.id, schema.recommendation.issuedBy))
    .where(eq(schema.recommendation.assuranceReviewId, reviewId));
  const recommendedScenario = rec ? (scenarios.find((s) => s.id === rec.recommendation.scenarioId) ?? null) : null;

  const recorder = alias(schema.appUser, "recorder");
  const [dec] = await db()
    .select({
      decision: schema.decision,
      deciderName: schema.person.name,
      recorderName: recorder.displayName,
      evidenceCode: schema.evidence.code,
      evidenceTitle: schema.evidence.title,
    })
    .from(schema.decision)
    .innerJoin(schema.person, eq(schema.person.id, schema.decision.decidedByPersonId))
    .innerJoin(recorder, eq(recorder.id, schema.decision.recordedBy))
    .leftJoin(schema.evidence, eq(schema.evidence.id, schema.decision.supportingEvidenceId))
    .where(eq(schema.decision.assuranceReviewId, reviewId));
  const selectedScenario = dec ? (scenarios.find((s) => s.id === dec.decision.selectedScenarioId) ?? null) : null;

  const changes = await db()
    .select({ id: schema.valueChange.id, code: schema.valueChange.code, status: schema.valueChange.status })
    .from(schema.valueChange)
    .where(and(eq(schema.valueChange.projectId, projectId), eq(schema.valueChange.assuranceReviewId, reviewId)));

  return {
    leakage,
    leakageSummary,
    scenarios,
    recommendation: rec ? { ...rec.recommendation, issuerName: rec.issuerName, scenario: recommendedScenario } : null,
    decision: dec
      ? {
          ...dec.decision,
          deciderName: dec.deciderName,
          recorderName: dec.recorderName,
          evidenceCode: dec.evidenceCode,
          evidenceTitle: dec.evidenceTitle,
          scenario: selectedScenario,
          clientElectedDifference:
            selectedScenario && recommendedScenario
              ? clientElectedDifference(selectedScenario.totalValue, recommendedScenario.totalValue)
              : null,
        }
      : null,
    changes,
  };
}

export type ReviewResponse = Awaited<ReturnType<typeof getReviewResponse>>;

// ---------------------------------------------------------------------------
// Value Changes

type VersionRow = typeof schema.valueCaseVersion.$inferSelect;

async function versionTotal(versionId: string) {
  const drivers = await loadVersionDrivers(versionId);
  const valued = drivers.flatMap((d) => (d.financialValue === null ? [] : [d.financialValue]));
  return { drivers, total: toDbMoney(valued.reduce((acc, v) => acc.plus(money(v)), money("0"))) };
}

export async function listValueChanges(projectId: string) {
  const fromV = alias(schema.valueCaseVersion, "from_v");
  const toV = alias(schema.valueCaseVersion, "to_v");
  const rows = await db()
    .select({
      change: schema.valueChange,
      fromNumber: fromV.versionNumber,
      toNumber: toV.versionNumber,
      toStatus: toV.status,
    })
    .from(schema.valueChange)
    .innerJoin(fromV, eq(fromV.id, schema.valueChange.fromVersionId))
    .innerJoin(toV, eq(toV.id, schema.valueChange.toVersionId))
    .where(eq(schema.valueChange.projectId, projectId))
    .orderBy(desc(schema.valueChange.createdAt));
  return Promise.all(
    rows.map(async (r) => {
      const [from, to] = await Promise.all([versionTotal(r.change.fromVersionId), versionTotal(r.change.toVersionId)]);
      return {
        ...r,
        fromTotal: from.total,
        toTotal: to.total,
        actualChange: toDbMoney(money(to.total).minus(money(from.total))),
      };
    }),
  );
}

export async function getValueChangeDetail(projectId: string, changeId: string) {
  const [row] = await db()
    .select()
    .from(schema.valueChange)
    .where(and(eq(schema.valueChange.projectId, projectId), eq(schema.valueChange.id, changeId)));
  if (!row) return null;

  const versions = await db()
    .select()
    .from(schema.valueCaseVersion)
    .where(inArray(schema.valueCaseVersion.id, [row.fromVersionId, row.toVersionId]));
  const fromVersion = versions.find((v) => v.id === row.fromVersionId)! as VersionRow;
  const toVersion = versions.find((v) => v.id === row.toVersionId)! as VersionRow;
  const [from, to] = await Promise.all([versionTotal(fromVersion.id), versionTotal(toVersion.id)]);
  const actualChange = toDbMoney(money(to.total).minus(money(from.total)));

  const ids = [...new Set([...from.drivers, ...to.drivers].map((d) => d.valueDriverId))];
  const driverRows = ids.map((id) => {
    const a = from.drivers.find((d) => d.valueDriverId === id) ?? null;
    const b = to.drivers.find((d) => d.valueDriverId === id) ?? null;
    const either = (b ?? a)!;
    const changed =
      !a || !b || a.financialValue !== b.financialValue || a.name !== b.name || a.targetValue !== b.targetValue;
    return {
      valueDriverId: id,
      code: either.code,
      name: either.name,
      fromValue: a?.financialValue ?? null,
      toValue: b?.financialValue ?? null,
      inFrom: Boolean(a),
      inTo: Boolean(b),
      change:
        a?.financialValue != null && b?.financialValue != null
          ? toDbMoney(money(b.financialValue).minus(money(a.financialValue)))
          : null,
      changed,
    };
  });

  const [valueCase] = await db().select().from(schema.valueCase).where(eq(schema.valueCase.id, row.valueCaseId));
  const [vco] = valueCase?.vcoPersonId
    ? await db().select().from(schema.person).where(eq(schema.person.id, valueCase.vcoPersonId))
    : [];
  const authoriser = row.authorisedByPersonId
    ? (await db().select().from(schema.person).where(eq(schema.person.id, row.authorisedByPersonId)))[0]
    : undefined;
  const [evidence] = row.authorisationEvidenceId
    ? await db()
        .select({ id: schema.evidence.id, code: schema.evidence.code, title: schema.evidence.title })
        .from(schema.evidence)
        .where(eq(schema.evidence.id, row.authorisationEvidenceId))
    : [];
  const [review] = row.assuranceReviewId
    ? await db()
        .select({ id: schema.assuranceReview.id, sequence: schema.assuranceReview.sequence })
        .from(schema.assuranceReview)
        .where(eq(schema.assuranceReview.id, row.assuranceReviewId))
    : [];
  const users = await db()
    .select({ id: schema.appUser.id, name: schema.appUser.displayName, email: schema.appUser.email })
    .from(schema.appUser)
    .where(
      inArray(
        schema.appUser.id,
        [row.createdBy, row.proposedBy, row.authorisationRecordedBy, row.closedBy].filter((x): x is string => !!x),
      ),
    );
  const user = (id: string | null) => users.find((u) => u.id === id) ?? null;

  return {
    change: row,
    fromVersion,
    toVersion,
    fromTotal: from.total,
    toTotal: to.total,
    actualChange,
    projectedFromStated: row.statedChangeAmount ? projectedAuthorisedValue(from.total, row.statedChangeAmount) : null,
    reconciled: row.statedChangeAmount === null ? null : money(actualChange).equals(money(row.statedChangeAmount)),
    toDrivers: to.drivers,
    driverRows,
    vco: vco ?? null,
    authoriser: authoriser ?? null,
    evidence: evidence ?? null,
    review: review ?? null,
    createdBy: user(row.createdBy),
    proposedBy: user(row.proposedBy),
    recordedBy: user(row.authorisationRecordedBy),
    closedBy: user(row.closedBy),
  };
}

export type ValueChangeDetail = NonNullable<Awaited<ReturnType<typeof getValueChangeDetail>>>;

export function nextChangeCode(codes: readonly string[]): string {
  const max = codes.reduce((m, c) => Math.max(m, Number(/^VC-(\d+)$/.exec(c)?.[1] ?? 0)), 0);
  return `VC-${String(max + 1).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Overview

/** Open leakage (latest finalised assessment), latest issued recommendation and latest decision. */
export async function getResponseSummary(projectId: string) {
  const register = await getLeakageRegister(projectId);
  const open = register.filter((r) => r.leakage.status === "open");
  const leakage = summariseLeakage(open.map((r) => ({ amounts: r.latestFinalised?.amounts ?? null })));

  const [latestRec] = await db()
    .select({ review: schema.assuranceReview, rec: schema.recommendation, scenario: schema.scenario })
    .from(schema.recommendation)
    .innerJoin(schema.assuranceReview, eq(schema.assuranceReview.id, schema.recommendation.assuranceReviewId))
    .innerJoin(schema.scenario, eq(schema.scenario.id, schema.recommendation.scenarioId))
    .where(and(eq(schema.recommendation.projectId, projectId), isNotNull(schema.recommendation.issuedAt)))
    .orderBy(desc(schema.assuranceReview.sequence))
    .limit(1);

  const [latestDecision] = await db()
    .select({
      review: schema.assuranceReview,
      decision: schema.decision,
      scenario: schema.scenario,
      decider: schema.person.name,
    })
    .from(schema.decision)
    .innerJoin(schema.assuranceReview, eq(schema.assuranceReview.id, schema.decision.assuranceReviewId))
    .innerJoin(schema.scenario, eq(schema.scenario.id, schema.decision.selectedScenarioId))
    .innerJoin(schema.person, eq(schema.person.id, schema.decision.decidedByPersonId))
    .where(eq(schema.decision.projectId, projectId))
    .orderBy(desc(schema.assuranceReview.sequence))
    .limit(1);

  const [openChange] = await db()
    .select({ id: schema.valueChange.id, code: schema.valueChange.code, status: schema.valueChange.status })
    .from(schema.valueChange)
    .where(and(eq(schema.valueChange.projectId, projectId), inArray(schema.valueChange.status, ["draft", "proposed"])));

  let decisionDifference: string | null = null;
  if (latestDecision) {
    const [rec] = await db()
      .select({ total: schema.scenario.totalValue })
      .from(schema.recommendation)
      .innerJoin(schema.scenario, eq(schema.scenario.id, schema.recommendation.scenarioId))
      .where(eq(schema.recommendation.assuranceReviewId, latestDecision.review.id));
    if (rec) decisionDifference = clientElectedDifference(latestDecision.scenario.totalValue, rec.total);
  }

  return {
    leakage,
    openLeakageCount: open.length,
    recommendation: latestRec ?? null,
    decision: latestDecision ? { ...latestDecision, difference: decisionDifference } : null,
    openChange: openChange ?? null,
  };
}
