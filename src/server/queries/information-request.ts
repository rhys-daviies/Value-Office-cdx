import { asc, eq } from "drizzle-orm";

import { db, schema } from "@/server/db/client";

import { listStakeholders } from "./mobilise";

export async function listDriverOptions(projectId: string) {
  // Driver identities with their most recent name.
  const rows = await db()
    .select({
      driverId: schema.valueDriver.id,
      code: schema.valueDriver.code,
      name: schema.valueDriverVersion.name,
      versionNumber: schema.valueCaseVersion.versionNumber,
    })
    .from(schema.valueDriver)
    .innerJoin(schema.valueDriverVersion, eq(schema.valueDriverVersion.valueDriverId, schema.valueDriver.id))
    .innerJoin(schema.valueCaseVersion, eq(schema.valueCaseVersion.id, schema.valueDriverVersion.valueCaseVersionId))
    .where(eq(schema.valueDriver.projectId, projectId))
    .orderBy(asc(schema.valueDriver.code), asc(schema.valueCaseVersion.versionNumber));
  const latest = new Map<string, { driverId: string; code: string; name: string }>();
  for (const r of rows) latest.set(r.driverId, { driverId: r.driverId, code: r.code, name: r.name });
  return [...latest.values()];
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
      driverCode: schema.valueDriver.code,
      evidenceCode: schema.evidence.code,
      evidenceTitle: schema.evidence.title,
    })
    .from(schema.informationRequestItem)
    .leftJoin(schema.person, eq(schema.person.id, schema.informationRequestItem.requestedFromPersonId))
    .leftJoin(schema.valueDriver, eq(schema.valueDriver.id, schema.informationRequestItem.valueDriverId))
    .leftJoin(schema.evidence, eq(schema.evidence.id, schema.informationRequestItem.fulfilledByEvidenceId))
    .where(eq(schema.informationRequestItem.projectId, projectId))
    .orderBy(asc(schema.informationRequestItem.sequence));

  const [stakeholders, drivers, evidence] = await Promise.all([
    listStakeholders(projectId),
    listDriverOptions(projectId),
    listEvidenceOptions(projectId),
  ]);

  return {
    requests: requests.map((r) => ({ request: r, items: items.filter((i) => i.item.informationRequestId === r.id) })),
    stakeholders,
    drivers,
    evidence,
  };
}

export type InformationRequestWorkspace = Awaited<ReturnType<typeof getInformationRequestWorkspace>>;
