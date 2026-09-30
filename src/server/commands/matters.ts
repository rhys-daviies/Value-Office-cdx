import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { DomainError } from "@/domain/errors";
import { money } from "@/domain/money";
import { ASSURANCE_STAGES } from "@/domain/statuses";
import { schema, type Tx } from "@/server/db/client";

import { getLeakage, replaceDrivers } from "./leakage";
import { COMMANDS } from "./names";
import { defineCommand } from "./run";
import { clearableDate, clearableText, isoDate, moneyString, nonBlank, optionalText, uuid } from "./schemas";

// Continuous Assurance matters (Phase 4D.1). The value_leakage record is the living matter:
// raised and worked on outside formal reviews. Working figures are the consultant's current
// view and never a formal position — formal figures exist only per review (leakage_assessment),
// and a finalised review snapshots the matter (assurance.finaliseReview).
// Working Value Leakage never changes Authorised Value, Current Forecast, Value Gap or versions.

const today = () => new Date().toISOString().slice(0, 10);

async function openMatter(tx: Tx, matterId: string) {
  const matter = await getLeakage(tx, matterId);
  if (matter.status !== "open") throw new DomainError("VO_MATTER_CLOSED", `${matter.code} is closed; reopen it first`);
  return matter;
}

/** Raise an Assurance matter without a formal review (requires an Authorised Value Case). */
export const createMatter = defineCommand(
  COMMANDS.createMatter,
  z.object({
    projectId: uuid,
    code: nonBlank,
    title: nonBlank,
    description: optionalText,
    identifiedOn: isoDate.optional(),
    responseOwnerPersonId: uuid.optional(),
    requiredDecisionDate: isoDate.optional(),
    driverIds: z.array(uuid).default([]),
  }),
  async ({ tx, actor }, { projectId, driverIds, identifiedOn, ...fields }) => {
    const [valueCase] = await tx.select().from(schema.valueCase).where(eq(schema.valueCase.projectId, projectId));
    if (!valueCase) throw new DomainError("VO_NOT_FOUND", "Project not found");
    const [authorised] = await tx
      .select({ id: schema.valueCaseVersion.id })
      .from(schema.valueCaseVersion)
      .where(
        and(eq(schema.valueCaseVersion.valueCaseId, valueCase.id), eq(schema.valueCaseVersion.status, "authorised")),
      );
    if (!authorised) {
      throw new DomainError(
        "VO_VERSION_NOT_AUTHORISED",
        "Continuous Assurance begins once the Value Case is authorised",
      );
    }
    const on = identifiedOn ?? today();
    if (on > today()) {
      throw new DomainError("VO_INVALID_INPUT", "A matter cannot be identified in the future", {
        issues: [{ path: "identifiedOn", message: "Cannot be in the future" }],
      });
    }
    const [row] = await tx
      .insert(schema.valueLeakage)
      .values({
        ...fields,
        projectId,
        valueCaseId: valueCase.id,
        identifiedOn: on,
        stage: "identified",
        createdBy: actor.userId,
      })
      .returning();
    await replaceDrivers(tx, row!, driverIds);
    return row!;
  },
);

/** Move an open matter to any working stage (free movement; audited). */
export const setMatterStage = defineCommand(
  COMMANDS.setMatterStage,
  z.object({ matterId: uuid, stage: z.enum(ASSURANCE_STAGES) }),
  async ({ tx }, input) => {
    await openMatter(tx, input.matterId);
    const [row] = await tx
      .update(schema.valueLeakage)
      .set({ stage: input.stage })
      .where(eq(schema.valueLeakage.id, input.matterId))
      .returning();
    return row!;
  },
);

/** Assign (or clear) the Risk / Leakage Owner of an open matter. May differ from the drivers' AVOs. */
export const setMatterOwner = defineCommand(
  COMMANDS.setMatterOwner,
  z.object({ matterId: uuid, responseOwnerPersonId: uuid.nullable() }),
  async ({ tx }, input) => {
    await openMatter(tx, input.matterId);
    const [row] = await tx
      .update(schema.valueLeakage)
      .set({ responseOwnerPersonId: input.responseOwnerPersonId })
      .where(eq(schema.valueLeakage.id, input.matterId))
      .returning();
    return row!;
  },
);

