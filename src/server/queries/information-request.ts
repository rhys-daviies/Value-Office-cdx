import { and, asc, eq } from "drizzle-orm";

import { db, schema } from "@/server/db/client";

import { listStakeholders } from "./mobilise";

export async function listDriverOptions(projectId: string) {
  // Driver identities named as in the CURRENT AUTHORISED Value Case (Phase 4D.13) — a pending draft's renaming is not
  // the operational name. A driver outside the authorised version takes its latest governed name, else its only one.
  const rows = await db()
    .select({
      driverId: schema.valueDriver.id,
      code: schema.valueDriver.code,
      name: schema.valueDriverVersion.name,
      versionNumber: schema.valueCaseVersion.versionNumber,
      versionStatus: schema.valueCaseVersion.status,
    })
    .from(schema.valueDriver)
    .innerJoin(schema.valueDriverVersion, eq(schema.valueDriverVersion.valueDriverId, schema.valueDriver.id))
    .innerJoin(schema.valueCaseVersion, eq(schema.valueCaseVersion.id, schema.valueDriverVersion.valueCaseVersionId))
    .where(eq(schema.valueDriver.projectId, projectId))
    .orderBy(asc(schema.valueDriver.code), asc(schema.valueCaseVersion.versionNumber));
  const rank = (status: string) => (status === "authorised" ? 2 : status === "draft" || status === "proposed" ? 0 : 1);
  const chosen = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const prev = chosen.get(r.driverId); // rows arrive in ascending version order: later wins within the same rank
    if (!prev || rank(r.versionStatus) >= rank(prev.versionStatus)) chosen.set(r.driverId, r);
  }
  return [...chosen.values()].map((r) => ({ driverId: r.driverId, code: r.code, name: r.name }));
}

export async function listEvidenceOptions(projectId: string) {
  return db()
    .select({ id: schema.evidence.id, code: schema.evidence.code, title: schema.evidence.title })
    .from(schema.evidence)
    .where(eq(schema.evidence.projectId, projectId))
    .orderBy(asc(schema.evidence.code));
}

export async function getInformationRequestWorkspace(projectId: string) {
  const requests = await db()
    .select()
    .from(schema.informationRequest)
    .where(eq(schema.informationRequest.projectId, projectId))
    .orderBy(asc(schema.informationRequest.createdAt));

  const items = await db()
    .select({
      item: schema.informationRequestItem,
      requestedFromName: schema.person.name,
      requestedFromRole: schema.projectStakeholder.roleDescription,
      driverCode: schema.valueDriver.code,
      evidenceCode: schema.evidence.code,
      evidenceTitle: schema.evidence.title,
      matter: { id: schema.valueLeakage.id, code: schema.valueLeakage.code, title: schema.valueLeakage.title },
    })
    .from(schema.informationRequestItem)
    .leftJoin(schema.person, eq(schema.person.id, schema.informationRequestItem.requestedFromPersonId))
    .leftJoin(
      schema.projectStakeholder,
      and(
        eq(schema.projectStakeholder.projectId, schema.informationRequestItem.projectId),
        eq(schema.projectStakeholder.personId, schema.informationRequestItem.requestedFromPersonId),
      ),
    )
    .leftJoin(schema.valueDriver, eq(schema.valueDriver.id, schema.informationRequestItem.valueDriverId))
    .leftJoin(schema.evidence, eq(schema.evidence.id, schema.informationRequestItem.fulfilledByEvidenceId))
    .leftJoin(schema.valueLeakage, eq(schema.valueLeakage.id, schema.informationRequestItem.valueLeakageId))
    .where(eq(schema.informationRequestItem.projectId, projectId))
    .orderBy(asc(schema.informationRequestItem.sequence));

  const [stakeholders, drivers, evidence, openMatters] = await Promise.all([
    listStakeholders(projectId),
    listDriverOptions(projectId),
    listEvidenceOptions(projectId),
    db()
      .select({ id: schema.valueLeakage.id, code: schema.valueLeakage.code, title: schema.valueLeakage.title })
      .from(schema.valueLeakage)
      .where(and(eq(schema.valueLeakage.projectId, projectId), eq(schema.valueLeakage.status, "open")))
      .orderBy(asc(schema.valueLeakage.code)),
  ]);

  return {
    requests: requests.map((r) => ({ request: r, items: items.filter((i) => i.item.informationRequestId === r.id) })),
    stakeholders,
    drivers,
    evidence,
    openMatters,
  };
}

export type InformationRequestWorkspace = Awaited<ReturnType<typeof getInformationRequestWorkspace>>;
