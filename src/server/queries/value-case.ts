import { eq } from "drizzle-orm";

import { sumMoney, type Money } from "@/domain/money";
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
