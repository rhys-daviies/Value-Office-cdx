import { and, count, eq, inArray, isNotNull } from "drizzle-orm";

import { type AttentionItem, deriveMatterAttention, todayIso } from "@/domain/attention";
import { summariseLeakage } from "@/domain/response";
import { ASSURANCE_STAGES, type AssuranceStage } from "@/domain/statuses";
import { db, schema } from "@/server/db/client";

import { getAssuranceWorkspace, getNextAssuranceRequirement, getValuePositionSummary } from "./assurance";
import { getDriverRegister } from "./drivers";
import { getContinuousAssurance, getResponseSummary, type LeakageEntry } from "./response";
import { loadVersionDrivers } from "./value-case";

// Phase 4D.4 operating read models. They assemble what already exists — governed figures from the
// Authorised Value Case and finalised reviews, working figures from living matters and drivers — and
// keep the two apart: a working sum is never added to, netted against or shown as a formal figure.

export type WorkspaceMatter = {
  entry: LeakageEntry;
  evidenceCount: number;
  requestsOutstanding: number;
  requestsTotal: number;
  attention: AttentionItem[];
  /** Any attention condition other than "not yet quantified" (which is reported on its own). */
  needsAttention: boolean;
};

export type StageFilter = "all" | AssuranceStage;

/** The Continuous Assurance workspace: every open matter with evidence, requests and attention. */
export async function getContinuousAssuranceWorkspace(projectId: string, today = todayIso()) {
  const continuous = await getContinuousAssurance(projectId);
  const ids = continuous.open.map((e) => e.leakage.id);
  const [evidence, requests] = ids.length
    ? await Promise.all([
        db()
          .select({ id: schema.evidenceLink.valueLeakageId, n: count() })
          .from(schema.evidenceLink)
          .where(inArray(schema.evidenceLink.valueLeakageId, ids))
          .groupBy(schema.evidenceLink.valueLeakageId),
        db()
          .select({
            id: schema.informationRequestItem.valueLeakageId,
            status: schema.informationRequestItem.status,
            n: count(),
          })
          .from(schema.informationRequestItem)
          .where(inArray(schema.informationRequestItem.valueLeakageId, ids))
          .groupBy(schema.informationRequestItem.valueLeakageId, schema.informationRequestItem.status),
      ])
    : [[], []];

  const matters: WorkspaceMatter[] = continuous.open.map((entry) => {
    const id = entry.leakage.id;
    const mine = requests.filter((r) => r.id === id);
    const attention = deriveMatterAttention(
      {
        stage: entry.leakage.stage,
        ownerPersonId: entry.leakage.responseOwnerPersonId,
        quantified: entry.working !== null,
        requiredDecisionDate: entry.leakage.requiredDecisionDate,
        monitorUntil: entry.leakage.monitorUntil,
      },
      today,
    );
    return {
      entry,
      evidenceCount: evidence.find((e) => e.id === id)?.n ?? 0,
      requestsOutstanding: mine
        .filter((r) => r.status === "open" || r.status === "partially_received")
        .reduce((s, r) => s + r.n, 0),
      requestsTotal: mine.reduce((s, r) => s + r.n, 0),
      attention,
      needsAttention: attention.some((a) => a.kind !== "unquantified"),
    };
  });

  // WORKING view only: quantified open matters are summed; unquantified ones are counted, never zeroed.
  const working = summariseLeakage(continuous.open.map((e) => ({ amounts: e.working })));
  const has = (kind: AttentionItem["kind"]) => matters.filter((m) => m.attention.some((a) => a.kind === kind)).length;

  return {
    today,
    matters,
    closedCount: continuous.closed.length,
    nextCode: continuous.nextCode,
    working: {
      openCount: working.itemCount,
      quantifiedCount: working.assessedCount,
      unquantifiedCount: working.itemCount - working.assessedCount,
      total: working.total,
      recoverable: working.recoverable,
      unrecoverable: working.unrecoverable,
    },
    stageCounts: Object.fromEntries(
      ASSURANCE_STAGES.map((s) => [s, matters.filter((m) => m.entry.leakage.stage === s).length]),
    ) as Record<AssuranceStage, number>,
    attention: {
      needsAttention: matters.filter((m) => m.needsAttention).length,
      escalated: has("escalated"),
      awaitingEvidence: has("awaiting_evidence"),
      noOwner: has("no_owner"),
      decisionDates: has("decision_overdue") + has("decision_approaching"),
      monitorDates: has("monitor_ended") + has("monitor_ending"),
    },
  };
}

