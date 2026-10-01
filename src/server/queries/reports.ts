import { createHash } from "node:crypto";

import { and, asc, desc, eq } from "drizzle-orm";

import {
  canonicalJson,
  issuability,
  REPORT_MODEL_VERSION,
  REPORT_TITLES,
  type AssuranceEvolution,
  type AssuranceNextAction,
  type AssuranceOutcomes,
  type AssuranceReport,
  type AssuranceValueChange,
  type InformationRequestReport,
  type ReportHeader,
  type ReportModel,
  type RequalificationReport,
  type ValueChangeNotice,
} from "@/domain/reports";
import { moneyChange } from "@/domain/value-case";
import { EVIDENCE_STATUSES, INFORMATION_REQUEST_ITEM_STATUSES, type ReportType } from "@/domain/statuses";
import { db, schema } from "@/server/db/client";

import { getAssuranceWorkspace } from "./assurance";
import { getValueCaseEvolution } from "./evolution";
import { getAlternativeValueOutcomes, hasDecisionContext } from "./outcomes";
import { getInformationRequestWorkspace } from "./information-request";
import { getProjectHeader, type ProjectHeader } from "./projects";
import { getReviewResponse, getValueChangeDetail, listValueChanges } from "./response";
import { getRequalificationWorkspace, getVersionDetail } from "./value-case";

// Report read models (Phase 4A). Each builder projects existing authoritative read
// models into a client-facing report model. No figure is recalculated here: totals,
// gaps, movements, leakage splits, scenario differences, the client-elected
// difference and Value Change reconciliation all come from the read models above.

const isoDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

function header<T extends ReportType>(
  type: T,
  project: ProjectHeader,
  subjectLabel: string,
  subjectStatus: string,
  asAt: string | null,
): ReportHeader & { type: T } {
  return {
    modelVersion: REPORT_MODEL_VERSION,
    type,
    title: REPORT_TITLES[type],
    subjectLabel,
    subjectStatus,
    clientName: project.clientName,
    projectName: project.project.name,
    projectCode: project.project.code,
    currency: project.project.currency,
    asAt,
    valueBasis: {
      description: project.project.valueBasisDescription,
      periodStart: project.project.valuePeriodStart,
      periodEnd: project.project.valuePeriodEnd,
    },
  };
}

export type BuiltReport<M extends ReportModel = ReportModel> = {
  model: M;
  issuable: { ok: boolean; reason: string | null };
};

// ---------------------------------------------------------------------------
// Information Request

export async function buildInformationRequestReport(
  projectId: string,
  requestId: string,
): Promise<BuiltReport<InformationRequestReport> | null> {
  const project = await getProjectHeader(projectId);
  if (!project) return null;
  const ws = await getInformationRequestWorkspace(projectId);
  const entry = ws.requests.find((r) => r.request.id === requestId);
  if (!entry) return null;
  const { request, items } = entry;
  const driverName = new Map(ws.drivers.map((d) => [d.code, d.name]));

  const summary = Object.fromEntries(
    INFORMATION_REQUEST_ITEM_STATUSES.map((s) => [s, items.filter((i) => i.item.status === s).length]),
  ) as InformationRequestReport["summary"];
  summary.total = items.length;

  return {
    model: {
      header: header("information_request", project, `Request ${request.reference}`, request.status, request.issuedOn),
      request: {
        reference: request.reference,
        title: request.title,
        status: request.status,
        issuedOn: request.issuedOn,
        closedOn: request.closedOn,
      },
      summary,
      items: items.map(({ item, requestedFromName, driverCode }) => ({
        sequence: item.sequence,
        description: item.description,
        requestedFrom: requestedFromName,
        dueOn: item.dueOn,
        status: item.status,
        driver: driverCode ? { code: driverCode, name: driverName.get(driverCode) ?? driverCode } : null,
        notes: item.notes,
      })),
    },
    issuable: issuability("information_request", request.status),
  };
}

// ---------------------------------------------------------------------------
// Re-Qualification

