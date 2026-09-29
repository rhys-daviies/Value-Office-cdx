import { notFound } from "next/navigation";

import { requireConsultant } from "@/server/auth/actor";
import { getProjectHeader } from "@/server/queries/projects";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** Loads the project header or renders 404 (including for malformed ids). */
export async function requireProject(projectId: string) {
  await requireConsultant();
  if (!isUuid(projectId)) notFound();
  const header = await getProjectHeader(projectId);
  if (!header) notFound();
  return header;
}