export type ContinuousAssuranceWorkspace = Awaited<ReturnType<typeof getContinuousAssuranceWorkspace>>;

/** Overview: the governed position, the working picture and what is pending — side by side, never merged. */
export async function getOverviewValueOfficeState(projectId: string, today = todayIso()) {
  const [position, cadence, response, workspace, drivers, pendingChanges] = await Promise.all([
    getValuePositionSummary(projectId),
    getNextAssuranceRequirement(projectId),
    getResponseSummary(projectId),
    getContinuousAssuranceWorkspace(projectId, today),
    getDriverRegister(projectId),
    db()
      .select({ id: schema.valueChange.id, code: schema.valueChange.code, status: schema.valueChange.status })
      .from(schema.valueChange)
      .where(
        and(eq(schema.valueChange.projectId, projectId), inArray(schema.valueChange.status, ["draft", "proposed"])),
      ),
  ]);
  const [evidence] = await db()
    .select({ n: count() })
    .from(schema.evidenceLink)
    .where(and(eq(schema.evidenceLink.projectId, projectId), isNotNull(schema.evidenceLink.valueLeakageId)));
  return {
    position,
    cadence,
    response,
    workspace,
    lastReview: position.reviews.at(-1) ?? null,
    drivers: {
      inValueCase: drivers.entries.filter((e) => e.status === "in_value_case").length,
      emerging: drivers.entries.filter((e) => e.presentation === "emerging").length,
      outsideCurrent: drivers.entries.filter((e) => e.presentation === "outside_current").length,
    },
    pendingChanges,
    matterEvidenceLinks: evidence?.n ?? 0,
  };
}

export type OverviewValueOfficeState = Awaited<ReturnType<typeof getOverviewValueOfficeState>>;

/**
 * Value Case page (Phase 4D.4): what management has formally committed to — the authorised version
 * in force, its drivers as authorised, who authorised it, and (where a finalised review measured this
 * version) the latest formal forecast per driver. Governed data only; no living-record fields.
 */
export async function getGovernedCommitment(projectId: string) {
  const summary = await getValuePositionSummary(projectId);
  const version = summary.authorised;
  if (!version) return null;
  const [drivers, authoriser] = await Promise.all([
    loadVersionDrivers(version.id),
    version.authorisedByPersonId
      ? db()
          .select({ name: schema.person.name })
          .from(schema.person)
          .where(eq(schema.person.id, version.authorisedByPersonId))
      : Promise.resolve([]),
  ]);
  const latest = summary.latest?.review.againstVersionId === version.id ? summary.latest : null;
  const rows = latest ? ((await getAssuranceWorkspace(projectId, latest.review.id))?.rows ?? []) : [];
  return {
    version,
    authorisedTotal: summary.authorisedTotal,
    authorisedByName: authoriser[0]?.name ?? null,
    latestReview: latest
      ? { id: latest.review.id, sequence: latest.review.sequence, date: latest.review.reviewDate }
      : null,
    forecastTotal: latest?.totals.forecastTotal ?? null,
    drivers: drivers.map((d) => {
      const row = rows.find((r) => r.valueDriverId === d.valueDriverId);
      return {
        driver: d,
        forecast: row ? { value: row.currentForecast, notAssessed: row.forecastNotAssessed } : null,
      };
    }),
  };
}
