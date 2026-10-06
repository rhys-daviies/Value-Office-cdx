import { and, eq, max } from "drizzle-orm";
import { z } from "zod";

import { DomainError } from "@/domain/errors";
import { VALUE_CHANGE_DETERMINATIONS } from "@/domain/statuses";
import { schema, type Tx } from "@/server/db/client";

import { COMMANDS } from "./names";
import { defineCommand } from "./run";
import {
  clearableMoney,
  clearableText,
  clearableUuid,
  isoDate,
  moneyString,
  nonBlank,
  optionalText,
  uuid,
} from "./schemas";
import { copyVersionContents } from "./value-case";

// Value Change: the only path to Authorised V2+ (PMO). A change references the
// Authorised version in force and a copy-forward draft of it; the consultant
// adjusts the affected drivers; the VCO's authorisation is recorded with
// evidence and, atomically, supersedes the old version and authorises the new
// one. Forecast movement never creates a version. The version guard and the
// Value Change guard in drizzle/0006 enforce the same rules in the database.

async function getChange(tx: Tx, changeId: string) {
  const [row] = await tx.select().from(schema.valueChange).where(eq(schema.valueChange.id, changeId)).for("update");
  if (!row) throw new DomainError("VO_NOT_FOUND", "Value Change not found");
  return row;
}

async function setVersionStatus(
  tx: Tx,
  versionId: string,
  values: Partial<typeof schema.valueCaseVersion.$inferInsert>,
) {
  const [row] = await tx
    .update(schema.valueCaseVersion)
    .set(values)
    .where(eq(schema.valueCaseVersion.id, versionId))
    .returning();
  return row!;
}

/**
 * Phase 4D.10H: after the management decision, records whether the Authorised Value Case must change — No Value
 * Change Required or Value Change Proposed — with a rationale. Once per decision; it never creates, calculates or
 * authorises a Value Change and never writes to the Value Case.
 */
export const determineValueCaseImpact = defineCommand(
  COMMANDS.determineValueCaseImpact,
  z.object({ reviewId: uuid, determination: z.enum(VALUE_CHANGE_DETERMINATIONS), rationale: nonBlank }),
  async ({ tx, actor }, input) => {
    const [decision] = await tx
      .select()
      .from(schema.decision)
      .where(eq(schema.decision.assuranceReviewId, input.reviewId));
    if (!decision) {
      throw new DomainError(
        "VO_DECISION_REQUIRED",
        "Record the management decision before determining its Value Case impact",
      );
    }
    const [existing] = await tx
      .select({ id: schema.valueChangeDetermination.id })
      .from(schema.valueChangeDetermination)
      .where(eq(schema.valueChangeDetermination.decisionId, decision.id));
    if (existing) {
      throw new DomainError("VO_DETERMINATION_EXISTS", "The Value Case impact of this decision is already determined");
    }
    const [row] = await tx
      .insert(schema.valueChangeDetermination)
      .values({
        projectId: decision.projectId,
        assuranceReviewId: decision.assuranceReviewId,
        decisionId: decision.id,
        determination: input.determination,
        rationale: input.rationale,
        createdBy: actor.userId,
      })
      .returning();
    return row!;
  },
);

