import { and, asc, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/server/db/client";

import type { ValueCaseEvolution } from "./evolution";

// Value Case governance summary (Phase 4D.9H): the compact Overview treatment that replaced the full Value Case
// Evolution chart there. Derived from the governed Evolution read model (authorised versions, Original Business Case,
// the Value Change that authorised each version) plus open (draft / proposed) Value Changes, which are shown only as
// pending — never as the commitment. No amounts are recalculated.

export type ValueCaseSummary = {
  currency: string;
  /** The version currently in force (status authorised); null before V1 is authorised. */
  current: { versionNumber: number; authorisedValue: string; authorisedOn: string | null } | null;
  /** Inherited Original Business Case (V0); null when none was recorded. `value` null = recorded without a value. */
  originalBusinessCase: { value: string | null } | null;
  /** Authorised versions created by an authorised Value Change (V2+). */
  authorisedChangeCount: number;
  latestAuthorisedChange: { code: string; versionNumber: number; authorisedOn: string | null } | null;
  /** Draft or proposed Value Changes: pending, not in force. */
  pending: { id: string; code: string; status: "draft" | "proposed"; toVersionNumber: number }[];
};

export async function getValueCaseSummary(projectId: string, evolution: ValueCaseEvolution): Promise<ValueCaseSummary> {
  const open = await db()
    .select({
      id: schema.valueChange.id,
      code: schema.valueChange.code,
      status: schema.valueChange.status,
      toVersionNumber: schema.valueCaseVersion.versionNumber,
    })
    .from(schema.valueChange)
    .innerJoin(schema.valueCaseVersion, eq(schema.valueCaseVersion.id, schema.valueChange.toVersionId))
    .where(and(eq(schema.valueChange.projectId, projectId), inArray(schema.valueChange.status, ["draft", "proposed"])))
    .orderBy(asc(schema.valueChange.code));
  const inForce = evolution.authorisedVersions.find((v) => v.status === "authorised") ?? null;
  const changed = evolution.authorisedVersions.filter((v) => v.valueChangeCode !== null);
  const latest = changed.at(-1) ?? null;
  return {
    currency: evolution.currency,
    current: inForce
      ? { versionNumber: inForce.versionNumber, authorisedValue: inForce.authorisedValue, authorisedOn: inForce.date }
      : null,
    originalBusinessCase: evolution.originalBusinessCase ? { value: evolution.originalBusinessCase.value } : null,
    authorisedChangeCount: changed.length,
    latestAuthorisedChange: latest
      ? { code: latest.valueChangeCode!, versionNumber: latest.versionNumber, authorisedOn: latest.date }
      : null,
    pending: open.map((c) => ({
      id: c.id,
      code: c.code,
      status: c.status as "draft" | "proposed",
      toVersionNumber: c.toVersionNumber,
    })),
  };
}
