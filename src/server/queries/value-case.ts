import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { sumMoney, type Money } from "@/domain/money";
import { moneyChange, summariseDrivers, type DriverSummary } from "@/domain/value-case";
import { db, schema } from "@/server/db/client";

/** Totals are always derived from driver versions, never stored. */
export async function getVersionTotal(versionId: string): Promise<{ total: Money; driversWithoutValue: number }> {
  const rows = await db()
    .select({ financialValue: schema.valueDriverVersion.financialValue })
    .from(schema.valueDriverVersion)
    .where(eq(schema.valueDriverVersion.valueCaseVersionId, versionId));
  const valued = rows.flatMap((r) => (r.financialValue === null ? [] : [r.financialValue]));
  return { total: sumMoney(valued), driversWithoutValue: rows.length - valued.length };
}

// ---------------------------------------------------------------------------
// Version contents

export type EvidenceLinkRow = {
  linkId: string;
  evidenceId: string;
  code: string;
  title: string;
  relevanceNote: string | null;
};

export type AssumptionRow = {
  id: string;
  statement: string;
  evidenceStatus: (typeof schema.assumption.$inferSelect)["evidenceStatus"];
  notes: string | null;
  evidence: EvidenceLinkRow[];
};

export type DriverRow = Omit<typeof schema.valueDriverVersion.$inferSelect, "id" | "createdAt"> & {
  driverVersionId: string;
  code: string;
  avoName: string | null;
  assumptions: AssumptionRow[];
  evidence: EvidenceLinkRow[];
  evidenceLinkCount: number;
};

export type VersionRow = typeof schema.valueCaseVersion.$inferSelect;

export async function loadVersionDrivers(versionId: string): Promise<DriverRow[]> {
  const drivers = await db()
    .select({
      dv: schema.valueDriverVersion,
      code: schema.valueDriver.code,
      avoName: schema.person.name,
    })
    .from(schema.valueDriverVersion)
    .innerJoin(schema.valueDriver, eq(schema.valueDriver.id, schema.valueDriverVersion.valueDriverId))
    .leftJoin(schema.person, eq(schema.person.id, schema.valueDriverVersion.avoPersonId))
    .where(eq(schema.valueDriverVersion.valueCaseVersionId, versionId))
    .orderBy(asc(schema.valueDriverVersion.sortOrder), asc(schema.valueDriver.code));
  if (drivers.length === 0) return [];

  const driverVersionIds = drivers.map((d) => d.dv.id);
  const assumptions = await db()
    .select()
    .from(schema.assumption)
    .where(inArray(schema.assumption.valueDriverVersionId, driverVersionIds))
    .orderBy(asc(schema.assumption.sortOrder), asc(schema.assumption.createdAt));
  const assumptionIds = assumptions.map((a) => a.id);

  const linkRows = await db()
    .select({
      linkId: schema.evidenceLink.id,
      evidenceId: schema.evidence.id,
      code: schema.evidence.code,
      title: schema.evidence.title,
      relevanceNote: schema.evidenceLink.relevanceNote,
      driverVersionId: schema.evidenceLink.valueDriverVersionId,
      assumptionId: schema.evidenceLink.assumptionId,
    })
    .from(schema.evidenceLink)
    .innerJoin(schema.evidence, eq(schema.evidence.id, schema.evidenceLink.evidenceId))
    .where(inArray(schema.evidenceLink.valueDriverVersionId, driverVersionIds))
    .orderBy(asc(schema.evidence.code));
  const assumptionLinks =
    assumptionIds.length === 0
      ? []
      : await db()
          .select({
            linkId: schema.evidenceLink.id,
            evidenceId: schema.evidence.id,
            code: schema.evidence.code,
            title: schema.evidence.title,
            relevanceNote: schema.evidenceLink.relevanceNote,
            assumptionId: schema.evidenceLink.assumptionId,
          })
          .from(schema.evidenceLink)
          .innerJoin(schema.evidence, eq(schema.evidence.id, schema.evidenceLink.evidenceId))
          .where(inArray(schema.evidenceLink.assumptionId, assumptionIds))
          .orderBy(asc(schema.evidence.code));

  const toLink = (l: EvidenceLinkRow): EvidenceLinkRow => ({
    linkId: l.linkId,
    evidenceId: l.evidenceId,
    code: l.code,
    title: l.title,
    relevanceNote: l.relevanceNote,
  });

  return drivers.map(({ dv, code, avoName }) => {
    const { id, createdAt, ...content } = dv;
    const own = linkRows.filter((l) => l.driverVersionId === id).map(toLink);
    const driverAssumptions = assumptions
      .filter((a) => a.valueDriverVersionId === id)
      .map((a) => ({
        id: a.id,
        statement: a.statement,
        evidenceStatus: a.evidenceStatus,
        notes: a.notes,
        evidence: assumptionLinks.filter((l) => l.assumptionId === a.id).map(toLink),
      }));
    return {
      ...content,
      driverVersionId: id,
      code,
      avoName,
      assumptions: driverAssumptions,
      evidence: own,
      evidenceLinkCount: own.length + driverAssumptions.reduce((n, a) => n + a.evidence.length, 0),
    };
  });
}

export async function listVersions(projectId: string): Promise<VersionRow[]> {
  return db()
    .select()
    .from(schema.valueCaseVersion)
    .where(eq(schema.valueCaseVersion.projectId, projectId))
    .orderBy(asc(schema.valueCaseVersion.versionNumber));
}

// ---------------------------------------------------------------------------
// Value Case timeline

export type TimelineEntry = {
  version: VersionRow;
  summary: DriverSummary;
  /** V0: stated headline; Value Case versions: derived financial total. */
  headlineTotal: string | null;
};

