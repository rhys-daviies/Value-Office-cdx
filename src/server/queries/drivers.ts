import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { EvidenceStatus, QualificationStatus } from "@/domain/statuses";
import { db, schema } from "@/server/db/client";

import { getAssuranceWorkspace, getValuePositionSummary } from "./assurance";
import { listStakeholders } from "./mobilise";

// Value Drivers register (Phase 4D.3): every stable driver identity, with three separate readings —
//   working   the living record (or, before one is started, the governed content it would start from)
//   authorised the driver's content in the Authorised Value Case in force (null = not in it)
//   forecast  the latest finalised Value Position measured against that version (null otherwise)
// Working figures are never summed with, substituted for, or presented as authorised or forecast.

/** Derived, never stored: in the Value Case iff the identity is in the authorised version in force. */
export type LivingStatus = "in_value_case" | "emerging";
/**
 * Display status (Phase 4D.4, PMO): a driver that was in an earlier authorised version but not in the
 * one in force is "Outside Current Value Case", not "Emerging". Still derived; nothing is stored.
 */
export type DriverPresentation = "in_value_case" | "outside_current" | "emerging" | "original_only" | "in_definition";
// 4D.10D: before any authorisation, a driver recorded only in the Original Business Case is "original_only" and one in
// the draft or proposed V1 is "in_definition" — neither is an Emerging driver. Emerging stays what it was: a living
// driver that has never been in an authorised version (raised after authorisation, or pending in a Value Change).

type Working = {
  name: string;
  description: string | null;
  metric: string | null;
  metricUnit: string | null;
  baselineValue: string | null;
  targetValue: string | null;
  calculationRationale: string | null;
  workingEstimate: string | null;
  avoPersonId: string | null;
  qualificationStatus: QualificationStatus;
  evidenceStatus: EvidenceStatus;
  notes: string | null;
};