/** Opens a draft Value Change and its copy-forward draft version (V<n+1>). */
export const createValueChange = defineCommand(
  COMMANDS.createValueChange,
  z.object({
    projectId: uuid,
    code: nonBlank,
    reason: optionalText,
    economicImpactNarrative: optionalText,
    statedChangeAmount: moneyString.optional(),
    assuranceReviewId: uuid.optional(),
    decisionId: uuid.optional(),
  }),
  async ({ tx, actor }, input) => {
    const [valueCase] = await tx
      .select()
      .from(schema.valueCase)
      .where(eq(schema.valueCase.projectId, input.projectId))
      .for("update");
    if (!valueCase) throw new DomainError("VO_NOT_FOUND", "Value Case not found");
    const [inForce] = await tx
      .select()
      .from(schema.valueCaseVersion)
      .where(
        and(eq(schema.valueCaseVersion.valueCaseId, valueCase.id), eq(schema.valueCaseVersion.status, "authorised")),
      );
    if (!inForce) {
      throw new DomainError("VO_NO_AUTHORISED_VERSION", "A Value Change starts from an Authorised Value Case");
    }
    const [open] = await tx
      .select({ code: schema.valueChange.code })
      .from(schema.valueChange)
      .where(and(eq(schema.valueChange.valueCaseId, valueCase.id), eq(schema.valueChange.status, "draft")));
    const [proposed] = await tx
      .select({ code: schema.valueChange.code })
      .from(schema.valueChange)
      .where(and(eq(schema.valueChange.valueCaseId, valueCase.id), eq(schema.valueChange.status, "proposed")));
    if (open || proposed) {
      throw new DomainError(
        "VO_VALUE_CHANGE_OPEN",
        `${(open ?? proposed)!.code} is still open — authorise, reject or withdraw it first`,
      );
    }

    const [{ last } = { last: null }] = await tx
      .select({ last: max(schema.valueCaseVersion.versionNumber) })
      .from(schema.valueCaseVersion)
      .where(eq(schema.valueCaseVersion.valueCaseId, valueCase.id));
    const [version] = await tx
      .insert(schema.valueCaseVersion)
      .values({
        valueCaseId: valueCase.id,
        projectId: input.projectId,
        versionNumber: (last ?? 1) + 1,
        kind: "value_case",
        title: `Value Case (${input.code})`,
        basedOnVersionId: inForce.id,
        createdBy: actor.userId,
        // Phase 4D.9: the commitment's basis kind and Value Period carry forward; re-phasing is edited on the draft.
        valueBasisKind: inForce.valueBasisKind,
        valuePeriodStart: inForce.valuePeriodStart,
        valuePeriodEnd: inForce.valuePeriodEnd,
      })
      .returning();
    await copyVersionContents(tx, inForce.id, version!.id);
    const plan = await tx
      .select()
      .from(schema.valueTrajectoryPoint)
      .where(eq(schema.valueTrajectoryPoint.valueCaseVersionId, inForce.id));
    if (plan.length) {
      await tx.insert(schema.valueTrajectoryPoint).values(
        plan.map((p) => ({
          projectId: p.projectId,
          valueCaseVersionId: version!.id,
          asOf: p.asOf,
          value: p.value,
          note: p.note,
          createdBy: actor.userId,
        })),
      );
    }

    const [change] = await tx
      .insert(schema.valueChange)
      .values({
        projectId: input.projectId,
        valueCaseId: valueCase.id,
        code: input.code,
        fromVersionId: inForce.id,
        toVersionId: version!.id,
        reason: input.reason,
        economicImpactNarrative: input.economicImpactNarrative,
        statedChangeAmount: input.statedChangeAmount,
        assuranceReviewId: input.assuranceReviewId,
        decisionId: input.decisionId,
        createdBy: actor.userId,
      })
      .returning();
    return { change: change!, version: version! };
  },
);

export const updateValueChange = defineCommand(
  COMMANDS.updateValueChange,
  z.object({
    changeId: uuid,
    code: nonBlank.optional(),
    reason: clearableText,
    economicImpactNarrative: clearableText,
    statedChangeAmount: clearableMoney,
    assuranceReviewId: clearableUuid,
    decisionId: clearableUuid,
  }),
  async ({ tx }, { changeId, ...fields }) => {
    const change = await getChange(tx, changeId);
    if (change.status !== "draft") {
      throw new DomainError(
        "VO_VALUE_CHANGE_IMMUTABLE",
        `${change.code} is ${change.status}; return it to draft to edit`,
      );
    }
    const [row] = await tx
      .update(schema.valueChange)
      .set(fields)
      .where(eq(schema.valueChange.id, changeId))
      .returning();
    return row!;
  },
);

/** Proposes the change to the VCO; the proposed version is locked. */
export const proposeValueChange = defineCommand(
  COMMANDS.proposeValueChange,
  z.object({ changeId: uuid }),
  async ({ tx, actor }, input) => {
    const change = await getChange(tx, input.changeId);
    if (change.status !== "draft")
      throw new DomainError("VO_INVALID_TRANSITION", "Only a draft Value Change can be proposed");
    if (!change.reason) {
      throw new DomainError("VO_INVALID_INPUT", "Record the reason for the change before proposing it", {
        issues: [{ path: "reason", message: "Required before proposing" }],
      });
    }
    const now = new Date();
    const [row] = await tx
      .update(schema.valueChange)
      .set({ status: "proposed", proposedAt: now, proposedBy: actor.userId })
      .where(eq(schema.valueChange.id, change.id))
      .returning();
    await setVersionStatus(tx, change.toVersionId, { status: "proposed", proposedAt: now, proposedBy: actor.userId });
    return row!;
  },
);

