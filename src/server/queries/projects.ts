import { asc, count, eq, sql } from "drizzle-orm";

import { INFORMATION_REQUEST_ITEM_STATUSES } from "@/domain/statuses";
import { db, schema } from "@/server/db/client";

import { getValueCaseTimeline } from "./value-case";

export type ProjectListRow = Awaited<ReturnType<typeof listProjects>>[number];

export async function listProjects() {
  const projects = await db()
    .select({ project: schema.project, clientName: schema.client.name })
    .from(schema.project)
    .innerJoin(schema.client, eq(schema.client.id, schema.project.clientId))
    .orderBy(asc(schema.client.name), asc(schema.project.name));

  const versions = await db()
    .select({
      projectId: schema.valueCaseVersion.projectId,
      versionNumber: schema.valueCaseVersion.versionNumber,
      kind: schema.valueCaseVersion.kind,
      status: schema.valueCaseVersion.status,
    })
    .from(schema.valueCaseVersion)
    .orderBy(asc(schema.valueCaseVersion.versionNumber));
  const dates = await db()
    .select()
    .from(schema.keyDate)
    .where(sql`${schema.keyDate.kind} in ('kickoff', 'go_live')`);

  return projects.map(({ project, clientName }) => ({
    ...project,
    clientName,
    latestVersion: versions.filter((v) => v.projectId === project.id).at(-1) ?? null,
    kickoffDate: dates.find((d) => d.projectId === project.id && d.kind === "kickoff")?.date ?? null,
    goLiveDate: dates.find((d) => d.projectId === project.id && d.kind === "go_live")?.date ?? null,
  }));
}

export async function listClients() {
  return db().select().from(schema.client).orderBy(asc(schema.client.name));
}

/** Project + client + Value Basis lock state: shared by every project page. */
export async function getProjectHeader(projectId: string) {
  const [row] = await db()
    .select({ project: schema.project, clientName: schema.client.name, valueCase: schema.valueCase })
    .from(schema.project)
    .innerJoin(schema.client, eq(schema.client.id, schema.project.clientId))
    .innerJoin(schema.valueCase, eq(schema.valueCase.projectId, schema.project.id))
    .where(eq(schema.project.id, projectId));
  if (!row) return null;
  const [locked] = await db()
    .select({ n: count() })
    .from(schema.valueCaseVersion)
    .where(
      sql`${schema.valueCaseVersion.projectId} = ${projectId} and ${schema.valueCaseVersion.status} in ('proposed', 'authorised', 'superseded')`,
    );
  return { ...row, valueBasisLocked: (locked?.n ?? 0) > 0 };
}

export type ProjectHeader = NonNullable<Awaited<ReturnType<typeof getProjectHeader>>>;

export async function getProjectOverview(projectId: string) {
  const header = await getProjectHeader(projectId);
  if (!header) return null;

  const stakeholders = await db()
    .select({ personId: schema.person.id, name: schema.person.name, role: schema.projectStakeholder.roleDescription })
    .from(schema.projectStakeholder)
    .innerJoin(schema.person, eq(schema.person.id, schema.projectStakeholder.personId))
    .where(eq(schema.projectStakeholder.projectId, projectId))
    .orderBy(asc(schema.person.name));
  const vco = stakeholders.find((s) => s.personId === header.valueCase.vcoPersonId) ?? null;

  const keyDates = await db()
    .select()
    .from(schema.keyDate)
    .where(eq(schema.keyDate.projectId, projectId))
    .orderBy(asc(schema.keyDate.date));

  const requests = await db()
    .select()
    .from(schema.informationRequest)
    .where(eq(schema.informationRequest.projectId, projectId))
    .orderBy(asc(schema.informationRequest.createdAt));
  const itemCounts = await db()
    .select({ status: schema.informationRequestItem.status, n: count() })
    .from(schema.informationRequestItem)
    .where(eq(schema.informationRequestItem.projectId, projectId))
    .groupBy(schema.informationRequestItem.status);
  const irItems = Object.fromEntries(
    INFORMATION_REQUEST_ITEM_STATUSES.map((s) => [s, itemCounts.find((c) => c.status === s)?.n ?? 0]),
  ) as Record<(typeof INFORMATION_REQUEST_ITEM_STATUSES)[number], number>;

  const [evidence] = await db()
    .select({ n: count() })
    .from(schema.evidence)
    .where(eq(schema.evidence.projectId, projectId));
  const [documents] = await db()
    .select({ n: count() })
    .from(schema.document)
    .where(eq(schema.document.projectId, projectId));

  const timeline = await getValueCaseTimeline(projectId);
  const inherited = timeline.find((t) => t.version.kind === "inherited_business_case") ?? null;
  const requalified = timeline.filter((t) => t.version.kind === "value_case").at(-1) ?? null;

  return {
    header,
    stakeholders,
    vco,
    keyDates,
    requests,
    irItems,
    evidenceCount: evidence?.n ?? 0,
    documentCount: documents?.n ?? 0,
    inherited,
    requalified,
    nextStep: nextStep({
      hasValueBasis: Boolean(header.project.valueBasisDescription),
      hasVco: Boolean(vco),
      hasInformationRequest: requests.length > 0,
      inheritedStatus: inherited?.version.status ?? null,
      requalifiedStatus: requalified?.version.status ?? null,
      requalifiedDriverCount: requalified?.summary.driverCount ?? 0,
    }),
  };
}

export type ProjectOverview = NonNullable<Awaited<ReturnType<typeof getProjectOverview>>>;

/** Workflow guidance only: the next thing the state machine needs, in journey order. */
export function nextStep(s: {
  hasValueBasis: boolean;
  hasVco: boolean;
  hasInformationRequest: boolean;
  inheritedStatus: string | null;
  requalifiedStatus: string | null;
  requalifiedDriverCount: number;
}): { label: string; href: string } | null {
  if (s.requalifiedStatus === "authorised") return null;
  if (s.requalifiedStatus === "proposed") {
    return s.hasVco
      ? { label: "Record the VCO's authorisation of the proposed Value Case", href: "requalification#authorise" }
      : { label: "Nominate the Value Case Owner (needed to record authorisation)", href: "setup#stakeholders" };
  }
  if (!s.hasValueBasis) return { label: "Define the Value Basis", href: "setup#value-basis" };
  if (!s.hasVco) return { label: "Nominate the Value Case Owner", href: "setup#stakeholders" };
  if (!s.hasInformationRequest) return { label: "Create the Information Request", href: "information-request" };
  if (s.inheritedStatus === null) return { label: "Capture the inherited Business Case (V0)", href: "value-case" };
  if (s.inheritedStatus === "draft")
    return { label: "Finish and record the inherited Business Case (V0)", href: "value-case/v/0" };
  if (s.requalifiedStatus === null)
    return { label: "Create the draft Re-Qualified Value Case (V1)", href: "requalification" };
  if (s.requalifiedDriverCount === 0) return { label: "Add Value Drivers to the draft V1", href: "requalification" };
  return { label: "Complete Re-Qualification and propose V1", href: "requalification" };
}
