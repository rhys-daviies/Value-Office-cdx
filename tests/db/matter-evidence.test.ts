import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createReview, finaliseReview, linkReviewEvidence, upsertValuePositions } from "@/server/commands/assurance";
import { linkDriverEvidence, recordEvidence, unlinkDriverEvidence, updateEvidence } from "@/server/commands/evidence";
import {
  addInformationRequestItem,
  createInformationRequest,
  issueInformationRequest,
  updateInformationRequestItem,
} from "@/server/commands/information-request";
import {
  documentMatterEvidence,
  linkMatterEvidence,
  requestMatterEvidence,
  unlinkMatterEvidence,
} from "@/server/commands/matter-evidence";
import {
  assessMatterWorking,
  closeMatter,
  createMatter,
  reopenMatter,
  setMatterStage,
} from "@/server/commands/matters";
import { COMMANDS } from "@/server/commands/names";
import { addStakeholder } from "@/server/commands/stakeholders";
import { authoriseInitialVersion, unlinkEvidence } from "@/server/commands/value-case";
import { db, schema } from "@/server/db/client";
import { getAssuranceWorkspace, getValuePositionSummary } from "@/server/queries/assurance";
import { getEvidenceRegister, getMatterEvidence, listOpenMatterEvidence } from "@/server/queries/evidence";
import { getInformationRequestWorkspace } from "@/server/queries/information-request";
import { buildInformationRequestReport, getReportIssue } from "@/server/queries/reports";
import { getAssuranceMatter } from "@/server/queries/response";
import { issueReport } from "@/server/reports/issue";
import { irPurposeLabel } from "@/ui/labels";
import { renderReportArticle } from "@/ui/reports/render";

import { asCommand, expectDomainError, newActor, proposedV1, sql, uid } from "../support/fixtures";

// Phase 4D.2: evidence in everyday Continuous Assurance. Matter and driver-identity links are
// working links — they inform the consultant, never lock evidence, never become formal review
// evidence by themselves, and never move stages, working figures, forecast, gap or Authorised Value.

const today = new Date().toISOString().slice(0, 10);
const text = (m: string) =>
  m
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

/** Authorised V1 (VD-01 $4.8m), a mobilisation Information Request, a risk owner and an open matter. */
async function project() {
  const actor = await newActor();
  const ctx = await proposedV1(actor);
  const v1 = await authoriseInitialVersion(actor, {
    versionId: ctx.v1.id,
    authorisedByPersonId: ctx.vco.id,
    authorisedOn: today,
    authorisationEvidenceId: ctx.evidence.id,
  });
  const { person: pd } = await addStakeholder(actor, { projectId: ctx.project.id, name: "Programme Director" });
  const mobilisation = await createInformationRequest(actor, {
    projectId: ctx.project.id,
    reference: "IR-01",
    title: "Re-Qualification data",
  });
  const matter = await createMatter(actor, {
    projectId: ctx.project.id,
    code: `VL-${uid().slice(0, 4)}`,
    title: "Vendor deployment delay",
    driverIds: [ctx.driver.id],
    responseOwnerPersonId: pd.id,
  });
  return { actor, ...ctx, v1, pd, mobilisation, matter };
}
type Ctx = Awaited<ReturnType<typeof project>>;

const evidence = (ctx: Ctx, title = "Vendor status report") =>
  recordEvidence(ctx.actor, { projectId: ctx.project.id, code: `E-${uid()}`, title });

const isLocked = async (evidenceId: string) => {
  const r = await db().execute<{ locked: boolean }>(sql`select vo_evidence_is_locked(${evidenceId}::uuid) as locked`);
  return r.rows[0]!.locked;
};