export async function getDriverRegister(projectId: string) {
  const [identities, versions, records, stakeholders, summary, matterLinks, evidenceLinks] = await Promise.all([
    db()
      .select()
      .from(schema.valueDriver)
      .where(eq(schema.valueDriver.projectId, projectId))
      .orderBy(asc(schema.valueDriver.code)),
    db()
      .select({ dv: schema.valueDriverVersion, version: schema.valueCaseVersion })
      .from(schema.valueDriverVersion)
      .innerJoin(schema.valueCaseVersion, eq(schema.valueCaseVersion.id, schema.valueDriverVersion.valueCaseVersionId))
      .where(eq(schema.valueDriverVersion.projectId, projectId))
      .orderBy(asc(schema.valueCaseVersion.versionNumber)),
    db()
      .select({
        record: schema.valueDriverRecord,
        originCode: schema.valueLeakage.code,
        originTitle: schema.valueLeakage.title,
      })
      .from(schema.valueDriverRecord)
      .leftJoin(schema.valueLeakage, eq(schema.valueLeakage.id, schema.valueDriverRecord.originValueLeakageId))
      .where(eq(schema.valueDriverRecord.projectId, projectId)),
    listStakeholders(projectId),
    getValuePositionSummary(projectId),
    db()
      .select({
        valueDriverId: schema.valueLeakageDriver.valueDriverId,
        id: schema.valueLeakage.id,
        code: schema.valueLeakage.code,
        title: schema.valueLeakage.title,
        status: schema.valueLeakage.status,
      })
      .from(schema.valueLeakageDriver)
      .innerJoin(schema.valueLeakage, eq(schema.valueLeakage.id, schema.valueLeakageDriver.valueLeakageId))
      .where(eq(schema.valueLeakageDriver.projectId, projectId))
      .orderBy(asc(schema.valueLeakage.code)),
    db()
      .select({ valueDriverId: schema.evidenceLink.valueDriverId })
      .from(schema.evidenceLink)
      .where(and(eq(schema.evidenceLink.projectId, projectId), isNotNull(schema.evidenceLink.valueDriverId))),
  ]);

  const inForce = summary.authorised;
  // Informational only: identities in the proposed version of a draft or proposed Value Change.
  const pending = await db()
    .select({
      valueDriverId: schema.valueDriverVersion.valueDriverId,
      changeId: schema.valueChange.id,
      code: schema.valueChange.code,
      status: schema.valueChange.status,
    })
    .from(schema.valueChange)
    .innerJoin(
      schema.valueDriverVersion,
      eq(schema.valueDriverVersion.valueCaseVersionId, schema.valueChange.toVersionId),
    )
    .where(and(eq(schema.valueChange.projectId, projectId), inArray(schema.valueChange.status, ["draft", "proposed"])));
  const latest =
    summary.latest && inForce && summary.latest.review.againstVersionId === inForce.id ? summary.latest : null;
  const forecastRows = latest ? ((await getAssuranceWorkspace(projectId, latest.review.id))?.rows ?? []) : [];
  const name = new Map(stakeholders.map((s) => [s.personId, s.name]));

  const entries = identities.map((driver) => {
    const own = versions.filter((v) => v.dv.valueDriverId === driver.id);
    const authorisedRow = inForce ? (own.find((v) => v.version.id === inForce.id) ?? null) : null;
    const rec = records.find((r) => r.record.valueDriverId === driver.id) ?? null;
    const startFrom =
      own.findLast((v) => v.version.status === "authorised") ??
      own.findLast((v) => v.version.status !== "draft" && v.version.status !== "proposed") ??
      own.at(-1) ??
      null;
    const working: Working | null = rec
      ? rec.record
      : startFrom
        ? { ...startFrom.dv, workingEstimate: startFrom.dv.financialValue }
        : null;
    const forecast = authorisedRow ? (forecastRows.find((r) => r.valueDriverId === driver.id) ?? null) : null;
    const status: LivingStatus = authorisedRow ? "in_value_case" : "emerging";
    const everAuthorised = own.some((v) => v.version.status === "superseded" || v.version.status === "authorised");
    const inOriginal = own.some((v) => v.version.kind === "inherited_business_case");
    const inValueCase = own.filter((v) => v.version.kind === "value_case");
    const presentation: DriverPresentation = authorisedRow
      ? "in_value_case"
      : everAuthorised
        ? "outside_current"
        : !inForce && inValueCase.some((v) => v.version.status === "draft" || v.version.status === "proposed")
          ? "in_definition"
          : inOriginal && inValueCase.length === 0
            ? "original_only"
            : "emerging";
    return {
      presentation,
      driver,
      status,
      /** Null until a consultant starts the working record (existing drivers). */
      record: rec?.record ?? null,
      origin: rec?.record.originValueLeakageId
        ? { id: rec.record.originValueLeakageId, code: rec.originCode!, title: rec.originTitle! }
        : null,
      /** The working reading; `fromVersion` set when it is still the governed content (no record yet). */
      working,
      fromVersion: rec ? null : (startFrom?.version.versionNumber ?? null),
      avoName: working?.avoPersonId ? (name.get(working.avoPersonId) ?? null) : null,
      authorised: authorisedRow
        ? { versionNumber: authorisedRow.version.versionNumber, financialValue: authorisedRow.dv.financialValue }
        : null,
      /** Previously in an authorised version, but not in the one in force. */
      formerlyIn: authorisedRow
        ? null
        : (own.findLast((v) => v.version.status === "superseded")?.version.versionNumber ?? null),
      forecast: forecast
        ? {
            reviewSequence: latest!.review.sequence,
            currentForecast: forecast.currentForecast,
            notAssessed: forecast.forecastNotAssessed,
            financial: forecast.financial,
          }
        : null,
      matters: matterLinks.filter((m) => m.valueDriverId === driver.id),
      workingEvidenceCount: evidenceLinks.filter((l) => l.valueDriverId === driver.id).length,
      /** Draft/proposed Value Change whose proposed version contains this identity (context only). */
      pendingChange: pending.find((p) => p.valueDriverId === driver.id) ?? null,
      /** Pre-authorisation context for the display status (4D.10D). */
      definition: {
        v1Exists: versions.some((v) => v.version.kind === "value_case"),
        v1Status: inValueCase.at(-1)?.version.status ?? null,
      },
    };
  });
  return { entries, inForce, stakeholders, authorisedTotal: summary.authorisedTotal };
}

export type DriverRegister = Awaited<ReturnType<typeof getDriverRegister>>;
export type DriverEntry = DriverRegister["entries"][number];

