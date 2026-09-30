import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { DomainError } from "@/domain/errors";
import { money } from "@/domain/money";
import { schema, type Tx } from "@/server/db/client";

import { COMMANDS } from "./names";
import { defineCommand } from "./run";
import {
  clearableMetric,
  clearableText,
  evidenceStatus,
  isoDate,
  metricString,
  moneyString,
  nonBlank,
  optionalText,
  qualificationStatus,
  uuid,
} from "./schemas";

// Living Value Drivers (Phase 4D.3). A value_driver_record is Cardaxia's WORKING understanding of a
// stable driver identity, across the whole engagement. It never rewrites a value_driver_version and
// is never part of Authorised Value, Current Forecast, Value Gap or realised value — those read
// governed version content only. An emerging driver enters the Authorised Value Case only through
// a Value Change (valueChange.includeDriver → reconcile → propose → VCO authorisation).

const today = () => new Date().toISOString().slice(0, 10);

export async function getDriverRecord(tx: Tx, valueDriverId: string) {
  const [row] = await tx
    .select()
    .from(schema.valueDriverRecord)
    .where(eq(schema.valueDriverRecord.valueDriverId, valueDriverId))
    .for("update");
  if (!row) {
    throw new DomainError(
      "VO_NO_WORKING_RECORD",
      "This driver has no working record yet; start one from its Value Case version first",
    );
  }
  return row;
}

function nonNegative(path: string, value: string | null | undefined) {
  if (value != null && money(value).isNegative()) {
    throw new DomainError("VO_INVALID_INPUT", "A working estimate cannot be negative", {
      issues: [{ path, message: "Cannot be negative" }],
    });
  }
}

/**
 * Identify a new Value Driver at any point after the Value Case is authorised. It is EMERGING:
 * it has a stable identity and a working record, but no Value Case version, so it changes no
 * authorised figure and creates no Value Change.
 */
export const createEmergingDriver = defineCommand(
  COMMANDS.createEmergingDriver,
  z.object({
    projectId: uuid,
    code: nonBlank,
    name: nonBlank,
    description: optionalText,
    metric: optionalText,
    metricUnit: optionalText,
    baselineValue: metricString.optional(),
    targetValue: metricString.optional(),
    calculationRationale: optionalText,
    workingEstimate: moneyString.optional(),
    avoPersonId: uuid.optional(),
    qualificationStatus: qualificationStatus.optional(),
    evidenceStatus: evidenceStatus.optional(),
    notes: optionalText,
    identifiedOn: isoDate.optional(),
    originValueLeakageId: uuid.optional(),
  }),
  async ({ tx, actor }, { projectId, code, identifiedOn, ...fields }) => {
    const [valueCase] = await tx.select().from(schema.valueCase).where(eq(schema.valueCase.projectId, projectId));
    if (!valueCase) throw new DomainError("VO_NOT_FOUND", "Project not found");
    const [authorised] = await tx
      .select({ id: schema.valueCaseVersion.id })
      .from(schema.valueCaseVersion)
      .where(
        and(
          eq(schema.valueCaseVersion.valueCaseId, valueCase.id),
          inArray(schema.valueCaseVersion.status, ["authorised", "superseded"]),
        ),
      )
      .limit(1);
    if (!authorised) {
      throw new DomainError(
        "VO_VERSION_NOT_AUTHORISED",
        "Before the Value Case is authorised, add drivers through Re-Qualification",
      );
    }
    const on = identifiedOn ?? today();
    if (on > today()) {
      throw new DomainError("VO_INVALID_INPUT", "A driver cannot be identified in the future", {
        issues: [{ path: "identifiedOn", message: "Cannot be in the future" }],
      });
    }
    nonNegative("workingEstimate", fields.workingEstimate);
    const [driver] = await tx
      .insert(schema.valueDriver)
      .values({ valueCaseId: valueCase.id, projectId, code })
      .returning();
    const [record] = await tx
      .insert(schema.valueDriverRecord)
      .values({ ...fields, valueDriverId: driver!.id, projectId, identifiedOn: on, createdBy: actor.userId })
      .returning();
    return { driver: driver!, record: record! };
  },
);

/**
 * Start the working record of an existing driver from its governed content: the authorised version
 * in force if the driver is in it, otherwise its latest locked version, otherwise its latest draft.
 * From then on the two evolve separately — nothing synchronises them.
 */
export const initialiseDriverRecord = defineCommand(
  COMMANDS.initialiseDriverRecord,
  z.object({ valueDriverId: uuid }),
  async ({ tx, actor }, input) => {
    const rows = await tx
      .select({ dv: schema.valueDriverVersion, version: schema.valueCaseVersion })
      .from(schema.valueDriverVersion)
      .innerJoin(schema.valueCaseVersion, eq(schema.valueCaseVersion.id, schema.valueDriverVersion.valueCaseVersionId))
      .where(eq(schema.valueDriverVersion.valueDriverId, input.valueDriverId))
      .orderBy(desc(schema.valueCaseVersion.versionNumber));
    if (rows.length === 0) throw new DomainError("VO_NOT_FOUND", "Value Driver has no Value Case version");
    const source =
      rows.find((r) => r.version.status === "authorised") ??
      rows.find((r) => r.version.status !== "draft" && r.version.status !== "proposed") ??
      rows[0]!;
    const { dv } = source;
    const [record] = await tx
      .insert(schema.valueDriverRecord)
      .values({
        valueDriverId: dv.valueDriverId,
        projectId: dv.projectId,
        name: dv.name,
        description: dv.description,
        metric: dv.metric,
        metricUnit: dv.metricUnit,
        baselineValue: dv.baselineValue,
        targetValue: dv.targetValue,
        calculationRationale: dv.calculationRationale,
        workingEstimate: dv.financialValue,
        avoPersonId: dv.avoPersonId,
        qualificationStatus: dv.qualificationStatus,
        evidenceStatus: dv.evidenceStatus,
        notes: dv.notes,
        initialisedFromVersionId: source.version.id,
        createdBy: actor.userId,
      })
      .returning();
    return record!;
  },
);

