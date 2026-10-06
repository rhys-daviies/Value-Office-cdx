import { and, asc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db, schema } from "@/server/db/client";

import { formatRequestReference } from "@/server/commands/information-request";

import { listDriverOptions } from "./information-request";
import { listDocuments, listStakeholders } from "./mobilise";

const supersedes = alias(schema.evidence, "supersedes");

export type EvidenceTarget = {
  linkId: string;
  versionNumber: number;
  versionStatus: string;
  driverCode: string;
  driverName: string;
  assumption: string | null;
};

/** Where each piece of evidence is relied on (driver versions and assumptions). */
async function listLinks(projectId: string): Promise<(EvidenceTarget & { evidenceId: string })[]> {
  const direct = await db()
    .select({
      linkId: schema.evidenceLink.id,
      evidenceId: schema.evidenceLink.evidenceId,
      versionNumber: schema.valueCaseVersion.versionNumber,
      versionStatus: schema.valueCaseVersion.status,
      driverCode: schema.valueDriver.code,
      driverName: schema.valueDriverVersion.name,
    })
    .from(schema.evidenceLink)
    .innerJoin(schema.valueDriverVersion, eq(schema.valueDriverVersion.id, schema.evidenceLink.valueDriverVersionId))
    .innerJoin(schema.valueDriver, eq(schema.valueDriver.id, schema.valueDriverVersion.valueDriverId))
    .innerJoin(schema.valueCaseVersion, eq(schema.valueCaseVersion.id, schema.valueDriverVersion.valueCaseVersionId))
    .where(and(eq(schema.evidenceLink.projectId, projectId), isNotNull(schema.evidenceLink.valueDriverVersionId)));
  const viaAssumption = await db()
    .select({
      linkId: schema.evidenceLink.id,
      evidenceId: schema.evidenceLink.evidenceId,
      versionNumber: schema.valueCaseVersion.versionNumber,
      versionStatus: schema.valueCaseVersion.status,
      driverCode: schema.valueDriver.code,
      driverName: schema.valueDriverVersion.name,
      assumption: schema.assumption.statement,
    })
    .from(schema.evidenceLink)
    .innerJoin(schema.assumption, eq(schema.assumption.id, schema.evidenceLink.assumptionId))
    .innerJoin(schema.valueDriverVersion, eq(schema.valueDriverVersion.id, schema.assumption.valueDriverVersionId))
    .innerJoin(schema.valueDriver, eq(schema.valueDriver.id, schema.valueDriverVersion.valueDriverId))
    .innerJoin(schema.valueCaseVersion, eq(schema.valueCaseVersion.id, schema.valueDriverVersion.valueCaseVersionId))
    .where(eq(schema.evidenceLink.projectId, projectId));
  return [...direct.map((d) => ({ ...d, assumption: null })), ...viaAssumption].sort(
    (a, b) => a.versionNumber - b.versionNumber || a.driverCode.localeCompare(b.driverCode),
  );
}