/** VCO returns the change for revision: change and version go back to draft. */
export const returnValueChange = defineCommand(
  COMMANDS.returnValueChange,
  z.object({ changeId: uuid }),
  async ({ tx }, input) => {
    const change = await getChange(tx, input.changeId);
    if (change.status !== "proposed")
      throw new DomainError("VO_INVALID_TRANSITION", "Only a proposed Value Change can be returned");
    const [row] = await tx
      .update(schema.valueChange)
      .set({ status: "draft", proposedAt: null, proposedBy: null })
      .where(eq(schema.valueChange.id, change.id))
      .returning();
    await setVersionStatus(tx, change.toVersionId, { status: "draft", proposedAt: null, proposedBy: null });
    return row!;
  },
);

/**
 * Records the VCO's authorisation (consultant-recorded, with evidence) and, in
 * one transaction: authorises the change, supersedes the version in force, and
 * authorises the proposed version. Any failure rolls back everything.
 */
export const authoriseValueChange = defineCommand(
  COMMANDS.authoriseValueChange,
  z.object({
    changeId: uuid,
    authorisedByPersonId: uuid,
    authorisedOn: isoDate,
    authorisationEvidenceId: uuid,
    authorisationNote: optionalText,
  }),
  async ({ tx, actor }, input) => {
    const change = await getChange(tx, input.changeId);
    if (change.status !== "proposed") {
      throw new DomainError("VO_INVALID_TRANSITION", "Only a proposed Value Change can be authorised");
    }
    const [valueCase] = await tx.select().from(schema.valueCase).where(eq(schema.valueCase.id, change.valueCaseId));
    if (!valueCase?.vcoPersonId) throw new DomainError("VO_VCO_REQUIRED", "The Value Case has no Value Case Owner");
    if (valueCase.vcoPersonId !== input.authorisedByPersonId) {
      throw new DomainError("VO_NOT_VCO", "Only the Value Case Owner can authorise a Value Change");
    }
    // Phase 4D.13 governance guard: authorising supersedes the version in force. A draft Assurance Review measured
    // against that version could then never be finalised (the database only finalises against the authorised
    // version) and would block every new review. Refuse — nothing is changed — until the draft is finalised.
    const [stranded] = await tx
      .select({ sequence: schema.assuranceReview.sequence, versionNumber: schema.valueCaseVersion.versionNumber })
      .from(schema.assuranceReview)
      .innerJoin(schema.valueCaseVersion, eq(schema.valueCaseVersion.id, schema.assuranceReview.againstVersionId))
      .where(
        and(
          eq(schema.assuranceReview.projectId, change.projectId),
          eq(schema.assuranceReview.status, "draft"),
          eq(schema.assuranceReview.againstVersionId, change.fromVersionId),
        ),
      );
    if (stranded) {
      throw new DomainError(
        "VO_DRAFT_REVIEW_OPEN",
        `${change.code} cannot be authorised while Assurance Review #${stranded.sequence} is still a draft measured ` +
          `against Authorised V${stranded.versionNumber}: authorising would supersede V${stranded.versionNumber} and ` +
          `leave that review unable to be finalised. Finalise Review #${stranded.sequence} first, then authorise ${change.code}.`,
      );
    }
    const now = new Date();
    const authorisation = {
      authorisedOn: input.authorisedOn,
      authorisedByPersonId: input.authorisedByPersonId,
      authorisationEvidenceId: input.authorisationEvidenceId,
      authorisationNote: input.authorisationNote ?? null,
      authorisationRecordedBy: actor.userId,
      authorisationRecordedAt: now,
    };
    const [row] = await tx
      .update(schema.valueChange)
      .set({ status: "authorised", ...authorisation })
      .where(eq(schema.valueChange.id, change.id))
      .returning();
    await setVersionStatus(tx, change.fromVersionId, { status: "superseded", supersededAt: now });
    await setVersionStatus(tx, change.toVersionId, { status: "authorised", ...authorisation });
    return row!;
  },
);

/** The VCO declined the proposed change; both it and its version are preserved, closed. */
export const rejectValueChange = defineCommand(
  COMMANDS.rejectValueChange,
  z.object({ changeId: uuid, closureNote: nonBlank }),
  async ({ tx, actor }, input) => {
    const change = await getChange(tx, input.changeId);
    if (change.status !== "proposed")
      throw new DomainError("VO_INVALID_TRANSITION", "Only a proposed Value Change can be rejected");
    const [row] = await tx
      .update(schema.valueChange)
      .set({ status: "rejected", closedAt: new Date(), closedBy: actor.userId, closureNote: input.closureNote })
      .where(eq(schema.valueChange.id, change.id))
      .returning();
    await setVersionStatus(tx, change.toVersionId, { status: "rejected" });
    return row!;
  },
);

