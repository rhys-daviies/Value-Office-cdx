import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db, schema } from "@/server/db/client";

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

  const [links, reviewLinks, locked, authorisations, documents, stakeholders] = await Promise.all([
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
  ]);

  const entries = rows.map((r) => ({
    ...r,
    supersededBy: rows.filter((o) => o.evidence.supersedesEvidenceId === r.evidence.id).map((o) => o.evidence.code),
    links: links.filter((l) => l.evidenceId === r.evidence.id),
    reviewLinks: reviewLinks.filter((l) => l.evidenceId === r.evidence.id),
    authorises: authorisations.filter((a) => a.evidenceId === r.evidence.id).map((a) => a.versionNumber),
    locked: locked.has(r.evidence.id),
  }));
  return { entries, documents, stakeholders };
}

export type EvidenceRegister = Awaited<ReturnType<typeof getEvidenceRegister>>;
export type EvidenceEntry = EvidenceRegister["entries"][number];

/** Mirrors vo_evidence_is_locked(): relied on by a non-draft version. */
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

  return {
    entry,
    documents: register.documents,
    stakeholders: register.stakeholders,
    otherEvidence: register.entries.filter((e) => e.evidence.id !== evidenceId).map((e) => e.evidence),
    draftTargets,
    draftAssumptions,
  };
}

export function nextEvidenceCode(codes: readonly string[]): string {
  const max = codes.reduce((m, c) => Math.max(m, Number(/^E-(\d+)$/.exec(c)?.[1] ?? 0)), 0);
  return `E-${String(max + 1).padStart(3, "0")}`;
}
