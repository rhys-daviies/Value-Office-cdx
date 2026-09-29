import { and, eq, inArray, max } from "drizzle-orm";
import { z } from "zod";

import { DomainError } from "@/domain/errors";
import { schema, type Tx } from "@/server/db/client";

import { COMMANDS } from "./names";
import { defineCommand } from "./run";
import {
  clearableDate,
  clearableMetric,
  clearableMoney,
  clearableText,
  clearableUuid,
  evidenceStatus,
  isoDate,
  metricString,
  moneyString,
  nonBlank,
  optionalText,
  qualificationStatus,
  uuid,
} from "./schemas";

// Versioning model
//   V0  inherited Business Case  draft -> recorded (locked)
//   V1  Re-Qualified Value Case  draft <-> proposed -> authorised (locked, VCO)
//   V2+ only via an approved Value Change (not yet implemented; DB blocks it)
// State transitions are enforced again by vo_value_case_version_guard.

async function getVersion(tx: Tx, versionId: string) {
  const [row] = await tx
    .select()
    .from(schema.valueCaseVersion)
    .where(eq(schema.valueCaseVersion.id, versionId))
    .for("update");
  if (!row) throw new DomainError("VO_NOT_FOUND", "Value Case version not found");
  return row;
}

async function getValueCase(tx: Tx, projectId: string) {
  const [row] = await tx.select().from(schema.valueCase).where(eq(schema.valueCase.projectId, projectId));
  if (!row) throw new DomainError("VO_NOT_FOUND", "Value Case not found");
  return row;
}

function requireDraft(version: { status: string; versionNumber: number }) {
  if (version.status !== "draft") {
    throw new DomainError(
      "VO_VERSION_IMMUTABLE",
      `Version ${version.versionNumber} is ${version.status}; only draft versions can be edited`,
    );
  }
}

// --- V0: inherited Business Case -------------------------------------------

export const createInheritedBusinessCase = defineCommand(
  COMMANDS.createInheritedBusinessCase,
  z.object({ projectId: uuid, title: nonBlank, summary: optionalText, statedTotalValue: moneyString.optional() }),
  async ({ tx, actor }, input) => {
    const valueCase = await getValueCase(tx, input.projectId);
    const [row] = await tx
      .insert(schema.valueCaseVersion)
      .values({
        valueCaseId: valueCase.id,
        projectId: input.projectId,
        versionNumber: 0,
        kind: "inherited_business_case",
        title: input.title,
        summary: input.summary,
        statedTotalValue: input.statedTotalValue,
        createdBy: actor.userId,
      })
      .returning();
    return row!;
  },
);

export const recordInheritedBusinessCase = defineCommand(
  COMMANDS.recordInheritedBusinessCase,
  z.object({ versionId: uuid }),
  async ({ tx }, input) => {
    const version = await getVersion(tx, input.versionId);
    if (version.kind !== "inherited_business_case") {
      throw new DomainError("VO_INVALID_TRANSITION", "Only the inherited Business Case (V0) is recorded");
    }
    requireDraft(version);
    const [row] = await tx
      .update(schema.valueCaseVersion)
      .set({ status: "recorded", recordedAt: new Date() })
      .where(eq(schema.valueCaseVersion.id, version.id))
      .returning();
    return row!;
  },
);

// --- Draft Value Case version ------------------------------------------------

/**
 * Creates the next Value Case version as a draft. When `basedOnVersionId` is
 * given, its drivers, assumptions and evidence links are copied (copy-on-write).
 * Phase 1 supports only the initial Re-Qualified version (V1).
 */
export const createDraftVersion = defineCommand(
  COMMANDS.createDraftVersion,
  z.object({ projectId: uuid, title: nonBlank, summary: optionalText, basedOnVersionId: uuid.optional() }),
  async ({ tx, actor }, input) => {
    const valueCase = await getValueCase(tx, input.projectId);

    const existing = await tx
      .select({ status: schema.valueCaseVersion.status })
      .from(schema.valueCaseVersion)
      .where(
        and(
          eq(schema.valueCaseVersion.valueCaseId, valueCase.id),
          inArray(schema.valueCaseVersion.status, ["authorised", "superseded"]),
        ),
      );
    if (existing.length > 0) {
      throw new DomainError(
        "VO_VALUE_CHANGE_REQUIRED",
        "This Value Case is already authorised; new versions require a Value Change (not yet implemented)",
      );
    }

    let source: typeof schema.valueCaseVersion.$inferSelect | undefined;
    if (input.basedOnVersionId) {
      source = await getVersion(tx, input.basedOnVersionId);
      if (source.valueCaseId !== valueCase.id) {
        throw new DomainError("VO_REFERENCE_VIOLATION", "Source version belongs to a different Value Case");
      }
      if (source.status === "draft" || source.status === "proposed") {
        throw new DomainError(
          "VO_SOURCE_NOT_LOCKED",
          "A new version can only be based on a recorded or authorised version",
        );
      }
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
        versionNumber: (last ?? 0) + 1,
        kind: "value_case",
        title: input.title,
        summary: input.summary,
        basedOnVersionId: source?.id,
        createdBy: actor.userId,
      })
      .returning();

    if (source) await copyVersionContents(tx, source.id, version!.id);
    return version!;
  },
);