export async function getEvidenceRegister(projectId: string) {
  const rows = await db()
    .select({
      evidence: schema.evidence,
      documentTitle: schema.document.title,
      documentUri: schema.document.uri,
      sourcePersonName: schema.person.name,
      supersedesCode: supersedes.code,
    })
    .from(schema.evidence)
    .leftJoin(schema.document, eq(schema.document.id, schema.evidence.documentId))
    .leftJoin(schema.person, eq(schema.person.id, schema.evidence.sourcePersonId))
    .leftJoin(supersedes, eq(supersedes.id, schema.evidence.supersedesEvidenceId))
    .where(eq(schema.evidence.projectId, projectId))
    .orderBy(asc(schema.evidence.code));

  const [links, reviewLinks, locked, authorisations, documents, stakeholders, unclassified] = await Promise.all([
    listLinks(projectId),
    db()
      .select({
        linkId: schema.evidenceLink.id,
        evidenceId: schema.evidenceLink.evidenceId,
        reviewId: schema.assuranceReview.id,
        sequence: schema.assuranceReview.sequence,
        status: schema.assuranceReview.status,
      })
      .from(schema.evidenceLink)
      .innerJoin(schema.assuranceReview, eq(schema.assuranceReview.id, schema.evidenceLink.assuranceReviewId))
      .where(eq(schema.evidenceLink.projectId, projectId)),
    lockedEvidenceIds(projectId),
    db()
      .select({
        evidenceId: schema.valueCaseVersion.authorisationEvidenceId,
        versionNumber: schema.valueCaseVersion.versionNumber,
      })
      .from(schema.valueCaseVersion)
      .where(
        and(
          eq(schema.valueCaseVersion.projectId, projectId),
          isNotNull(schema.valueCaseVersion.authorisationEvidenceId),
        ),
      ),
    listDocuments(projectId),
    listStakeholders(projectId),
    evidenceNeedingClassification(projectId),
  ]);
  const { matterLinks, driverLinks, fulfils } = await listWorkingUse(projectId);

  const entries = rows.map((r) => ({
    ...r,
    supersededBy: rows.filter((o) => o.evidence.supersedesEvidenceId === r.evidence.id).map((o) => o.evidence.code),
    links: links.filter((l) => l.evidenceId === r.evidence.id),
    reviewLinks: reviewLinks.filter((l) => l.evidenceId === r.evidence.id),
    authorises: authorisations.filter((a) => a.evidenceId === r.evidence.id).map((a) => a.versionNumber),
    matterLinks: matterLinks.filter((l) => l.evidenceId === r.evidence.id),
    driverLinks: driverLinks.filter((l) => l.evidenceId === r.evidence.id),
    fulfils: fulfils.filter((f) => f.evidenceId === r.evidence.id),
    locked: locked.has(r.evidence.id),
    /** Phase 4D.13: no existing relationship to anything it supports (see evidenceNeedingClassification). */
    needsClassification: unclassified.has(r.evidence.id),
  }));
  return { entries, documents, stakeholders };
}

export type EvidenceRegister = Awaited<ReturnType<typeof getEvidenceRegister>>;
export type EvidenceEntry = EvidenceRegister["entries"][number];

/**
 * Working use of evidence (Phase 4D.2): links to living Assurance matters and stable Value Driver
 * identities, and the request items it fulfilled. None of these is formal reliance.
 */
async function listWorkingUse(projectId: string) {
  const [matterLinks, driverLinks, fulfils] = await Promise.all([
    db()
      .select({
        linkId: schema.evidenceLink.id,
        evidenceId: schema.evidenceLink.evidenceId,
        matterId: schema.valueLeakage.id,
        code: schema.valueLeakage.code,
        title: schema.valueLeakage.title,
        status: schema.valueLeakage.status,
      })
      .from(schema.evidenceLink)
      .innerJoin(schema.valueLeakage, eq(schema.valueLeakage.id, schema.evidenceLink.valueLeakageId))
      .where(eq(schema.evidenceLink.projectId, projectId))
      .orderBy(asc(schema.valueLeakage.code)),
    db()
      .select({
        linkId: schema.evidenceLink.id,
        evidenceId: schema.evidenceLink.evidenceId,
        driverId: schema.valueDriver.id,
        code: schema.valueDriver.code,
      })
      .from(schema.evidenceLink)
      .innerJoin(schema.valueDriver, eq(schema.valueDriver.id, schema.evidenceLink.valueDriverId))
      .where(eq(schema.evidenceLink.projectId, projectId))
      .orderBy(asc(schema.valueDriver.code)),
    db()
      .select({
        evidenceId: schema.informationRequestItem.fulfilledByEvidenceId,
        requestId: schema.informationRequest.id,
        reference: schema.informationRequest.reference,
        sequence: schema.informationRequestItem.sequence,
      })
      .from(schema.informationRequestItem)
      .innerJoin(
        schema.informationRequest,
        eq(schema.informationRequest.id, schema.informationRequestItem.informationRequestId),
      )
      .where(
        and(
          eq(schema.informationRequestItem.projectId, projectId),
          isNotNull(schema.informationRequestItem.fulfilledByEvidenceId),
        ),
      )
      .orderBy(asc(schema.informationRequest.reference), asc(schema.informationRequestItem.sequence)),
  ]);
  return { matterLinks, driverLinks, fulfils };
}

/** Mirrors vo_evidence_is_locked(): relied on by a non-draft version. */
/**
 * Evidence needing classification (Phase 4D.13): evidence with NO existing relationship to anything it supports — no
 * evidence link of any kind (driver, driver version, assumption, Assurance matter, Assurance Review), not the evidence
 * that fulfilled an Information Request item, and not cited by an authorisation, a review trigger or a decision.
 * Derived from existing relationships only — no stored state. A driver link is NOT required: evidence tied to a
 * review, matter, request or governance record is classified. (Superseding evidence is not, by itself, classified:
 * it still needs its own links.) The one definition used by the Evidence register and the Overview count.
 */