/** The authorised version in force, when it is not `versionId`. */
async function versionInForceIfNot(projectId: string, versionId: string) {
  const [inForce] = await db()
    .select()
    .from(schema.valueCaseVersion)
    .where(and(eq(schema.valueCaseVersion.projectId, projectId), eq(schema.valueCaseVersion.status, "authorised")));
  if (!inForce || inForce.id === versionId) return null;
  const detail = await getVersionDetail(projectId, inForce.versionNumber);
  return { versionNumber: inForce.versionNumber, title: inForce.title, total: detail!.summary.financialTotal };
}

export async function buildRequalificationReport(
  projectId: string,
  versionId: string,
): Promise<BuiltReport<RequalificationReport> | null> {
  const project = await getProjectHeader(projectId);
  if (!project) return null;
  const ws = await getRequalificationWorkspace(projectId);
  const version = ws.requalifiedVersion;
  if (!version || version.id !== versionId) return null;
  const detail = await getVersionDetail(projectId, version.versionNumber);
  if (!detail) return null;

  const inheritedById = new Map(ws.inheritedDrivers.map((d) => [d.valueDriverId, d]));
  const inV1 = new Set(ws.requalifiedDrivers.map((d) => d.valueDriverId));
  const summary = ws.requalifiedSummary;
  const assumptions = detail.drivers.flatMap((d) => d.assumptions);
  const total = summary.financialTotal;
  const ref = (e: { code: string; title: string }) => ({ code: e.code, title: e.title });

  return {
    model: {
      header: header(
        "requalification",
        project,
        `Value Case V${version.versionNumber}`,
        version.status,
        version.authorisedOn,
      ),
      inherited: ws.inheritedVersion
        ? { title: ws.inheritedVersion.title, total: ws.inheritedTotal, driverCount: ws.inheritedDrivers.length }
        : null,
      authorised: {
        versionNumber: version.versionNumber,
        title: version.title,
        summary: version.summary,
        status: version.status,
        total,
        authorisedOn: version.authorisedOn,
        authorisedBy: detail.authoriserName,
        evidence: detail.evidenceCode ? { code: detail.evidenceCode, title: detail.evidenceTitle! } : null,
        note: version.authorisationNote,
        supersededOn: isoDate(version.supersededAt),
      },
      movement: ws.movement,
      currentVersion: await versionInForceIfNot(projectId, version.id),
      drivers: detail.drivers.map((d) => {
        const inherited = inheritedById.get(d.valueDriverId);
        return {
          code: d.code,
          name: d.name,
          description: d.description,
          metric: d.metric,
          metricUnit: d.metricUnit,
          baselineValue: d.baselineValue,
          targetValue: d.targetValue,
          financialValue: d.financialValue,
          timing: d.timingDescription,
          avoName: d.avoName,
          qualificationStatus: d.qualificationStatus,
          evidenceStatus: d.evidenceStatus,
          economicRationale: d.calculationRationale,
          inherited: {
            present: Boolean(inherited),
            financialValue: inherited?.financialValue ?? null,
            // Same per-driver difference as the Re-Qualification workspace.
            change: moneyChange(inherited?.financialValue ?? null, d.financialValue),
          },
          assumptions: d.assumptions.map((a) => ({
            statement: a.statement,
            evidenceStatus: a.evidenceStatus,
            notes: a.notes,
            evidence: a.evidence.map(ref),
          })),
          evidence: d.evidence.map(ref),
        };
      }),
      notCarriedForward: ws.inheritedDrivers
        .filter((d) => !inV1.has(d.valueDriverId))
        .map((d) => ({ code: d.code, name: d.name, financialValue: d.financialValue })),
      counts: {
        driverCount: summary.driverCount,
        financialCount: summary.financialCount,
        nonFinancialCount: summary.nonFinancialCount,
        qualification: summary.qualification,
        evidence: summary.evidence,
        withoutEvidenceLinks: summary.withoutEvidenceLinks,
        withoutAvo: summary.withoutAvo,
        assumptionCount: assumptions.length,
        assumptionEvidence: Object.fromEntries(
          EVIDENCE_STATUSES.map((s) => [s, assumptions.filter((a) => a.evidenceStatus === s).length]),
        ) as RequalificationReport["counts"]["assumptionEvidence"],
      },
    },
    issuable: issuability("requalification", version.status, { versionNumber: version.versionNumber }),
  };
}

// ---------------------------------------------------------------------------
// Value Assurance

/**
 * Report snapshot of Value Case Evolution (Phase 4D.7): the application's governed history, copied as is
 * and cut after this review, so the report shows the history as at the review it describes.
 */