/** Copy-forward: driver versions, assumptions and evidence links into a new draft. */
export async function copyVersionContents(tx: Tx, fromVersionId: string, toVersionId: string) {
  const drivers = await tx
    .select()
    .from(schema.valueDriverVersion)
    .where(eq(schema.valueDriverVersion.valueCaseVersionId, fromVersionId));

  for (const { id: oldDriverVersionId, createdAt, ...driver } of drivers) {
    const [copy] = await tx
      .insert(schema.valueDriverVersion)
      .values({ ...driver, valueCaseVersionId: toVersionId })
      .returning({ id: schema.valueDriverVersion.id });

    const links = await tx
      .select()
      .from(schema.evidenceLink)
      .where(eq(schema.evidenceLink.valueDriverVersionId, oldDriverVersionId));
    for (const link of links) {
      await tx.insert(schema.evidenceLink).values({
        evidenceId: link.evidenceId,
        projectId: link.projectId,
        valueDriverVersionId: copy!.id,
        relevanceNote: link.relevanceNote,
      });
    }

    const assumptions = await tx
      .select()
      .from(schema.assumption)
      .where(eq(schema.assumption.valueDriverVersionId, oldDriverVersionId));
    for (const { id: oldAssumptionId, createdAt, ...assumption } of assumptions) {
      const [assumptionCopy] = await tx
        .insert(schema.assumption)
        .values({ ...assumption, valueDriverVersionId: copy!.id })
        .returning({ id: schema.assumption.id });
      const assumptionLinks = await tx
        .select()
        .from(schema.evidenceLink)
        .where(eq(schema.evidenceLink.assumptionId, oldAssumptionId));
      for (const link of assumptionLinks) {
        await tx.insert(schema.evidenceLink).values({
          evidenceId: link.evidenceId,
          projectId: link.projectId,
          assumptionId: assumptionCopy!.id,
          relevanceNote: link.relevanceNote,
        });
      }
    }
  }
}

// --- Driver content (draft only) ---------------------------------------------

const driverFields = z.object({
  name: nonBlank,
  description: optionalText,
  metric: optionalText,
  metricUnit: optionalText,
  baselineValue: metricString.optional(),
  targetValue: metricString.optional(),
  calculationRationale: optionalText,
  financialValue: moneyString.optional(),
  timingDescription: optionalText,
  benefitStartDate: isoDate.optional(),
  benefitFullDate: isoDate.optional(),
  avoPersonId: uuid.optional(),
  qualificationStatus: qualificationStatus.optional(),
  evidenceStatus: evidenceStatus.optional(),
  notes: optionalText,
  sortOrder: z.number().int().optional(),
});

/** Adds a new Value Driver (stable identity + content) to a draft version. */
export const addValueDriver = defineCommand(
  COMMANDS.addValueDriver,
  driverFields.extend({ versionId: uuid, code: nonBlank }),
  async ({ tx }, { versionId, code, ...fields }) => {
    const version = await getVersion(tx, versionId);
    requireDraft(version);
    const [driver] = await tx
      .insert(schema.valueDriver)
      .values({ valueCaseId: version.valueCaseId, projectId: version.projectId, code })
      .returning();
    const [driverVersion] = await tx
      .insert(schema.valueDriverVersion)
      .values({
        ...fields,
        valueCaseVersionId: version.id,
        valueDriverId: driver!.id,
        valueCaseId: version.valueCaseId,
        projectId: version.projectId,
      })
      .returning();
    return { driver: driver!, driverVersion: driverVersion! };
  },
);

/**
 * Edits a driver version in a draft. `null` clears a field: a cleared
 * financial value makes the driver non-financial (excluded from the total).
 */