/**
 * Record the working assessment — or clear it (null total = not yet quantified).
 * Total ≥ 0; 0 ≤ unrecoverable ≤ total; unrecoverable > 0 needs a rationale citing evidence of loss.
 * Unrecoverable defaults to 0 (recoverable until evidence shows loss). The database attributes the
 * assessment to the acting consultant at now().
 */
export const assessMatterWorking = defineCommand(
  COMMANDS.assessMatterWorking,
  z.object({
    matterId: uuid,
    workingTotalAmount: moneyString.nullable(),
    workingUnrecoverableAmount: moneyString.nullable().optional(),
    workingUnrecoverableRationale: optionalText,
  }),
  async ({ tx }, input) => {
    await openMatter(tx, input.matterId);
    const total = input.workingTotalAmount;
    const unrecoverable = total === null ? null : (input.workingUnrecoverableAmount ?? "0.00");
    const issues: { path: string; message: string }[] = [];
    if (total !== null && money(total).isNegative()) {
      issues.push({ path: "workingTotalAmount", message: "Cannot be negative" });
    }
    if (total !== null && unrecoverable !== null) {
      if (money(unrecoverable).isNegative()) {
        issues.push({ path: "workingUnrecoverableAmount", message: "Cannot be negative" });
      } else if (money(unrecoverable).greaterThan(money(total))) {
        issues.push({ path: "workingUnrecoverableAmount", message: "Cannot exceed the working total" });
      }
      if (!money(unrecoverable).isZero() && !input.workingUnrecoverableRationale) {
        issues.push({ path: "workingUnrecoverableRationale", message: "Required when unrecoverable is above zero" });
      }
    }
    if (issues.length) throw new DomainError("VO_INVALID_INPUT", "The working assessment is not valid", { issues });
    const hasUnrecoverable = unrecoverable !== null && !money(unrecoverable).isZero();
    const [row] = await tx
      .update(schema.valueLeakage)
      .set({
        workingTotalAmount: total,
        workingUnrecoverableAmount: unrecoverable,
        workingUnrecoverableRationale: hasUnrecoverable ? input.workingUnrecoverableRationale! : null,
      })
      .where(eq(schema.valueLeakage.id, input.matterId))
      .returning();
    return row!;
  },
);

/** Record the remediation approach and how long the outcome is monitored. */
export const setMatterRemediation = defineCommand(
  COMMANDS.setMatterRemediation,
  z.object({ matterId: uuid, remediationPlan: clearableText, monitorUntil: clearableDate }),
  async ({ tx }, { matterId, ...fields }) => {
    await openMatter(tx, matterId);
    const [row] = await tx
      .update(schema.valueLeakage)
      .set(fields)
      .where(eq(schema.valueLeakage.id, matterId))
      .returning();
    return row!;
  },
);

/** Resolve a matter: status closed with a closure note. */
export const closeMatter = defineCommand(
  COMMANDS.closeMatter,
  z.object({ matterId: uuid, closureNote: nonBlank }),
  async ({ tx }, input) => {
    await openMatter(tx, input.matterId);
    const [row] = await tx
      .update(schema.valueLeakage)
      .set({ status: "closed", closureNote: input.closureNote })
      .where(eq(schema.valueLeakage.id, input.matterId))
      .returning();
    return row!;
  },
);

/** Reopen a closed matter (its closure note is kept as history). */
export const reopenMatter = defineCommand(
  COMMANDS.reopenMatter,
  z.object({ matterId: uuid }),
  async ({ tx }, input) => {
    const matter = await getLeakage(tx, input.matterId);
    if (matter.status !== "closed") throw new DomainError("VO_INVALID_TRANSITION", `${matter.code} is already open`);
    const [row] = await tx
      .update(schema.valueLeakage)
      .set({ status: "open" })
      .where(eq(schema.valueLeakage.id, input.matterId))
      .returning();
    return row!;
  },
);