export async function evidenceNeedingClassification(projectId: string): Promise<Set<string>> {
  const result = await db().execute<{ id: string }>(sql`
    select e.id from evidence e
    where e.project_id = ${projectId}
      and not exists (select 1 from evidence_link l where l.evidence_id = e.id)
      and not exists (select 1 from information_request_item i where i.fulfilled_by_evidence_id = e.id)
      and not exists (select 1 from value_case_version v where v.authorisation_evidence_id = e.id)
      and not exists (select 1 from value_change c where c.authorisation_evidence_id = e.id)
      and not exists (select 1 from assurance_review r where r.trigger_evidence_id = e.id)
      and not exists (select 1 from decision d where d.supporting_evidence_id = e.id)`);
  return new Set(result.rows.map((r) => r.id));
}

async function lockedEvidenceIds(projectId: string): Promise<Set<string>> {
  const result = await db().execute<{ id: string }>(sql`
    select e.id from evidence e
    where e.project_id = ${projectId} and vo_evidence_is_locked(e.id)`);
  return new Set(result.rows.map((r) => r.id));
}

export async function getEvidenceDetail(projectId: string, evidenceId: string) {
  const register = await getEvidenceRegister(projectId);
  const entry = register.entries.find((e) => e.evidence.id === evidenceId);
  if (!entry) return null;

  // Link targets: only drafts accept new links.
  const draftTargets = await db()
    .select({
      driverVersionId: schema.valueDriverVersion.id,
      code: schema.valueDriver.code,
      name: schema.valueDriverVersion.name,
      versionNumber: schema.valueCaseVersion.versionNumber,
    })
    .from(schema.valueDriverVersion)
    .innerJoin(schema.valueDriver, eq(schema.valueDriver.id, schema.valueDriverVersion.valueDriverId))
    .innerJoin(schema.valueCaseVersion, eq(schema.valueCaseVersion.id, schema.valueDriverVersion.valueCaseVersionId))
    .where(and(eq(schema.valueDriverVersion.projectId, projectId), eq(schema.valueCaseVersion.status, "draft")))
    .orderBy(asc(schema.valueCaseVersion.versionNumber), asc(schema.valueDriver.code));
  const draftAssumptions = await db()
    .select({
      assumptionId: schema.assumption.id,
      statement: schema.assumption.statement,
      code: schema.valueDriver.code,
      versionNumber: schema.valueCaseVersion.versionNumber,
    })
    .from(schema.assumption)
    .innerJoin(schema.valueDriverVersion, eq(schema.valueDriverVersion.id, schema.assumption.valueDriverVersionId))
    .innerJoin(schema.valueDriver, eq(schema.valueDriver.id, schema.valueDriverVersion.valueDriverId))
    .innerJoin(schema.valueCaseVersion, eq(schema.valueCaseVersion.id, schema.valueDriverVersion.valueCaseVersionId))
    .where(and(eq(schema.assumption.projectId, projectId), eq(schema.valueCaseVersion.status, "draft")))
    .orderBy(asc(schema.valueDriver.code));

  const drivers = await listDriverOptions(projectId);

  return {
    entry,
    documents: register.documents,
    stakeholders: register.stakeholders,
    otherEvidence: register.entries.filter((e) => e.evidence.id !== evidenceId).map((e) => e.evidence),
    draftTargets,
    draftAssumptions,
    // Working-link targets: stable driver identities not yet linked.
    driverTargets: drivers.filter((d) => !entry.driverLinks.some((l) => l.driverId === d.driverId)),
  };
}

/**
 * Evidence around one Assurance matter (Phase 4D.2): what supports it (working links), what is still
 * required (items on Assurance Information Requests), and what fulfilled each request.
 */