async function governedState(ctx: Ctx) {
  const versions = await db()
    .select()
    .from(schema.valueCaseVersion)
    .where(eq(schema.valueCaseVersion.projectId, ctx.project.id));
  const drivers = await db()
    .select()
    .from(schema.valueDriverVersion)
    .where(eq(schema.valueDriverVersion.projectId, ctx.project.id));
  const [matter] = await db().select().from(schema.valueLeakage).where(eq(schema.valueLeakage.id, ctx.matter.id));
  const changes = await db().select().from(schema.valueChange).where(eq(schema.valueChange.projectId, ctx.project.id));
  const position = await getValuePositionSummary(ctx.project.id);
  return JSON.stringify({ versions, drivers, matter, changes, position });
}

async function draftReview(ctx: Ctx) {
  const review = await createReview(ctx.actor, { projectId: ctx.project.id, trigger: "ad_hoc", reviewDate: today });
  await upsertValuePositions(ctx.actor, {
    reviewId: review.id,
    positions: [{ valueDriverId: ctx.driver.id, currentForecast: "4500000.00" }],
  });
  return review;
}

// ---------------------------------------------------------------------------

describe("matter evidence is a working link", () => {
  it("links to a matter without locking the evidence, and unlinks while the matter is open", async () => {
    const ctx = await project();
    const e = await evidence(ctx);
    const link = await linkMatterEvidence(ctx.actor, { matterId: ctx.matter.id, evidenceId: e.id, relevanceNote: "x" });
    expect(link).toMatchObject({ valueLeakageId: ctx.matter.id, valueDriverVersionId: null, assuranceReviewId: null });
    expect(await isLocked(e.id)).toBe(false);
    await updateEvidence(ctx.actor, { evidenceId: e.id, title: "Vendor status report (rev)" }); // still editable

    const documented = await documentMatterEvidence(ctx.actor, {
      matterId: ctx.matter.id,
      code: `E-${uid()}`,
      title: "Revised schedule",
      valueDriverId: ctx.driver.id,
    });
    const ev = await getMatterEvidence(ctx.project.id, ctx.matter.id);
    expect(ev.linked.map((l) => l.evidence.id).sort()).toEqual([e.id, documented.id].sort());
    expect(ev.linked.every((l) => !l.locked)).toBe(true);
    const register = await getEvidenceRegister(ctx.project.id);
    const doc = register.entries.find((r) => r.evidence.id === documented.id)!;
    expect(doc.matterLinks.map((l) => l.code)).toEqual([ctx.matter.code]);
    expect(doc.driverLinks.map((l) => l.code)).toEqual(["VD-01"]);
    expect(doc.links).toEqual([]); // no formal reliance
    expect(doc.reviewLinks).toEqual([]);

    await unlinkMatterEvidence(ctx.actor, { evidenceLinkId: link.id });
    expect((await getMatterEvidence(ctx.project.id, ctx.matter.id)).linked).toHaveLength(1);
    const [stillThere] = await db().select().from(schema.evidence).where(eq(schema.evidence.id, e.id));
    expect(stillThere).toBeDefined(); // the evidence record is kept
  });

  it("changes a closed matter's evidence only after reopening", async () => {
    const ctx = await project();
    const e = await evidence(ctx);
    const link = await linkMatterEvidence(ctx.actor, { matterId: ctx.matter.id, evidenceId: e.id });
    await closeMatter(ctx.actor, { matterId: ctx.matter.id, closureNote: "Vendor recovered the schedule" });
    await expectDomainError(unlinkMatterEvidence(ctx.actor, { evidenceLinkId: link.id }), "VO_MATTER_CLOSED");
    await expectDomainError(
      linkMatterEvidence(ctx.actor, { matterId: ctx.matter.id, evidenceId: ctx.evidence.id }),
      "VO_MATTER_CLOSED",
    );
    // The database refuses it too, beneath the command layer.
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.unlinkMatterEvidence, (tx) =>
        tx.delete(schema.evidenceLink).where(eq(schema.evidenceLink.id, link.id)),
      ),
      "VO_MATTER_CLOSED",
    );
    await reopenMatter(ctx.actor, { matterId: ctx.matter.id });
    await unlinkMatterEvidence(ctx.actor, { evidenceLinkId: link.id });
  });

  it("links to a stable Value Driver identity without touching any version or Authorised Value", async () => {
    const ctx = await project();
    const e = await evidence(ctx);
    const before = await governedState(ctx);
    const link = await linkDriverEvidence(ctx.actor, { evidenceId: e.id, valueDriverId: ctx.driver.id });
    expect(link).toMatchObject({ valueDriverId: ctx.driver.id, valueDriverVersionId: null });
    expect(await isLocked(e.id)).toBe(false);
    expect(await governedState(ctx)).toBe(before); // versions, driver versions (incl. qualification), AV
    expect((await getValuePositionSummary(ctx.project.id)).authorisedTotal).toBe("4800000.00");
    await unlinkDriverEvidence(ctx.actor, { evidenceLinkId: link.id });
    await expectDomainError(
      linkDriverEvidence(ctx.actor, { evidenceId: e.id, valueDriverId: (await project()).driver.id }),
      "VO_NOT_FOUND",
    ); // another project's driver
  });

  it("each working link is written only by its own command and never edited", async () => {
    const ctx = await project();
    const e = await evidence(ctx);
    const link = await linkMatterEvidence(ctx.actor, { matterId: ctx.matter.id, evidenceId: e.id });
    const driverLink = await linkDriverEvidence(ctx.actor, { evidenceId: e.id, valueDriverId: ctx.driver.id });
    const values = { evidenceId: ctx.evidence.id, projectId: ctx.project.id };
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.linkEvidence, (tx) =>
        tx.insert(schema.evidenceLink).values({ ...values, valueLeakageId: ctx.matter.id }),
      ),
      "VO_WRONG_COMMAND",
    );
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.linkMatterEvidence, (tx) =>
        tx.insert(schema.evidenceLink).values({ ...values, valueDriverId: ctx.driver.id }),
      ),
      "VO_WRONG_COMMAND",
    );
    // The formal unlink paths cannot remove working links, and working unlinks cannot remove each other.
    await expectDomainError(unlinkEvidence(ctx.actor, { evidenceLinkId: link.id }), "VO_WRONG_COMMAND");
    await expectDomainError(unlinkDriverEvidence(ctx.actor, { evidenceLinkId: link.id }), "VO_NOT_FOUND");
    await expectDomainError(unlinkMatterEvidence(ctx.actor, { evidenceLinkId: driverLink.id }), "VO_NOT_FOUND");
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.unlinkMatterEvidence, (tx) =>
        tx.update(schema.evidenceLink).set({ relevanceNote: "x" }).where(eq(schema.evidenceLink.id, link.id)),
      ),
      "VO_FIELD_IMMUTABLE",
    );
    // Exactly one target, still.
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.linkMatterEvidence, (tx) =>
        tx
          .insert(schema.evidenceLink)
          .values({ ...values, valueLeakageId: ctx.matter.id, valueDriverId: ctx.driver.id }),
      ),
      "VO_CHECK_VIOLATION",
    );
  });
});

