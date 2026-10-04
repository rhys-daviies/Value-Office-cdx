import { asc, count, eq, sql } from "drizzle-orm";

import { deriveMobilisationStatus } from "@/domain/mobilisation";
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
    // The version in force if there is one (a later proposed V2 does not replace it), else the latest.
    latestVersion:
      versions.find((v) => v.projectId === project.id && v.status === "authorised") ??
      versions.filter((v) => v.projectId === project.id).at(-1) ??
      null,
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
  // The defined Value Case is V1; later versions are Value Changes (shown in Assurance / Changes).
  const requalified = timeline.find((t) => t.version.kind === "value_case" && t.version.versionNumber === 1) ?? null;
  // A version is superseded only after it was authorised, so authorised-or-superseded means "ever authorised".
  const everAuthorised = timeline.some(
    (t) => t.version.kind === "value_case" && (t.version.status === "authorised" || t.version.status === "superseded"),
  );

  // Mobilisation-purpose requests (legacy requests without a purpose read as Mobilisation), with their items.
  const requestItems = await db()
    .select({
      requestId: schema.informationRequestItem.informationRequestId,
      status: schema.informationRequestItem.status,
      description: schema.informationRequestItem.description,
    })
    .from(schema.informationRequestItem)
    .where(eq(schema.informationRequestItem.projectId, projectId));
  const mobilisationRequests = requests
    .filter((r) => r.purpose === null || r.purpose === "mobilisation")
    .map((r) => {
      const items = requestItems.filter((i) => i.requestId === r.id);
      return {
        id: r.id,
        reference: r.reference,
        title: r.title,
        status: r.status,
        items: items.length,
        outstanding: items.filter((i) => i.status === "open" || i.status === "partially_received").length,
        descriptions: items.map((i) => i.description),
      };
    });

  const kickoff = keyDates.find((d) => d.kind === "kickoff") ?? null;
  const goLive = keyDates.find((d) => d.kind === "go_live") ?? null;
  const inForce = timeline.find((t) => t.version.kind === "value_case" && t.version.status === "authorised") ?? null;
  const v1 = requalified;
  const mobilisation = deriveMobilisationStatus({
    everAuthorised,
    inForceVersionNumber: inForce?.version.versionNumber ?? null,
    hasValueBasis: Boolean(header.project.valueBasisDescription),
    hasValuePeriod: Boolean(header.project.valuePeriodStart && header.project.valuePeriodEnd),
    vcoName: vco?.name ?? null,
    kickoffDate: kickoff?.date ?? null,
    goLiveDate: goLive?.date ?? null,
    requests: mobilisationRequests,
    originalBusinessCase:
      inherited?.version.status === "draft" || inherited?.version.status === "recorded"
        ? inherited.version.status
        : null,
    v1: v1
      ? {
          status: v1.version.status,
          driverCount: v1.summary.driverCount,
          unqualified: v1.summary.qualification.unqualified,
          unevidenced: v1.summary.evidence.unevidenced,
        }
      : null,
  });

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
    /** Derived Mobilisation status (4D.10C): one source for the Mobilisation page and the pre-V1 Overview. */
    mobilisation,
    /** The first Mobilisation request — the Day-1 Information Request, if one exists. */
    dayOneRequest: mobilisationRequests[0] ?? null,
    nextStep: mobilisation.next,
  };
}

export type ProjectOverview = NonNullable<Awaited<ReturnType<typeof getProjectOverview>>>;

/** The derived Mobilisation status and the Day-1 request, for the Mobilisation page. */
export async function getMobilisationStatus(projectId: string) {
  const o = await getProjectOverview(projectId);
  if (!o) return null;
  return {
    status: o.mobilisation,
    dayOneRequest: o.dayOneRequest,
    allReferences: o.requests.map((r) => r.reference),
    originalBusinessCase: o.inherited
      ? {
          status: o.inherited.version.status,
          title: o.inherited.version.title,
          headlineTotal: o.inherited.headlineTotal,
        }
      : null,
  };
}