export const updateDriverVersion = defineCommand(
  COMMANDS.updateDriverVersion,
  z.object({
    driverVersionId: uuid,
    name: nonBlank.optional(),
    description: clearableText,
    metric: clearableText,
    metricUnit: clearableText,
    baselineValue: clearableMetric,
    targetValue: clearableMetric,
    calculationRationale: clearableText,
    financialValue: clearableMoney,
    timingDescription: clearableText,
    benefitStartDate: clearableDate,
    benefitFullDate: clearableDate,
    avoPersonId: clearableUuid,
    qualificationStatus: qualificationStatus.optional(),
    evidenceStatus: evidenceStatus.optional(),
    notes: clearableText,
    sortOrder: z.number().int().optional(),
  }),
  async ({ tx }, { driverVersionId, ...fields }) => {
    const [row] = await tx
      .update(schema.valueDriverVersion)
      .set(fields)
      .where(eq(schema.valueDriverVersion.id, driverVersionId))
      .returning();
    if (!row) throw new DomainError("VO_NOT_FOUND", "Driver version not found");
    return row;
  },
);

/**
 * Removes a driver from a draft version (its assumptions and links cascade).
 * The driver identity is deleted too unless another version still uses it.
 */
export const removeValueDriver = defineCommand(
  COMMANDS.removeValueDriver,
  z.object({ driverVersionId: uuid }),
  async ({ tx }, input) => {
    const [removed] = await tx
      .delete(schema.valueDriverVersion)
      .where(eq(schema.valueDriverVersion.id, input.driverVersionId))
      .returning();
    if (!removed) throw new DomainError("VO_NOT_FOUND", "Driver version not found");
    const [stillUsed] = await tx
      .select({ id: schema.valueDriverVersion.id })
      .from(schema.valueDriverVersion)
      .where(eq(schema.valueDriverVersion.valueDriverId, removed.valueDriverId))
      .limit(1);
    if (!stillUsed) await tx.delete(schema.valueDriver).where(eq(schema.valueDriver.id, removed.valueDriverId));
    return removed;
  },
);

export const addAssumption = defineCommand(
  COMMANDS.addAssumption,
  z.object({
    driverVersionId: uuid,
    statement: nonBlank,
    evidenceStatus: evidenceStatus.optional(),
    notes: optionalText,
  }),
  async ({ tx }, { driverVersionId, ...fields }) => {
    const [driverVersion] = await tx
      .select({ projectId: schema.valueDriverVersion.projectId })
      .from(schema.valueDriverVersion)
      .where(eq(schema.valueDriverVersion.id, driverVersionId));
    if (!driverVersion) throw new DomainError("VO_NOT_FOUND", "Driver version not found");
    const [row] = await tx
      .insert(schema.assumption)
      .values({ ...fields, valueDriverVersionId: driverVersionId, projectId: driverVersion.projectId })
      .returning();
    return row!;
  },
);

export const linkEvidence = defineCommand(
  COMMANDS.linkEvidence,
  z
    .object({
      evidenceId: uuid,
      driverVersionId: uuid.optional(),
      assumptionId: uuid.optional(),
      relevanceNote: optionalText,
    })
    .refine((v) => Boolean(v.driverVersionId) !== Boolean(v.assumptionId), {
      message: "Link evidence to exactly one of driverVersionId or assumptionId",
    }),
  async ({ tx }, input) => {
    const [evidence] = await tx
      .select({ projectId: schema.evidence.projectId })
      .from(schema.evidence)
      .where(eq(schema.evidence.id, input.evidenceId));
    if (!evidence) throw new DomainError("VO_NOT_FOUND", "Evidence not found");
    const [row] = await tx
      .insert(schema.evidenceLink)
      .values({
        evidenceId: input.evidenceId,
        projectId: evidence.projectId,
        valueDriverVersionId: input.driverVersionId,
        assumptionId: input.assumptionId,
        relevanceNote: input.relevanceNote,
      })
      .returning();
    return row!;
  },
);

export const updateAssumption = defineCommand(
  COMMANDS.updateAssumption,
  z.object({
    assumptionId: uuid,
    statement: nonBlank.optional(),
    evidenceStatus: evidenceStatus.optional(),
    notes: clearableText,
  }),
  async ({ tx }, { assumptionId, ...fields }) => {
    const [row] = await tx
      .update(schema.assumption)
      .set(fields)
      .where(eq(schema.assumption.id, assumptionId))
      .returning();
    if (!row) throw new DomainError("VO_NOT_FOUND", "Assumption not found");
    return row;
  },
);

export const removeAssumption = defineCommand(
  COMMANDS.removeAssumption,
  z.object({ assumptionId: uuid }),
  async ({ tx }, input) => {
    const [row] = await tx.delete(schema.assumption).where(eq(schema.assumption.id, input.assumptionId)).returning();
    if (!row) throw new DomainError("VO_NOT_FOUND", "Assumption not found");
    return row;
  },
);