async function assuranceEvolution(projectId: string, sequence: number): Promise<AssuranceEvolution> {
  const e = await getValueCaseEvolution(projectId);
  const cut = e.events.findIndex((x) => x.kind === "review" && x.position.sequence === sequence);
  const events = cut === -1 ? e.events : e.events.slice(0, cut + 1);
  return {
    originalBusinessCase: e.originalBusinessCase
      ? { title: e.originalBusinessCase.title, value: e.originalBusinessCase.value }
      : null,
    events: events.map((x) => {
      if (x.kind === "original")
        return { kind: "original", key: x.key, title: x.original.title, value: x.original.value };
      if (x.kind === "authorisation") {
        const a = x.authorisation;
        return {
          kind: "authorisation",
          key: x.key,
          versionNumber: a.versionNumber,
          authorisedValue: a.authorisedValue,
          authorisedOn: a.date,
          vcoName: a.vcoName,
          valueChangeCode: a.valueChangeCode,
        };
      }
      const p = x.position;
      return {
        kind: "review",
        key: x.key,
        sequence: p.sequence,
        reviewDate: p.date,
        againstVersionNumber: p.againstVersionNumber,
        currentForecast: p.currentForecast,
        realisedValue: p.realisedValue,
        valueGap: p.valueGap,
        inForceValue: x.inForceValue,
        isThisReview: p.sequence === sequence,
      };
    }),
  };
}

/** Report snapshot of Alternative Value Outcomes (Phase 4D.7): copied from the application read model. */
async function assuranceOutcomes(projectId: string, reviewId: string): Promise<AssuranceOutcomes | null> {
  const o = await getAlternativeValueOutcomes(projectId, reviewId);
  if (!o || !hasDecisionContext(o)) return null;
  return {
    againstVersionNumber: o.review.againstVersionNumber,
    authorisedValue: o.authorisedValue,
    currentFormalForecast: o.currentFormalForecast,
    outcomes: o.outcomes.map((x) => ({
      label: x.label,
      kind: x.kind,
      totalValue: x.totalValue,
      narrative: x.narrative,
      recommended: x.recommended,
      selected: x.selected,
    })),
    differenceFromRecommendation: o.differenceFromRecommendation,
  };
}

