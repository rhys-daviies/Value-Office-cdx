import { asc, eq } from "drizzle-orm";

import { db, schema } from "@/server/db/client";

export type StakeholderRow = Awaited<ReturnType<typeof listStakeholders>>[number];

export async function listStakeholders(projectId: string) {
  return db()
    .select({
      personId: schema.person.id,
      name: schema.person.name,
      title: schema.person.title,
      organisation: schema.person.organisation,
      email: schema.person.email,
      roleDescription: schema.projectStakeholder.roleDescription,
    })
    .from(schema.projectStakeholder)
    .innerJoin(schema.person, eq(schema.person.id, schema.projectStakeholder.personId))
    .where(eq(schema.projectStakeholder.projectId, projectId))
    .orderBy(asc(schema.person.name));
}

export async function listDocuments(projectId: string) {
  return db()
    .select({ document: schema.document, sourcePersonName: schema.person.name })
    .from(schema.document)
    .leftJoin(schema.person, eq(schema.person.id, schema.document.sourcePersonId))
    .where(eq(schema.document.projectId, projectId))
    .orderBy(asc(schema.document.createdAt));
}

export async function getMobiliseWorkspace(projectId: string) {
  const [stakeholders, keyDates, documents] = await Promise.all([
    listStakeholders(projectId),
    db().select().from(schema.keyDate).where(eq(schema.keyDate.projectId, projectId)).orderBy(asc(schema.keyDate.date)),
    listDocuments(projectId),
  ]);
  return { stakeholders, keyDates, documents };
}