describe("formal evidence locking is unchanged", () => {
  it("locked evidence stays locked when also linked as working evidence", async () => {
    const ctx = await project();
    // ctx.evidence authorised V1: formally relied on, so locked.
    expect(await isLocked(ctx.evidence.id)).toBe(true);
    const link = await linkMatterEvidence(ctx.actor, { matterId: ctx.matter.id, evidenceId: ctx.evidence.id });
    const driverLink = await linkDriverEvidence(ctx.actor, {
      evidenceId: ctx.evidence.id,
      valueDriverId: ctx.driver.id,
    });
    await expectDomainError(
      updateEvidence(ctx.actor, { evidenceId: ctx.evidence.id, title: "x" }),
      "VO_EVIDENCE_LOCKED",
    );
    await unlinkMatterEvidence(ctx.actor, { evidenceLinkId: link.id });
    await unlinkDriverEvidence(ctx.actor, { evidenceLinkId: driverLink.id });
    expect(await isLocked(ctx.evidence.id)).toBe(true);
    await expectDomainError(
      updateEvidence(ctx.actor, { evidenceId: ctx.evidence.id, title: "x" }),
      "VO_EVIDENCE_LOCKED",
    );
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.linkMatterEvidence, (tx) =>
        tx.update(schema.evidence).set({ title: "x" }).where(eq(schema.evidence.id, ctx.evidence.id)),
      ),
      "VO_EVIDENCE_LOCKED",
    );
  });

  it("a review adopts matter evidence only when linked deliberately; finalising then locks it", async () => {
    const ctx = await project();
    const relied = await documentMatterEvidence(ctx.actor, {
      matterId: ctx.matter.id,
      code: `E-${uid()}`,
      title: "Revised vendor implementation schedule",
    });
    const notRelied = await documentMatterEvidence(ctx.actor, {
      matterId: ctx.matter.id,
      code: `E-${uid()}`,
      title: "Email thread",
    });
    const review = await draftReview(ctx);
    const candidates = await listOpenMatterEvidence(ctx.project.id);
    expect(candidates.map((c) => c.evidenceId).sort()).toEqual([relied.id, notRelied.id].sort());
    expect((await getAssuranceWorkspace(ctx.project.id, review.id))!.evidence).toEqual([]); // nothing adopted

    await linkReviewEvidence(ctx.actor, { reviewId: review.id, evidenceId: relied.id, relevanceNote: "Supports" });
    await finaliseReview(ctx.actor, { reviewId: review.id });

    const reviewEvidence = (await getAssuranceWorkspace(ctx.project.id, review.id))!.evidence;
    expect(reviewEvidence.map((e) => e.evidenceId)).toEqual([relied.id]);
    expect(await isLocked(relied.id)).toBe(true);
    await expectDomainError(updateEvidence(ctx.actor, { evidenceId: relied.id, title: "x" }), "VO_EVIDENCE_LOCKED");
    expect(await isLocked(notRelied.id)).toBe(false); // working evidence was not silently locked
    await updateEvidence(ctx.actor, { evidenceId: notRelied.id, title: "Email thread (annotated)" });

    // The living matter keeps its own lifecycle.
    await setMatterStage(ctx.actor, { matterId: ctx.matter.id, stage: "monitoring" });
    const workingLink = (await getMatterEvidence(ctx.project.id, ctx.matter.id)).linked.find(
      (l) => l.evidence.id === relied.id,
    )!;
    await unlinkMatterEvidence(ctx.actor, { evidenceLinkId: workingLink.linkId });
    expect(await isLocked(relied.id)).toBe(true); // formal reliance is unaffected
    expect((await getAssuranceWorkspace(ctx.project.id, review.id))!.evidence).toHaveLength(1);
  });
});