export const withdrawValueChange = defineCommand(
  COMMANDS.withdrawValueChange,
  z.object({ changeId: uuid, closureNote: nonBlank }),
  async ({ tx, actor }, input) => {
    const change = await getChange(tx, input.changeId);
    if (change.status !== "draft" && change.status !== "proposed") {
      throw new DomainError("VO_INVALID_TRANSITION", "Only an open Value Change can be withdrawn");
    }
    const [row] = await tx
      .update(schema.valueChange)
      .set({ status: "withdrawn", closedAt: new Date(), closedBy: actor.userId, closureNote: input.closureNote })
      .where(eq(schema.valueChange.id, change.id))
      .returning();
    await setVersionStatus(tx, change.toVersionId, { status: "withdrawn" });
    return row!;
  },
);

/**
 * Phase 4D.3: include an existing driver identity (typically an emerging one) in the draft version
 * of a draft Value Change. The new value_driver_version starts from the living record — same stable
 * identity — and its working assumptions are copied. From then on the draft row is its own governed
 * copy: nothing synchronises it with the living record. Earlier versions are untouched, and the
 * usual reconciliation, proposal and VCO authorisation still apply. Working evidence links on the
 * identity are not copied: formal reliance on evidence stays a deliberate link on the version.
 */
export const includeDriverInValueChange = defineCommand(
  COMMANDS.includeDriverInValueChange,
  z.object({ changeId: uuid, valueDriverId: uuid }),
  async ({ tx }, input) => {
    const change = await getChange(tx, input.changeId);
    if (change.status !== "draft") {
      throw new DomainError(
        "VO_VALUE_CHANGE_IMMUTABLE",
        `${change.code} is ${change.status}; return it to draft first`,
      );
    }
    const [version] = await tx
      .select()
      .from(schema.valueCaseVersion)
      .where(eq(schema.valueCaseVersion.id, change.toVersionId))
      .for("update");
    if (version?.status !== "draft") {
      throw new DomainError("VO_VERSION_IMMUTABLE", "The proposed Value Case version is not a draft");
    }
    const [driver] = await tx.select().from(schema.valueDriver).where(eq(schema.valueDriver.id, input.valueDriverId));
    if (driver?.valueCaseId !== change.valueCaseId) throw new DomainError("VO_NOT_FOUND", "Value Driver not found");
    const [existing] = await tx
      .select({ id: schema.valueDriverVersion.id })
      .from(schema.valueDriverVersion)
      .where(
        and(
          eq(schema.valueDriverVersion.valueCaseVersionId, version.id),
          eq(schema.valueDriverVersion.valueDriverId, driver.id),
        ),
      );
    if (existing) {
      throw new DomainError("VO_DRIVER_ALREADY_INCLUDED", `${driver.code} is already in V${version.versionNumber}`);
    }
    const [record] = await tx
      .select()
      .from(schema.valueDriverRecord)
      .where(eq(schema.valueDriverRecord.valueDriverId, driver.id));
    if (!record) {
      throw new DomainError("VO_NO_WORKING_RECORD", `${driver.code} has no working record to start from`);
    }
    const [{ last } = { last: null }] = await tx
      .select({ last: max(schema.valueDriverVersion.sortOrder) })
      .from(schema.valueDriverVersion)
      .where(eq(schema.valueDriverVersion.valueCaseVersionId, version.id));
    const [driverVersion] = await tx
      .insert(schema.valueDriverVersion)
      .values({
        valueCaseVersionId: version.id,
        valueDriverId: driver.id,
        valueCaseId: version.valueCaseId,
        projectId: version.projectId,
        name: record.name,
        description: record.description,
        metric: record.metric,
        metricUnit: record.metricUnit,
        baselineValue: record.baselineValue,
        targetValue: record.targetValue,
        calculationRationale: record.calculationRationale,
        financialValue: record.workingEstimate,
        avoPersonId: record.avoPersonId,
        qualificationStatus: record.qualificationStatus,
        evidenceStatus: record.evidenceStatus,
        notes: record.notes,
        sortOrder: (last ?? 0) + 1,
      })
      .returning();
    const assumptions = await tx
      .select()
      .from(schema.valueDriverRecordAssumption)
      .where(eq(schema.valueDriverRecordAssumption.valueDriverRecordId, record.id));
    for (const a of assumptions) {
      await tx.insert(schema.assumption).values({
        valueDriverVersionId: driverVersion!.id,
        projectId: a.projectId,
        statement: a.statement,
        evidenceStatus: a.evidenceStatus,
        notes: a.notes,
        sortOrder: a.sortOrder,
      });
    }
    return driverVersion!;
  },
);
