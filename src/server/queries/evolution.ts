import { and, eq, inArray } from "drizzle-orm";

import { orderEvolutionEvents } from "@/domain/evolution";
import { sumMoney, toDbMoney } from "@/domain/money";
import type { AssuranceTrigger } from "@/domain/statuses";
import { db, schema } from "@/server/db/client";

import { getAssuranceReviewList } from "./assurance";
import { getVersionTotal, listVersions } from "./value-case";

// Value Case Evolution (Phase 4D.5): the governed history of a project's value position —
// the Original Business Case, each Authorised Value Case version, and each finalised Assurance
// Review's formal Current Forecast and Realised Value. Governed records only: no working estimates,
// no working Value Leakage, no draft/proposed/rejected/withdrawn versions, no draft reviews.
// Amounts are decimal strings exactly as derived by the existing domain code; nothing is
// recalculated here or on the client.

export type EvolutionOriginal = {
  versionNumber: number;
  title: string;
  /** Stated headline of the inherited Business Case (or its driver total); null if not stated. */
  value: string | null;
  /** The Business Case carries no governed date; it is the starting reference point. */
  date: null;
};

export type EvolutionAuthorisation = {
  versionId: string;
  versionNumber: number;
  title: string;
  status: "authorised" | "superseded";
  authorisedValue: string;
  /** Drivers in this version without a financial value (not counted in the total). */
  driversWithoutValue: number;
  /** VCO authorisation date as recorded; null only if never recorded. */
  date: string | null;
  vcoName: string | null;
  /** The Value Change that authorised this version (V2+); null for V1. */
  valueChangeCode: string | null;
};

export type EvolutionPosition = {
  reviewId: string;
  sequence: number;
  date: string;
  trigger: AssuranceTrigger;
  againstVersionNumber: number;
  /** Authorised Value of the version this review was measured against. */
  againstAuthorisedValue: string;
  /** Formal project Current Forecast; null when the review's forecast is incomplete. */
  currentForecast: string | null;
  /** Realised Value recorded at the review (attributed + unattributed); null when none recorded. */
  realisedValue: string | null;
  valueGap: string | null;
};

export type EvolutionEvent =
  | { kind: "original"; key: string; original: EvolutionOriginal }
  | { kind: "authorisation"; key: string; authorisation: EvolutionAuthorisation; inForceValue: string }
  | { kind: "review"; key: string; position: EvolutionPosition; inForceValue: string | null };

export type ValueCaseEvolution = {
  currency: string;
  originalBusinessCase: EvolutionOriginal | null;
  authorisedVersions: EvolutionAuthorisation[];
  formalPositions: EvolutionPosition[];
  /** Ordered governed history; each event carries the Authorised Value in force at that point. */
  events: EvolutionEvent[];
};

export async function getValueCaseEvolution(projectId: string): Promise<ValueCaseEvolution> {
  const [[project], versions, reviews] = await Promise.all([
    db().select({ currency: schema.project.currency }).from(schema.project).where(eq(schema.project.id, projectId)),
    listVersions(projectId),
    getAssuranceReviewList(projectId),
  ]);

  const v0 = versions.find((v) => v.kind === "inherited_business_case" && v.status === "recorded");
  let originalBusinessCase: EvolutionOriginal | null = null;
  if (v0) {
    // As the Value Case timeline does: the stated headline, else the driver total where drivers carry values.
    const valued = (
      await db()
        .select({ value: schema.valueDriverVersion.financialValue })
        .from(schema.valueDriverVersion)
        .where(eq(schema.valueDriverVersion.valueCaseVersionId, v0.id))
    ).flatMap((r) => (r.value === null ? [] : [r.value]));
    originalBusinessCase = {
      versionNumber: v0.versionNumber,
      title: v0.title,
      value: v0.statedTotalValue ?? (valued.length > 0 ? toDbMoney(sumMoney(valued)) : null),
      date: null,
    };
  }

  const governed = versions.filter(
    (v): v is typeof v & { status: "authorised" | "superseded" } =>
      v.kind === "value_case" && (v.status === "authorised" || v.status === "superseded"),
  );
  const ids = governed.map((v) => v.id);
  const personIds = governed.flatMap((v) => (v.authorisedByPersonId ? [v.authorisedByPersonId] : []));
  const [people, changes, totals] = await Promise.all([
    personIds.length
      ? db()
          .select({ id: schema.person.id, name: schema.person.name })
          .from(schema.person)
          .where(inArray(schema.person.id, personIds))
      : Promise.resolve([]),
    ids.length
      ? db()
          .select({ toVersionId: schema.valueChange.toVersionId, code: schema.valueChange.code })
          .from(schema.valueChange)
          .where(and(inArray(schema.valueChange.toVersionId, ids), eq(schema.valueChange.status, "authorised")))
      : Promise.resolve([]),
    Promise.all(governed.map((v) => getVersionTotal(v.id))),
  ]);

  const authorisedVersions: EvolutionAuthorisation[] = governed.map((v, i) => ({
    versionId: v.id,
    versionNumber: v.versionNumber,
    title: v.title,
    status: v.status,
    authorisedValue: toDbMoney(totals[i]!.total),
    driversWithoutValue: totals[i]!.driversWithoutValue,
    date: v.authorisedOn,
    vcoName: people.find((p) => p.id === v.authorisedByPersonId)?.name ?? null,
    valueChangeCode: changes.find((c) => c.toVersionId === v.id)?.code ?? null,
  }));

  const formalPositions: EvolutionPosition[] = reviews
    .filter((r) => r.review.status === "finalised")
    .map((r) => ({
      reviewId: r.review.id,
      sequence: r.review.sequence,
      date: r.review.reviewDate,
      trigger: r.review.trigger,
      againstVersionNumber: r.againstVersionNumber,
      againstAuthorisedValue: r.totals.authorisedTotal,
      currentForecast: r.totals.forecastTotal,
      realisedValue: r.totals.realisedTotal,
      valueGap: r.totals.valueGap,
    }));

  const events: EvolutionEvent[] = [];
  if (originalBusinessCase) events.push({ kind: "original", key: "original", original: originalBusinessCase });
  let inForce: string | null = null;
  for (const e of orderEvolutionEvents(authorisedVersions, formalPositions)) {
    if (e.kind === "authorisation") {
      inForce = e.item.authorisedValue;
      events.push({
        kind: "authorisation",
        key: `v${e.item.versionNumber}`,
        authorisation: e.item,
        inForceValue: inForce,
      });
    } else {
      events.push({ kind: "review", key: `r${e.item.sequence}`, position: e.item, inForceValue: inForce });
    }
  }

  return { currency: project?.currency ?? "USD", originalBusinessCase, authorisedVersions, formalPositions, events };
}