export const updateDriverWorking = defineCommand(
  COMMANDS.updateDriverWorking,
  z.object({
    valueDriverId: uuid,
    name: nonBlank.optional(),
    description: clearableText,
    metric: clearableText,
    metricUnit: clearableText,
    baselineValue: clearableMetric,
    targetValue: clearableMetric,
    calculationRationale: clearableText,
    notes: clearableText,
  }),
  async ({ tx }, { valueDriverId, ...fields }) => {
    const record = await getDriverRecord(tx, valueDriverId);
    const [row] = await tx
      .update(schema.valueDriverRecord)
      .set(fields)
      .where(eq(schema.valueDriverRecord.id, record.id))
      .returning();
    return row!;
  },
);

/** The working / current AVO. Each version keeps the AVO it had. */
export const setDriverAvo = defineCommand(
  COMMANDS.setDriverAvo,
  z.object({ valueDriverId: uuid, avoPersonId: uuid.nullable() }),
  async ({ tx }, input) => {
    const record = await getDriverRecord(tx, input.valueDriverId);
    const [row] = await tx
      .update(schema.valueDriverRecord)
      .set({ avoPersonId: input.avoPersonId })
      .where(eq(schema.valueDriverRecord.id, record.id))
      .returning();
    return row!;
  },
);

export const setDriverQualification = defineCommand(
  COMMANDS.setDriverQualification,
  z.object({ valueDriverId: uuid, qualificationStatus }),
  async ({ tx }, input) => {
    const record = await getDriverRecord(tx, input.valueDriverId);
    const [row] = await tx
      .update(schema.valueDriverRecord)
      .set({ qualificationStatus: input.qualificationStatus })
      .where(eq(schema.valueDriverRecord.id, record.id))
      .returning();
    return row!;
  },
);

export const setDriverEvidenceStatus = defineCommand(
  COMMANDS.setDriverEvidenceStatus,
  z.object({ valueDriverId: uuid, evidenceStatus }),
  async ({ tx }, input) => {
    const record = await getDriverRecord(tx, input.valueDriverId);
    const [row] = await tx
      .update(schema.valueDriverRecord)
      .set({ evidenceStatus: input.evidenceStatus })
      .where(eq(schema.valueDriverRecord.id, record.id))
      .returning();
    return row!;
  },
);

/** Record (or clear: null = not yet quantified) the working estimate. Attributed by the database. */
export const setDriverEstimate = defineCommand(
  COMMANDS.setDriverEstimate,
  z.object({ valueDriverId: uuid, workingEstimate: moneyString.nullable() }),
  async ({ tx }, input) => {
    nonNegative("workingEstimate", input.workingEstimate);
    const record = await getDriverRecord(tx, input.valueDriverId);
    const [row] = await tx
      .update(schema.valueDriverRecord)
      .set({ workingEstimate: input.workingEstimate })
      .where(eq(schema.valueDriverRecord.id, record.id))
      .returning();
    return row!;
  },
);

// --- Working assumptions -------------------------------------------------------

export const addDriverAssumption = defineCommand(
  COMMANDS.addDriverAssumption,
  z.object({
    valueDriverId: uuid,
    statement: nonBlank,
    evidenceStatus: evidenceStatus.optional(),
    notes: optionalText,
  }),
  async ({ tx }, { valueDriverId, ...fields }) => {
    const record = await getDriverRecord(tx, valueDriverId);
    const [row] = await tx
      .insert(schema.valueDriverRecordAssumption)
      .values({ ...fields, valueDriverRecordId: record.id, projectId: record.projectId })
      .returning();
    return row!;
  },
);

export const updateDriverAssumption = defineCommand(
  COMMANDS.updateDriverAssumption,
  z.object({
    assumptionId: uuid,
    statement: nonBlank.optional(),
    evidenceStatus: evidenceStatus.optional(),
    notes: clearableText,
  }),
  async ({ tx }, { assumptionId, ...fields }) => {
    const [row] = await tx
      .update(schema.valueDriverRecordAssumption)
      .set(fields)
      .where(eq(schema.valueDriverRecordAssumption.id, assumptionId))
      .returning();
    if (!row) throw new DomainError("VO_NOT_FOUND", "Working assumption not found");
    return row;
  },
);

export const removeDriverAssumption = defineCommand(
  COMMANDS.removeDriverAssumption,
  z.object({ assumptionId: uuid }),
  async ({ tx }, input) => {
    const [row] = await tx
      .delete(schema.valueDriverRecordAssumption)
      .where(eq(schema.valueDriverRecordAssumption.id, input.assumptionId))
      .returning();
    if (!row) throw new DomainError("VO_NOT_FOUND", "Working assumption not found");
    return row;
  },
);