export async function buildAssuranceReport(
  projectId: string,
  reviewId: string,
): Promise<BuiltReport<AssuranceReport> | null> {
  const project = await getProjectHeader(projectId);
  if (!project) return null;
  const ws = await getAssuranceWorkspace(projectId, reviewId);
  if (!ws) return null;
  const response = await getReviewResponse(projectId, reviewId);
  const { review, totals } = ws;
  const driverName = new Map(ws.rows.map((r) => [r.code, r.name]));

  // The review's own view of its matters (its snapshot once finalised) and formal amounts only;
  // working assessments never reach a report.
  const leakage = response.leakage;
  const leakageSummary = response.leakageSummary;

  const changes: AssuranceValueChange[] = [];
  for (const c of await listValueChanges(projectId)) {
    if (c.change.assuranceReviewId !== review.id || c.change.status === "draft") continue;
    const d = (await getValueChangeDetail(projectId, c.change.id))!;
    changes.push({
      code: d.change.code,
      status: d.change.status,
      fromVersion: d.fromVersion.versionNumber,
      toVersion: d.toVersion.versionNumber,
      fromTotal: d.fromTotal,
      toTotal: d.toTotal,
      statedChange: d.change.statedChangeAmount,
      projectedValue: d.projectedFromStated,
      reconciled: d.reconciled,
      reason: d.change.reason,
    });
  }
  changes.sort((a, b) => a.code.localeCompare(b.code));

  const nextActions: AssuranceNextAction[] = [
    ...leakage
      .filter((l) => l.leakage.status === "open")
      .map((l) => ({
        kind: "leakage_response" as const,
        code: l.leakage.code,
        title: l.leakage.title,
        owner: l.ownerName,
        requiredDecisionDate: l.leakage.requiredDecisionDate,
        quantified: Boolean(l.thisReview),
      })),
    ...changes
      .filter((c) => c.status === "proposed")
      .map((c) => ({ kind: "value_change" as const, code: c.code, reconciled: c.reconciled })),
    ...totals.forecastBlockers.map((b) => ({
      kind: "forecast" as const,
      code: b.code,
      name: b.name,
      notAssessed: b.notAssessed,
    })),
  ];

  const rec = response.recommendation;
  const dec = response.decision;
  return {
    model: {
      header: header("assurance", project, `Assurance Review ${review.sequence}`, review.status, review.reviewDate),
      review: {
        sequence: review.sequence,
        reviewDate: review.reviewDate,
        trigger: review.trigger,
        triggerEvidence: ws.triggerEvidence ? { code: ws.triggerEvidence.code, title: ws.triggerEvidence.title } : null,
        againstVersion: { number: ws.againstVersion.versionNumber, title: ws.againstVersion.title },
        previous: ws.previous ? { sequence: ws.previous.sequence, reviewDate: ws.previous.reviewDate } : null,
        finalisedOn: isoDate(review.finalisedAt),
        finalisedBy: ws.finalisedBy?.name ?? null,
        whatChanged: review.whatChanged,
        whyItMatters: review.whyItMatters,
        summary: review.summary,
        evidence: ws.evidence.map((e) => ({
          code: e.code,
          title: e.title,
          note: e.relevanceNote,
          materialChange: e.isMaterialChange,
        })),
      },
      position: {
        financialDriverCount: totals.financialDriverCount,
        authorisedTotal: totals.authorisedTotal,
        previousTotal: totals.previousTotal,
        forecastAssessed: totals.forecastAssessed,
        forecastTotal: totals.forecastTotal,
        valueGap: totals.valueGap,
        movement: totals.movement,
        realisedAssessed: totals.realisedAssessed,
        realisedAttributedTotal: totals.realisedAttributedTotal,
        unattributedRealised: totals.unattributedRealised,
        realisedTotal: totals.realisedTotal,
        forecastBlockers: totals.forecastBlockers,
        unattributedRationale: review.unattributedRealisedRationale,
      },
      drivers: ws.rows.map((r) => ({
        code: r.code,
        name: r.name,
        financial: r.financial,
        authorisedValue: r.authorisedValue,
        previousForecast: r.previousForecast,
        currentForecast: r.currentForecast,
        forecastNotAssessed: r.forecastNotAssessed,
        forecastRationale: r.forecastRationale,
        movement: r.movement,
        valueGap: r.valueGap,
        realisedValue: r.realisedValue,
        qualificationStatus: r.qualificationStatus,
        evidenceStatus: r.evidenceStatus,
      })),
      leakage: {
        items: leakage.map((l) => ({
          code: l.leakage.code,
          title: l.leakage.title,
          description: l.leakage.description,
          drivers: l.drivers.map((d) => ({ code: d.code, name: driverName.get(d.code) ?? d.code })),
          responseOwner: l.ownerName,
          status: l.leakage.status,
          requiredDecisionDate: l.leakage.requiredDecisionDate,
          consultantAssessment: l.leakage.consultantAssessment,
          identifiedInReview: l.identifiedInSequence,
          identifiedOn: l.leakage.identifiedOn,
          assessment: l.thisReview?.amounts
            ? {
                ...l.thisReview.amounts,
                unrecoverableRationale: l.thisReview.unrecoverableRationale,
                note: l.thisReview.assessmentNote,
              }
            : null,
        })),
        summary: leakageSummary,
      },
      scenarios: response.scenarios.map((s) => ({
        label: s.label,
        kind: s.kind,
        totalValue: s.totalValue,
        narrative: s.narrative,
        vsCurrent: s.vsCurrent,
        vsRecommended: s.vsRecommended,
        isRecommendation: Boolean(rec?.issuedAt && rec.scenarioId === s.id),
        isClientSelection: dec?.selectedScenarioId === s.id,
      })),
      // Only an issued recommendation is client-facing.
      recommendation:
        rec?.issuedAt && rec.scenario
          ? {
              label: rec.scenario.label,
              totalValue: rec.scenario.totalValue,
              narrative: rec.narrative,
              issuedOn: isoDate(rec.issuedAt),
            }
          : null,
      decision:
        dec && dec.scenario
          ? {
              label: dec.scenario.label,
              kind: dec.scenario.kind,
              totalValue: dec.scenario.totalValue,
              decidedBy: dec.deciderName,
              decidedOn: dec.decidedOn,
              rationale: dec.rationale,
              economicConsequence: dec.economicConsequence,
              evidence: dec.evidenceCode ? { code: dec.evidenceCode, title: dec.evidenceTitle! } : null,
              clientElectedDifference: dec.clientElectedDifference,
            }
          : null,
      valueChanges: changes,
      nextActions,
      evolution: await assuranceEvolution(projectId, review.sequence),
      outcomes: await assuranceOutcomes(projectId, review.id),
    },
    issuable: issuability("assurance", review.status),
  };
}