describe("Information Requests during Assurance", () => {
  it("raises Assurance requests after mobilisation, with items for a matter and a Value Driver", async () => {
    const ctx = await project();
    const assurance = await createInformationRequest(ctx.actor, {
      projectId: ctx.project.id,
      reference: "IR-02",
      title: "Assurance evidence",
      purpose: "assurance",
    });
    expect(assurance.purpose).toBe("assurance");
    expect(ctx.mobilisation.purpose).toBe("mobilisation");
    const item = await addInformationRequestItem(ctx.actor, {
      informationRequestId: assurance.id,
      description: "Revised vendor implementation schedule",
      requestedFromPersonId: ctx.pd.id,
      dueOn: "2026-10-05",
      valueDriverId: ctx.driver.id,
      valueLeakageId: ctx.matter.id,
    });
    expect(item).toMatchObject({ status: "open", valueLeakageId: ctx.matter.id, valueDriverId: ctx.driver.id });

    // A new request raised straight from the matter, in one transaction.
    const fromMatter = await requestMatterEvidence(ctx.actor, {
      matterId: ctx.matter.id,
      newRequestTitle: "Assurance evidence — vendor",
      description: "Vendor resourcing plan",
    });
    const ws = await getInformationRequestWorkspace(ctx.project.id);
    expect(ws.requests.map((r) => [r.request.reference, r.request.purpose])).toEqual([
      ["IR-01", "mobilisation"],
      ["IR-02", "assurance"],
      ["IR-03", "assurance"],
    ]);
    expect(ws.requests[2]!.items.map((i) => i.item.id)).toEqual([fromMatter.id]);
    expect(ws.requests[1]!.items[0]!.matter).toMatchObject({ id: ctx.matter.id, code: ctx.matter.code });
    // Adding to an existing Assurance request.
    const second = await requestMatterEvidence(ctx.actor, {
      matterId: ctx.matter.id,
      informationRequestId: assurance.id,
      description: "Steering committee minutes",
    });
    expect(second).toMatchObject({ informationRequestId: assurance.id, sequence: 2 });
    await expectDomainError(
      requestMatterEvidence(ctx.actor, { matterId: ctx.matter.id, description: "Neither" }),
      "VO_INVALID_INPUT",
    );
  });

  it("keeps matter items on Assurance requests, and purposes and matters fixed", async () => {
    const ctx = await project();
    await expectDomainError(
      addInformationRequestItem(ctx.actor, {
        informationRequestId: ctx.mobilisation.id,
        description: "x",
        valueLeakageId: ctx.matter.id,
      }),
      "VO_REQUEST_PURPOSE",
    );
    await expectDomainError(
      requestMatterEvidence(ctx.actor, {
        matterId: ctx.matter.id,
        informationRequestId: ctx.mobilisation.id,
        description: "x",
      }),
      "VO_REQUEST_PURPOSE",
    );
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.createInformationRequest, (tx) =>
        tx.insert(schema.informationRequest).values({ projectId: ctx.project.id, reference: "IR-Z", title: "z" }),
      ),
      "VO_INVALID_INPUT",
    );
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.createInformationRequest, (tx) =>
        tx
          .update(schema.informationRequest)
          .set({ purpose: "assurance" })
          .where(eq(schema.informationRequest.id, ctx.mobilisation.id)),
      ),
      "VO_FIELD_IMMUTABLE",
    );
    const item = await requestMatterEvidence(ctx.actor, {
      matterId: ctx.matter.id,
      newRequestTitle: "A",
      description: "x",
    });
    const other = await createMatter(ctx.actor, { projectId: ctx.project.id, code: `VL-${uid()}`, title: "Other" });
    await expectDomainError(
      asCommand(ctx.actor, COMMANDS.updateInformationRequestItem, (tx) =>
        tx
          .update(schema.informationRequestItem)
          .set({ valueLeakageId: other.id })
          .where(eq(schema.informationRequestItem.id, item.id)),
      ),
      "VO_FIELD_IMMUTABLE",
    );
    await closeMatter(ctx.actor, { matterId: other.id, closureNote: "n/a" });
    await expectDomainError(
      requestMatterEvidence(ctx.actor, { matterId: other.id, newRequestTitle: "B", description: "x" }),
      "VO_MATTER_CLOSED",
    );
  });

  it("fulfilment is traceable and changes nothing governed, nor the matter's stage or working figures", async () => {
    const ctx = await project();
    await setMatterStage(ctx.actor, { matterId: ctx.matter.id, stage: "awaiting_evidence" });
    await assessMatterWorking(ctx.actor, { matterId: ctx.matter.id, workingTotalAmount: "250000.00" });
    const review = await draftReview(ctx);
    await finaliseReview(ctx.actor, { reviewId: review.id });
    const item = await requestMatterEvidence(ctx.actor, {
      matterId: ctx.matter.id,
      newRequestTitle: "Assurance evidence",
      description: "Revised vendor implementation schedule",
      requestedFromPersonId: ctx.pd.id,
      valueDriverId: ctx.driver.id,
    });
    const before = await governedState(ctx);

    const received = await documentMatterEvidence(ctx.actor, {
      matterId: ctx.matter.id,
      code: `E-${uid()}`,
      title: "Revised vendor implementation schedule v2",
      receivedOn: today,
    });
    await updateInformationRequestItem(ctx.actor, {
      itemId: item.id,
      status: "received",
      fulfilledByEvidenceId: received.id,
    });

    expect(await governedState(ctx)).toBe(before); // stage, working figures, forecast, gap, AV, versions
    const m = (await getAssuranceMatter(ctx.project.id, ctx.matter.id))!;
    expect(m.leakage.stage).toBe("awaiting_evidence");
    expect(m.working?.total).toBe("250000.00");
    const ev = await getMatterEvidence(ctx.project.id, ctx.matter.id);
    expect(ev.items).toHaveLength(1);
    expect(ev.items[0]).toMatchObject({
      item: { status: "received", valueDriverId: ctx.driver.id },
      requestedFromName: "Programme Director",
      driverCode: "VD-01",
      evidence: { id: received.id, code: received.code },
    });
    const register = await getEvidenceRegister(ctx.project.id);
    expect(register.entries.find((e) => e.evidence.id === received.id)!.fulfils).toMatchObject([{ sequence: 1 }]);
    expect(await isLocked(received.id)).toBe(false);
    // The consultant moves the stage explicitly.
    await setMatterStage(ctx.actor, { matterId: ctx.matter.id, stage: "assessing" });
  });
});

