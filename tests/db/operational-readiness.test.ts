import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { outstandingQueue } from "@/domain/request-queue";
import { seedCompactAuthorised } from "@/fixtures/compact";
import { createReview, linkReviewEvidence } from "@/server/commands/assurance";
import { linkDriverEvidence, recordEvidence } from "@/server/commands/evidence";
import {
  addInformationRequestItem,
  createInformationRequest,
  issueInformationRequest,
  updateInformationRequestItem,
} from "@/server/commands/information-request";
import { linkMatterEvidence } from "@/server/commands/matter-evidence";
import { createMatter } from "@/server/commands/matters";
import { addStakeholder } from "@/server/commands/stakeholders";
import { updateDriverVersion } from "@/server/commands/value-case";
import { authoriseValueChange, createValueChange, proposeValueChange } from "@/server/commands/value-change";
import { db, schema } from "@/server/db/client";
import { getValuePositionSummary } from "@/server/queries/assurance";
import { evidenceNeedingClassification, getEvidenceRegister } from "@/server/queries/evidence";
import { getInformationRequestWorkspace, listDriverOptions } from "@/server/queries/information-request";
import { getExecutiveOverview } from "@/server/queries/overview";
import { getLeakageRegister } from "@/server/queries/response";

import { expectDomainError, newActor, uid } from "../support/fixtures";

// Phase 4D.13 operational readiness, against the database: the IR working queue, named accountability, evidence
// needing classification, the two Overview signals, authorised driver names and the stranded-draft-review guard.

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const today = iso(0);

/** Compact engagement: Authorised V1 (VD-01..03); E-001 authorised V1; E-002 recorded with no links. */
async function compact() {
  const actor = await newActor();
  const { project } = await seedCompactAuthorised(actor, { code: `OR-${uid()}`, name: "Operational (SYNTHETIC)" });
  const drivers = await db().select().from(schema.valueDriver).where(eq(schema.valueDriver.projectId, project.id));
  const driver = (code: string) => drivers.find((d) => d.code === code)!;
  const evidence = await db().select().from(schema.evidence).where(eq(schema.evidence.projectId, project.id));
  const [vc] = await db().select().from(schema.valueCase).where(eq(schema.valueCase.projectId, project.id));
  const { person: owner } = await addStakeholder(actor, {
    projectId: project.id,
    name: "Dana Whitfield",
    roleDescription: "Risk / Leakage Owner",
  });
  const matter = await createMatter(actor, {
    projectId: project.id,
    code: "VL-001",
    title: "Vendor sequencing risk",
    responseOwnerPersonId: owner.id,
    driverIds: [driver("VD-01").id],
  });
  return {
    actor,
    project,
    driver,
    owner,
    matter,
    vcoPersonId: vc!.vcoPersonId!,
    e: (code: string) => evidence.find((x) => x.code === code)!,
  };
}

describe("Information Request working queue", () => {
  it("lists outstanding items on issued requests, earliest due first, with person — role, driver and matter", async () => {
    const x = await compact();
    const ir = await createInformationRequest(x.actor, {
      projectId: x.project.id,
      reference: "IR-01",
      title: "Assurance evidence",
      purpose: "assurance",
    });
    const add = (description: string, dueOn?: string, extra: Record<string, string> = {}) =>
      addInformationRequestItem(x.actor, {
        informationRequestId: ir.id,
        description,
        dueOn,
        requestedFromPersonId: x.owner.id,
        ...extra,
      });
    const overdue = await add("Vendor delivery schedule", iso(-3), {
      valueDriverId: x.driver("VD-01").id,
      valueLeakageId: x.matter.id,
    });
    const soon = await add("Steering committee minutes", iso(5));
    const later = await add("Q4 volumes", iso(40));
    const done = await add("Signed contract", iso(-10));
    await updateInformationRequestItem(x.actor, { itemId: done.id, status: "received" });
    await issueInformationRequest(x.actor, { informationRequestId: ir.id, issuedOn: today });
    // A draft request has not been asked yet: its items are not outstanding.
    const draft = await createInformationRequest(x.actor, {
      projectId: x.project.id,
      reference: "IR-02",
      title: "Not yet issued",
    });
    await addInformationRequestItem(x.actor, { informationRequestId: draft.id, description: "Later", dueOn: iso(-1) });

    const ws = await getInformationRequestWorkspace(x.project.id);
    const queue = outstandingQueue(
      ws.requests.flatMap(({ request, items }) =>
        items.map((i) => ({
          ...i,
          requestStatus: request.status,
          itemStatus: i.item.status,
          dueOn: i.item.dueOn,
          reference: request.reference,
          sequence: i.item.sequence,
        })),
      ),
      today,
    );
    expect(queue.map((q) => [q.item.id, q.due])).toEqual([
      [overdue.id, "overdue"],
      [soon.id, "due_soon"],
      [later.id, "outstanding"],
    ]);
    expect(queue[0]).toMatchObject({
      requestedFromName: "Dana Whitfield",
      requestedFromRole: "Risk / Leakage Owner",
      driverCode: "VD-01",
      matter: { id: x.matter.id, code: "VL-001" },
    });
    expect((await getExecutiveOverview(x.project.id)).attention.operational.overdueRequestItems).toBe(1);
  });
});