// ---------------------------------------------------------------------------
// Value Change Notice

export async function buildValueChangeNotice(
  projectId: string,
  changeId: string,
): Promise<BuiltReport<ValueChangeNotice> | null> {
  const project = await getProjectHeader(projectId);
  if (!project) return null;
  const d = await getValueChangeDetail(projectId, changeId);
  if (!d) return null;
  const { change } = d;

  let recommendation: ValueChangeNotice["origin"]["recommendation"] = null;
  let decision: ValueChangeNotice["origin"]["decision"] = null;
  if (d.review) {
    const response = await getReviewResponse(projectId, d.review.id);
    const rec = response.recommendation;
    if (rec?.issuedAt && rec.scenario)
      recommendation = { label: rec.scenario.label, totalValue: rec.scenario.totalValue };
    const dec = response.decision;
    if (dec && dec.scenario && (!change.decisionId || change.decisionId === dec.id)) {
      decision = {
        label: dec.scenario.label,
        totalValue: dec.scenario.totalValue,
        decidedBy: dec.deciderName,
        decidedOn: dec.decidedOn,
        clientElectedDifference: dec.clientElectedDifference,
      };
    }
  }

  const changed = d.driverRows.filter((r) => r.changed);
  return {
    model: {
      header: header(
        "value_change_notice",
        project,
        `Value Change ${change.code}`,
        change.status,
        change.authorisedOn ?? isoDate(change.proposedAt),
      ),
      change: {
        code: change.code,
        status: change.status,
        reason: change.reason,
        economicImpactNarrative: change.economicImpactNarrative,
        statedChange: change.statedChangeAmount,
        proposedOn: isoDate(change.proposedAt),
      },
      current: {
        versionNumber: d.fromVersion.versionNumber,
        title: d.fromVersion.title,
        status: d.fromVersion.status,
        total: d.fromTotal,
      },
      proposed: {
        versionNumber: d.toVersion.versionNumber,
        title: d.toVersion.title,
        status: d.toVersion.status,
        total: d.toTotal,
      },
      projectedFromStated: d.projectedFromStated,
      actualChange: d.actualChange,
      reconciled: d.reconciled,
      readyForAuthorisation: change.status === "proposed" && d.reconciled !== false,
      changedDrivers: changed.map((r) => ({
        code: r.code,
        name: r.name,
        fromValue: r.fromValue,
        toValue: r.toValue,
        change: r.change,
        added: !r.inFrom,
        removed: !r.inTo,
      })),
      unchangedDriverCount: d.driverRows.length - changed.length,
      origin: {
        review: d.review ? { sequence: d.review.sequence, reviewDate: d.review.reviewDate } : null,
        recommendation,
        decision,
      },
      authorisation:
        change.status === "authorised"
          ? {
              vco: d.vco?.name ?? null,
              authorisedBy: d.authoriser?.name ?? null,
              authorisedOn: change.authorisedOn,
              evidence: d.evidence ? { code: d.evidence.code, title: d.evidence.title } : null,
              note: change.authorisationNote,
            }
          : null,
    },
    issuable: issuability("value_change_notice", change.status),
  };
}

// ---------------------------------------------------------------------------

export async function buildReport(type: ReportType, projectId: string, subjectId: string): Promise<BuiltReport | null> {
  switch (type) {
    case "information_request":
      return buildInformationRequestReport(projectId, subjectId);
    case "requalification":
      return buildRequalificationReport(projectId, subjectId);
    case "assurance":
      return buildAssuranceReport(projectId, subjectId);
    case "value_change_notice":
      return buildValueChangeNotice(projectId, subjectId);
  }
}