export async function getMatterEvidence(projectId: string, matterId: string) {
  const fulfilled = alias(schema.evidence, "fulfilled");
  const [linked, items, requests, allEvidence, locked, drivers] = await Promise.all([
    db()
      .select({
        linkId: schema.evidenceLink.id,
        relevanceNote: schema.evidenceLink.relevanceNote,
        linkedAt: schema.evidenceLink.createdAt,
        evidence: schema.evidence,
        sourcePersonName: schema.person.name,
      })
      .from(schema.evidenceLink)
      .innerJoin(schema.evidence, eq(schema.evidence.id, schema.evidenceLink.evidenceId))
      .leftJoin(schema.person, eq(schema.person.id, schema.evidence.sourcePersonId))
      .where(and(eq(schema.evidenceLink.projectId, projectId), eq(schema.evidenceLink.valueLeakageId, matterId)))
      .orderBy(asc(schema.evidence.code)),
    db()
      .select({
        item: schema.informationRequestItem,
        request: {
          id: schema.informationRequest.id,
          reference: schema.informationRequest.reference,
          title: schema.informationRequest.title,
          status: schema.informationRequest.status,
        },
        requestedFromName: schema.person.name,
        requestedFromRole: schema.projectStakeholder.roleDescription,
        driverCode: schema.valueDriver.code,
        evidence: { id: fulfilled.id, code: fulfilled.code, title: fulfilled.title },
      })
      .from(schema.informationRequestItem)
      .innerJoin(
        schema.informationRequest,
        eq(schema.informationRequest.id, schema.informationRequestItem.informationRequestId),
      )
      .leftJoin(schema.person, eq(schema.person.id, schema.informationRequestItem.requestedFromPersonId))
      .leftJoin(
        schema.projectStakeholder,
        and(
          eq(schema.projectStakeholder.projectId, schema.informationRequestItem.projectId),
          eq(schema.projectStakeholder.personId, schema.informationRequestItem.requestedFromPersonId),
        ),
      )
      .leftJoin(schema.valueDriver, eq(schema.valueDriver.id, schema.informationRequestItem.valueDriverId))
      .leftJoin(fulfilled, eq(fulfilled.id, schema.informationRequestItem.fulfilledByEvidenceId))
      .where(
        and(
          eq(schema.informationRequestItem.projectId, projectId),
          eq(schema.informationRequestItem.valueLeakageId, matterId),
        ),
      )
      .orderBy(asc(schema.informationRequest.reference), asc(schema.informationRequestItem.sequence)),
    db()
      .select()
      .from(schema.informationRequest)
      .where(eq(schema.informationRequest.projectId, projectId))
      .orderBy(asc(schema.informationRequest.createdAt)),
    db()
      .select({ id: schema.evidence.id, code: schema.evidence.code, title: schema.evidence.title })
      .from(schema.evidence)
      .where(eq(schema.evidence.projectId, projectId))
      .orderBy(asc(schema.evidence.code)),
    lockedEvidenceIds(projectId),
    listDriverOptions(projectId),
  ]);
  const linkedIds = new Set(linked.map((l) => l.evidence.id));
  return {
    linked: linked.map((l) => ({ ...l, locked: locked.has(l.evidence.id) })),
    items,
    /** Assurance requests that can take another item. */
    assuranceRequests: requests.filter((r) => r.purpose === "assurance" && r.status !== "closed"),
    nextRequestReference: formatRequestReference(requests.map((r) => r.reference)),
    nextEvidenceCode: nextEvidenceCode(allEvidence.map((e) => e.code)),
    linkableEvidence: allEvidence.filter((e) => !linkedIds.has(e.id)),
    fulfilmentEvidence: allEvidence,
    drivers,
  };
}

export type MatterEvidence = Awaited<ReturnType<typeof getMatterEvidence>>;

/** Evidence linked to the project's open Assurance matters, for deliberate use as review evidence. */
export async function listOpenMatterEvidence(projectId: string) {
  return db()
    .select({
      evidenceId: schema.evidence.id,
      code: schema.evidence.code,
      title: schema.evidence.title,
      matterId: schema.valueLeakage.id,
      matterCode: schema.valueLeakage.code,
    })
    .from(schema.evidenceLink)
    .innerJoin(schema.evidence, eq(schema.evidence.id, schema.evidenceLink.evidenceId))
    .innerJoin(schema.valueLeakage, eq(schema.valueLeakage.id, schema.evidenceLink.valueLeakageId))
    .where(and(eq(schema.evidenceLink.projectId, projectId), ne(schema.valueLeakage.status, "closed")))
    .orderBy(asc(schema.valueLeakage.code), asc(schema.evidence.code));
}

export function nextEvidenceCode(codes: readonly string[]): string {
  const max = codes.reduce((m, c) => Math.max(m, Number(/^E-(\d+)$/.exec(c)?.[1] ?? 0)), 0);
  return `E-${String(max + 1).padStart(3, "0")}`;
}