describe("legacy requests and issued reports", () => {
  it("pre-4D.2 requests (no purpose) stay readable as Mobilisation and their reports render", async () => {
    const ctx = await project();
    const legacy = await asCommand(ctx.actor, COMMANDS.createInformationRequest, async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      const [r] = await tx
        .insert(schema.informationRequest)
        .values({ projectId: ctx.project.id, reference: "IR-00", title: "Legacy request" })
        .returning();
      return r!;
    });
    expect(legacy.purpose).toBeNull();
    expect(irPurposeLabel(legacy.purpose)).toBe("Mobilisation");
    await addInformationRequestItem(ctx.actor, { informationRequestId: legacy.id, description: "Baseline data" });
    await issueInformationRequest(ctx.actor, { informationRequestId: legacy.id, issuedOn: today });
    const built = (await buildInformationRequestReport(ctx.project.id, legacy.id))!;
    expect(built.issuable.ok).toBe(true);
    expect(text(renderReportArticle(built.model, { state: "preview" }))).toContain("Baseline data");
  });

  it("an issued Information Request report is not changed by later Assurance requests or evidence", async () => {
    const ctx = await project();
    await addInformationRequestItem(ctx.actor, { informationRequestId: ctx.mobilisation.id, description: "Org chart" });
    await issueInformationRequest(ctx.actor, { informationRequestId: ctx.mobilisation.id, issuedOn: today });
    const issued = await issueReport(ctx.actor, {
      type: "information_request",
      projectId: ctx.project.id,
      subjectId: ctx.mobilisation.id,
    });
    const snapshot = JSON.stringify((await getReportIssue(ctx.project.id, issued.id))!);

    await requestMatterEvidence(ctx.actor, { matterId: ctx.matter.id, newRequestTitle: "A", description: "x" });
    await documentMatterEvidence(ctx.actor, { matterId: ctx.matter.id, code: `E-${uid()}`, title: "y" });

    expect(JSON.stringify((await getReportIssue(ctx.project.id, issued.id))!)).toBe(snapshot);
    const model = (await buildInformationRequestReport(ctx.project.id, ctx.mobilisation.id))!.model;
    expect(model.items.map((i) => i.description)).toEqual(["Org chart"]); // the other request's items stay separate
  });
});