// ---------------------------------------------------------------------------
// Reports screen and issued reports

export const SUBJECT_COLUMN = {
  information_request: "informationRequestId",
  requalification: "valueCaseVersionId",
  assurance: "assuranceReviewId",
  value_change_notice: "valueChangeId",
} as const satisfies Record<ReportType, keyof typeof schema.reportIssue.$inferSelect>;

export type ReportIssueRow = typeof schema.reportIssue.$inferSelect;

export const subjectIdOf = (row: ReportIssueRow): string => row[SUBJECT_COLUMN[row.type]]!;

export async function listReportIssues(projectId: string): Promise<ReportIssueRow[]> {
  return db()
    .select()
    .from(schema.reportIssue)
    .where(eq(schema.reportIssue.projectId, projectId))
    .orderBy(desc(schema.reportIssue.issuedAt));
}

export async function getReportIssue(projectId: string, issueId: string): Promise<ReportIssueRow | null> {
  const [row] = await db()
    .select()
    .from(schema.reportIssue)
    .where(and(eq(schema.reportIssue.projectId, projectId), eq(schema.reportIssue.id, issueId)));
  return row ?? null;
}

export async function listSubjectIssues(type: ReportType, subjectId: string): Promise<ReportIssueRow[]> {
  return db()
    .select()
    .from(schema.reportIssue)
    .where(and(eq(schema.reportIssue.type, type), eq(schema.reportIssue[SUBJECT_COLUMN[type]], subjectId)))
    .orderBy(asc(schema.reportIssue.issueNumber));
}

export async function nextIssueNumber(type: ReportType, subjectId: string): Promise<number> {
  return (await listSubjectIssues(type, subjectId)).length + 1;
}

export type AvailableReport = {
  type: ReportType;
  subjectId: string;
  subjectLabel: string;
  subjectStatus: string;
  issuable: { ok: boolean; reason: string | null };
};

/** Every report subject in the project, with whether it can be issued now. */
export async function listAvailableReports(projectId: string): Promise<AvailableReport[]> {
  const [requests, versions, reviews, changes] = await Promise.all([
    db()
      .select()
      .from(schema.informationRequest)
      .where(eq(schema.informationRequest.projectId, projectId))
      .orderBy(asc(schema.informationRequest.createdAt)),
    db()
      .select()
      .from(schema.valueCaseVersion)
      .where(
        and(
          eq(schema.valueCaseVersion.projectId, projectId),
          eq(schema.valueCaseVersion.kind, "value_case"),
          eq(schema.valueCaseVersion.versionNumber, 1),
        ),
      ),
    db()
      .select()
      .from(schema.assuranceReview)
      .where(eq(schema.assuranceReview.projectId, projectId))
      .orderBy(asc(schema.assuranceReview.sequence)),
    db()
      .select()
      .from(schema.valueChange)
      .where(eq(schema.valueChange.projectId, projectId))
      .orderBy(asc(schema.valueChange.createdAt)),
  ]);
  return [
    ...requests.map((r) => ({
      type: "information_request" as const,
      subjectId: r.id,
      subjectLabel: `${r.reference} · ${r.title}`,
      subjectStatus: r.status,
      issuable: issuability("information_request", r.status),
    })),
    ...versions.map((v) => ({
      type: "requalification" as const,
      subjectId: v.id,
      subjectLabel: `Value Case V${v.versionNumber} · ${v.title}`,
      subjectStatus: v.status,
      issuable: issuability("requalification", v.status, { versionNumber: v.versionNumber }),
    })),
    ...reviews.map((r) => ({
      type: "assurance" as const,
      subjectId: r.id,
      subjectLabel: `Assurance Review ${r.sequence} · ${r.reviewDate}`,
      subjectStatus: r.status,
      issuable: issuability("assurance", r.status),
    })),
    ...changes.map((c) => ({
      type: "value_change_notice" as const,
      subjectId: c.id,
      subjectLabel: `Value Change ${c.code}`,
      subjectStatus: c.status,
      issuable: issuability("value_change_notice", c.status),
    })),
  ];
}

/** Snapshot fingerprint: sha256 of the canonical JSON. */
export function snapshotSha256(model: ReportModel): string {
  return createHash("sha256").update(canonicalJson(model), "utf8").digest("hex");
}