export async function getValueCaseTimeline(projectId: string): Promise<TimelineEntry[]> {
  const versions = await listVersions(projectId);
  return Promise.all(
    versions.map(async (version) => {
      const summary = summariseDrivers(await loadVersionDrivers(version.id));
      const headlineTotal =
        version.kind === "inherited_business_case"
          ? (version.statedTotalValue ?? (summary.financialCount > 0 ? summary.financialTotal : null))
          : summary.driverCount > 0
            ? summary.financialTotal
            : null;
      return { version, summary, headlineTotal };
    }),
  );
}

// ---------------------------------------------------------------------------
// Single version

const authoriser = alias(schema.person, "authoriser");
const recorder = alias(schema.appUser, "recorder");
const proposer = alias(schema.appUser, "proposer");

export async function getVersionDetail(projectId: string, versionNumber: number) {
  const [row] = await db()
    .select({
      version: schema.valueCaseVersion,
      authoriserName: authoriser.name,
      recorderName: recorder.displayName,
      recorderEmail: recorder.email,
      proposerName: proposer.displayName,
      evidenceCode: schema.evidence.code,
      evidenceTitle: schema.evidence.title,
    })
    .from(schema.valueCaseVersion)
    .leftJoin(authoriser, eq(authoriser.id, schema.valueCaseVersion.authorisedByPersonId))
    .leftJoin(recorder, eq(recorder.id, schema.valueCaseVersion.authorisationRecordedBy))
    .leftJoin(proposer, eq(proposer.id, schema.valueCaseVersion.proposedBy))
    .leftJoin(schema.evidence, eq(schema.evidence.id, schema.valueCaseVersion.authorisationEvidenceId))
    .where(
      and(eq(schema.valueCaseVersion.projectId, projectId), eq(schema.valueCaseVersion.versionNumber, versionNumber)),
    );
  if (!row) return null;
  const drivers = await loadVersionDrivers(row.version.id);
  const [basedOn] = row.version.basedOnVersionId
    ? await db()
        .select({ versionNumber: schema.valueCaseVersion.versionNumber, title: schema.valueCaseVersion.title })
        .from(schema.valueCaseVersion)
        .where(eq(schema.valueCaseVersion.id, row.version.basedOnVersionId))
    : [];
  return {
    ...row,
    basedOn: basedOn ?? null,
    drivers,
    summary: summariseDrivers(drivers),
  };
}

export type VersionDetail = NonNullable<Awaited<ReturnType<typeof getVersionDetail>>>;

// ---------------------------------------------------------------------------
// Re-Qualification workspace: inherited V0 against the Re-Qualified version

export type ComparisonRow = {
  driverId: string;
  code: string;
  name: string;
  inherited: DriverRow | null;
  requalified: DriverRow | null;
};

export async function getRequalificationWorkspace(projectId: string) {
  const versions = await listVersions(projectId);
  const inheritedVersion = versions.find((v) => v.kind === "inherited_business_case") ?? null;
  // Re-Qualification is always V1; later versions come from Value Changes.
  const requalifiedVersion = versions.find((v) => v.kind === "value_case" && v.versionNumber === 1) ?? null;

  const inheritedDrivers = inheritedVersion ? await loadVersionDrivers(inheritedVersion.id) : [];
  const requalifiedDrivers = requalifiedVersion ? await loadVersionDrivers(requalifiedVersion.id) : [];

  const ids = [...new Set([...requalifiedDrivers, ...inheritedDrivers].map((d) => d.valueDriverId))];
  const comparison: ComparisonRow[] = ids.map((driverId) => {
    const inherited = inheritedDrivers.find((d) => d.valueDriverId === driverId) ?? null;
    const requalified = requalifiedDrivers.find((d) => d.valueDriverId === driverId) ?? null;
    const either = (requalified ?? inherited)!;
    return { driverId, code: either.code, name: either.name, inherited, requalified };
  });

  const inheritedSummary = summariseDrivers(inheritedDrivers);
  const inheritedTotal =
    inheritedVersion?.statedTotalValue ??
    (inheritedSummary.financialCount > 0 ? inheritedSummary.financialTotal : null);

  const requalifiedSummary = summariseDrivers(requalifiedDrivers);
  // 4D.10E: reasons recorded for Original Business Case drivers not carried into V1.
  const exclusions = requalifiedVersion
    ? await db()
        .select({
          valueDriverId: schema.valueDriverExclusion.valueDriverId,
          adjustmentRationale: schema.valueDriverExclusion.adjustmentRationale,
        })
        .from(schema.valueDriverExclusion)
        .where(eq(schema.valueDriverExclusion.valueCaseVersionId, requalifiedVersion.id))
    : [];
  return {
    exclusions,
    inheritedVersion,
    inheritedDrivers,
    inheritedTotal,
    requalifiedVersion,
    requalifiedDrivers,
    requalifiedSummary,
    /** Re-Qualified total − inherited total (null until both exist). */
    movement:
      requalifiedVersion && requalifiedSummary.driverCount > 0
        ? moneyChange(inheritedTotal, requalifiedSummary.financialTotal)
        : null,
    comparison,
    nextDriverCode: nextCode(
      [...inheritedDrivers, ...requalifiedDrivers].map((d) => d.code),
      "VD",
    ),
  };
}

/** Suggests the next sequential code, e.g. VD-07 after VD-06. */
export function nextCode(existing: readonly string[], prefix: string, width = 2): string {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  const max = existing.reduce((m, c) => Math.max(m, Number(pattern.exec(c)?.[1] ?? 0)), 0);
  return `${prefix}-${String(max + 1).padStart(width, "0")}`;
}