export async function getDriverDetail(projectId: string, valueDriverId: string) {
  const register = await getDriverRegister(projectId);
  const entry = register.entries.find((e) => e.driver.id === valueDriverId);
  if (!entry) return null;
  const avo = alias(schema.person, "avo");
  const recorder = alias(schema.appUser, "recorder");
  const [history, assumptions, workingEvidence, formalEvidence, requests, estimateBy, openMatters] = await Promise.all([
    db()
      .select({ dv: schema.valueDriverVersion, version: schema.valueCaseVersion, avoName: avo.name })
      .from(schema.valueDriverVersion)
      .innerJoin(schema.valueCaseVersion, eq(schema.valueCaseVersion.id, schema.valueDriverVersion.valueCaseVersionId))
      .leftJoin(avo, eq(avo.id, schema.valueDriverVersion.avoPersonId))
      .where(eq(schema.valueDriverVersion.valueDriverId, valueDriverId))
      .orderBy(asc(schema.valueCaseVersion.versionNumber)),
    entry.record
      ? db()
          .select()
          .from(schema.valueDriverRecordAssumption)
          .where(eq(schema.valueDriverRecordAssumption.valueDriverRecordId, entry.record.id))
          .orderBy(asc(schema.valueDriverRecordAssumption.sortOrder), asc(schema.valueDriverRecordAssumption.createdAt))
      : Promise.resolve([]),
    db()
      .select({
        linkId: schema.evidenceLink.id,
        relevanceNote: schema.evidenceLink.relevanceNote,
        evidence: { id: schema.evidence.id, code: schema.evidence.code, title: schema.evidence.title },
      })
      .from(schema.evidenceLink)
      .innerJoin(schema.evidence, eq(schema.evidence.id, schema.evidenceLink.evidenceId))
      .where(eq(schema.evidenceLink.valueDriverId, valueDriverId))
      .orderBy(asc(schema.evidence.code)),
    db()
      .select({
        linkId: schema.evidenceLink.id,
        versionNumber: schema.valueCaseVersion.versionNumber,
        evidence: { id: schema.evidence.id, code: schema.evidence.code, title: schema.evidence.title },
      })
      .from(schema.evidenceLink)
      .innerJoin(schema.evidence, eq(schema.evidence.id, schema.evidenceLink.evidenceId))
      .innerJoin(schema.valueDriverVersion, eq(schema.valueDriverVersion.id, schema.evidenceLink.valueDriverVersionId))
      .innerJoin(schema.valueCaseVersion, eq(schema.valueCaseVersion.id, schema.valueDriverVersion.valueCaseVersionId))
      .where(eq(schema.valueDriverVersion.valueDriverId, valueDriverId))
      .orderBy(asc(schema.valueCaseVersion.versionNumber), asc(schema.evidence.code)),
    db()
      .select({
        item: schema.informationRequestItem,
        reference: schema.informationRequest.reference,
        requestId: schema.informationRequest.id,
      })
      .from(schema.informationRequestItem)
      .innerJoin(
        schema.informationRequest,
        eq(schema.informationRequest.id, schema.informationRequestItem.informationRequestId),
      )
      .where(eq(schema.informationRequestItem.valueDriverId, valueDriverId))
      .orderBy(asc(schema.informationRequest.reference), asc(schema.informationRequestItem.sequence)),
    entry.record?.estimateRecordedBy
      ? db()
          .select({ name: recorder.displayName })
          .from(recorder)
          .where(eq(recorder.id, entry.record.estimateRecordedBy))
      : Promise.resolve([]),
    db()
      .select({ id: schema.valueLeakage.id, code: schema.valueLeakage.code, title: schema.valueLeakage.title })
      .from(schema.valueLeakage)
      .where(and(eq(schema.valueLeakage.projectId, projectId), eq(schema.valueLeakage.status, "open")))
      .orderBy(asc(schema.valueLeakage.code)),
  ]);
  const evidenceOptions = await db()
    .select({ id: schema.evidence.id, code: schema.evidence.code, title: schema.evidence.title })
    .from(schema.evidence)
    .where(eq(schema.evidence.projectId, projectId))
    .orderBy(asc(schema.evidence.code));
  const linked = new Set(workingEvidence.map((w) => w.evidence.id));
  return {
    entry,
    stakeholders: register.stakeholders,
    history,
    assumptions,
    workingEvidence,
    formalEvidence,
    requests,
    estimateRecordedByName: estimateBy[0]?.name ?? null,
    openMatters,
    linkableEvidence: evidenceOptions.filter((e) => !linked.has(e.id)),
  };
}

export type DriverDetail = NonNullable<Awaited<ReturnType<typeof getDriverDetail>>>;

/** Identities with a working record that are not yet in a draft Value Change's proposed version. */
export async function listIncludableDrivers(projectId: string, toVersionId: string) {
  const register = await getDriverRegister(projectId);
  const inVersion = new Set(
    (
      await db()
        .select({ id: schema.valueDriverVersion.valueDriverId })
        .from(schema.valueDriverVersion)
        .where(eq(schema.valueDriverVersion.valueCaseVersionId, toVersionId))
    ).map((r) => r.id),
  );
  return register.entries.filter((e) => e.record && !inVersion.has(e.driver.id));
}