describe("named accountability", () => {
  it("the matter register carries the owner's person name and engagement role", async () => {
    const x = await compact();
    const [entry] = await getLeakageRegister(x.project.id);
    expect(entry).toMatchObject({ ownerName: "Dana Whitfield", ownerRole: "Risk / Leakage Owner" });
  });
});

describe("evidence needing classification", () => {
  it("is evidence with no existing relationship; any driver, matter, review, request or governance link classifies it", async () => {
    const x = await compact();
    const record = (code: string) => recordEvidence(x.actor, { projectId: x.project.id, code, title: code });
    const [driverLinked, matterLinked, reviewLinked, fulfilling, loose] = [
      await record("E-010"),
      await record("E-011"),
      await record("E-012"),
      await record("E-013"),
      await record("E-014"),
    ];
    await linkDriverEvidence(x.actor, { evidenceId: driverLinked.id, valueDriverId: x.driver("VD-02").id });
    await linkMatterEvidence(x.actor, { matterId: x.matter.id, evidenceId: matterLinked.id });
    const review = await createReview(x.actor, { projectId: x.project.id, trigger: "ad_hoc", reviewDate: today });
    await linkReviewEvidence(x.actor, { reviewId: review.id, evidenceId: reviewLinked.id });
    const ir = await createInformationRequest(x.actor, { projectId: x.project.id, reference: "IR-01", title: "IR" });
    const item = await addInformationRequestItem(x.actor, { informationRequestId: ir.id, description: "Report" });
    await updateInformationRequestItem(x.actor, {
      itemId: item.id,
      status: "received",
      fulfilledByEvidenceId: fulfilling.id,
    });

    const unclassified = await evidenceNeedingClassification(x.project.id);
    // E-001 authorised V1 (governance record) → classified; E-002 and E-014 have no relationship at all.
    expect([...unclassified].sort()).toEqual([x.e("E-002").id, loose.id].sort());
    const register = await getEvidenceRegister(x.project.id);
    const flagged = register.entries.filter((e) => e.needsClassification).map((e) => e.evidence.code);
    expect(flagged).toEqual(["E-002", "E-014"]);
    expect((await getExecutiveOverview(x.project.id)).attention.operational.evidenceNeedingClassification).toBe(2);
  });
});

describe("current authorised Value Case", () => {
  it("IR driver names come from the authorised version, not a newer unauthorised draft", async () => {
    const x = await compact();
    const { version } = await createValueChange(x.actor, { projectId: x.project.id, code: "VC-001", reason: "Rename" });
    const [alpha] = await db()
      .select({ id: schema.valueDriverVersion.id })
      .from(schema.valueDriverVersion)
      .where(
        and(
          eq(schema.valueDriverVersion.valueCaseVersionId, version.id),
          eq(schema.valueDriverVersion.valueDriverId, x.driver("VD-01").id),
        ),
      );
    await updateDriverVersion(x.actor, { driverVersionId: alpha!.id, name: "Alpha Savings (renamed in draft V2)" });
    const options = await listDriverOptions(x.project.id);
    expect(options.find((o) => o.code === "VD-01")?.name).toBe("Alpha Savings");
  });
});

describe("stranded draft Assurance Review guard", () => {
  it("refuses to authorise a Value Change while a draft review is measured against the version it supersedes", async () => {
    const x = await compact();
    const v1 = (await getValuePositionSummary(x.project.id)).authorised!;
    const review = await createReview(x.actor, { projectId: x.project.id, trigger: "ad_hoc", reviewDate: today });
    const { change, version } = await createValueChange(x.actor, {
      projectId: x.project.id,
      code: "VC-001",
      reason: "Rebase Beta Revenue",
      statedChangeAmount: "-100000.00",
    });
    const [beta] = await db()
      .select({ id: schema.valueDriverVersion.id })
      .from(schema.valueDriverVersion)
      .where(
        and(
          eq(schema.valueDriverVersion.valueCaseVersionId, version.id),
          eq(schema.valueDriverVersion.valueDriverId, x.driver("VD-02").id),
        ),
      );
    await updateDriverVersion(x.actor, {
      driverVersionId: beta!.id,
      financialValue: "400000.00",
      adjustmentRationale: "Volumes below plan",
    });
    await proposeValueChange(x.actor, { changeId: change.id });
    const ev = await recordEvidence(x.actor, { projectId: x.project.id, code: `E-${uid()}`, title: "VCO approval" });

    const err = await expectDomainError(
      authoriseValueChange(x.actor, {
        changeId: change.id,
        authorisedByPersonId: x.vcoPersonId,
        authorisedOn: today,
        authorisationEvidenceId: ev.id,
      }),
      "VO_DRAFT_REVIEW_OPEN",
    );
    expect(err.message).toContain(`Assurance Review #${review.sequence} is still a draft`);
    expect(err.message).toContain(`Finalise Review #${review.sequence} first`);

    // Nothing changed: the change is still proposed, V1 still in force, the draft still measured against V1.
    const [after] = await db().select().from(schema.valueChange).where(eq(schema.valueChange.id, change.id));
    expect(after).toMatchObject({ status: "proposed", authorisedOn: null });
    expect((await getValuePositionSummary(x.project.id)).authorised?.id).toBe(v1.id);
    const [draft] = await db().select().from(schema.assuranceReview).where(eq(schema.assuranceReview.id, review.id));
    expect(draft).toMatchObject({ status: "draft", againstVersionId: v1.id });
  });
});