export const unlinkEvidence = defineCommand(
  COMMANDS.unlinkEvidence,
  z.object({ evidenceLinkId: uuid }),
  async ({ tx }, input) => {
    const [row] = await tx
      .delete(schema.evidenceLink)
      .where(eq(schema.evidenceLink.id, input.evidenceLinkId))
      .returning();
    if (!row) throw new DomainError("VO_NOT_FOUND", "Evidence link not found");
    return row;
  },
);

/** Title, summary and (V0 only) stated headline total, while the version is draft. */
export const updateVersionDetails = defineCommand(
  COMMANDS.updateVersionDetails,
  z.object({
    versionId: uuid,
    title: nonBlank.optional(),
    summary: clearableText,
    statedTotalValue: clearableMoney,
  }),
  async ({ tx }, { versionId, ...fields }) => {
    const version = await getVersion(tx, versionId);
    requireDraft(version);
    if (fields.statedTotalValue !== undefined && version.kind !== "inherited_business_case") {
      throw new DomainError(
        "VO_INVALID_INPUT",
        "Only the inherited Business Case has a stated total; Value Case totals are derived from drivers",
      );
    }
    const [row] = await tx
      .update(schema.valueCaseVersion)
      .set(fields)
      .where(eq(schema.valueCaseVersion.id, versionId))
      .returning();
    return row!;
  },
);

// --- Proposal and initial VCO authorisation -----------------------------------

export const proposeVersion = defineCommand(
  COMMANDS.proposeVersion,
  z.object({ versionId: uuid }),
  async ({ tx, actor }, input) => {
    const version = await getVersion(tx, input.versionId);
    if (version.kind !== "value_case") {
      throw new DomainError("VO_INVALID_TRANSITION", "The inherited Business Case is recorded, not proposed");
    }
    requireDraft(version);
    const [row] = await tx
      .update(schema.valueCaseVersion)
      .set({ status: "proposed", proposedAt: new Date(), proposedBy: actor.userId })
      .where(eq(schema.valueCaseVersion.id, version.id))
      .returning();
    return row!;
  },
);

export const returnVersionToDraft = defineCommand(
  COMMANDS.returnVersionToDraft,
  z.object({ versionId: uuid }),
  async ({ tx }, input) => {
    const version = await getVersion(tx, input.versionId);
    if (version.status !== "proposed") {
      throw new DomainError("VO_INVALID_TRANSITION", "Only a proposed version can be returned to draft");
    }
    const [row] = await tx
      .update(schema.valueCaseVersion)
      .set({ status: "draft", proposedAt: null, proposedBy: null })
      .where(eq(schema.valueCaseVersion.id, version.id))
      .returning();
    return row!;
  },
);

/**
 * Records the Value Case Owner's authorisation of the proposed initial Value
 * Case, creating Authorised V1. A consultant records it with supporting
 * evidence (signed notice, email, meeting record…). No Value Change identifier
 * is involved (PMO decision 5); later versions will require a Value Change.
 */
export const authoriseInitialVersion = defineCommand(
  COMMANDS.authoriseInitialVersion,
  z.object({
    versionId: uuid,
    authorisedByPersonId: uuid,
    authorisedOn: isoDate,
    authorisationEvidenceId: uuid,
    authorisationNote: optionalText,
  }),
  async ({ tx, actor }, input) => {
    const version = await getVersion(tx, input.versionId);
    if (version.status !== "proposed") {
      throw new DomainError("VO_INVALID_TRANSITION", "Only a proposed Value Case version can be authorised");
    }
    const [valueCase] = await tx
      .select({ vcoPersonId: schema.valueCase.vcoPersonId })
      .from(schema.valueCase)
      .where(eq(schema.valueCase.id, version.valueCaseId));
    if (!valueCase?.vcoPersonId) {
      throw new DomainError("VO_VCO_REQUIRED", "The Value Case has no Value Case Owner");
    }
    if (valueCase.vcoPersonId !== input.authorisedByPersonId) {
      throw new DomainError("VO_NOT_VCO", "Only the Value Case Owner can authorise the Value Case");
    }
    const [row] = await tx
      .update(schema.valueCaseVersion)
      .set({
        status: "authorised",
        authorisedOn: input.authorisedOn,
        authorisedByPersonId: input.authorisedByPersonId,
        authorisationEvidenceId: input.authorisationEvidenceId,
        authorisationNote: input.authorisationNote,
        authorisationRecordedBy: actor.userId,
        authorisationRecordedAt: new Date(),
      })
      .where(eq(schema.valueCaseVersion.id, version.id))
      .returning();
    return row!;
  },
);
