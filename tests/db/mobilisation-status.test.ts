import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { MobilisationItem } from "@/domain/mobilisation";
import { CANONICAL, canonicalJourney } from "@/fixtures/canonical";
import { recordEvidence } from "@/server/commands/evidence";
import {
  addInformationRequestItem,
  createInformationRequest,
  issueInformationRequest,
  updateInformationRequestItem,
} from "@/server/commands/information-request";
import { addStakeholder, setValueCaseOwner } from "@/server/commands/stakeholders";
import {
  addValueDriver,
  authoriseInitialVersion,
  createDraftVersion,
  createInheritedBusinessCase,
  proposeVersion,
  recordInheritedBusinessCase,
} from "@/server/commands/value-case";
import { getMobilisationStatus, getProjectOverview } from "@/server/queries/projects";

import { newActor, newProject, uid } from "../support/fixtures";

// Phase 4D.10C: the derived Mobilisation status, walked through the pre-V1 journey with the real commands, and the
// 4D.10B rule that a project with an authorised Value Case never returns to the checklist.

const status = async (projectId: string) => (await getMobilisationStatus(projectId))!.status;
const keys = (items: readonly MobilisationItem[]) => items.map((i) => i.key);
const item = async (projectId: string, key: MobilisationItem["key"]) => {
  const s = await status(projectId);
  return [...s.completed, ...s.outstanding].find((i) => i.key === key)!;
};

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true, now: new Date(`${CANONICAL.journeyDate}T09:00:00Z`) });
});
afterAll(() => {
  vi.useRealTimers();
});

describe("Mobilisation status through the pre-V1 journey", () => {
  it("walks from a new project to an authorised V1, always recommending the next step", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor, { valueBasis: false });
    const id = project.id;

    // New project: only the project record is established; Value Basis is the first required step.
    let s = await status(id);
    expect(s.stage).toBe("mobilising");
    expect(keys(s.completed)).toEqual(["project"]);
    expect(s.next).toEqual({ label: "Define the Value Basis", href: "setup#value-basis" });
    const required = s.outstanding.filter((i) => i.requirement === "required").map((i) => i.key);
    expect(required).toEqual(["value-basis", "vco", "v1-draft", "v1-drivers", "v1-proposed", "v1-authorised"]);
    const recommended = s.outstanding.filter((i) => i.requirement === "recommended").map((i) => i.key);
    expect(recommended).toEqual(["kickoff", "go-live", "information-request", "original-business-case"]);

    // VCO missing.
    const { project: p2 } = await newProject(actor);
    expect((await status(p2.id)).next?.label).toBe("Nominate the Value Case Owner");
    expect((await item(p2.id, "vco")).detail).toMatch(/Not nominated/);
    const { person: vco } = await addStakeholder(actor, { projectId: p2.id, name: "Val Owner" });
    await setValueCaseOwner(actor, { projectId: p2.id, personId: vco.id });
    expect((await item(p2.id, "vco")).done).toBe(true);

    // Information Request absent → recommended next action, reached from Mobilisation.
    s = await status(p2.id);
    expect(s.next).toEqual({ label: "Create the Day-1 Information Request", href: "setup#day-one-request" });

    // Present but a draft → issue it; issued with outstanding items → done, outstanding count shown.
    const ir = await createInformationRequest(actor, { projectId: p2.id, reference: "IR-01", title: "Day-1" });
    const a = await addInformationRequestItem(actor, { informationRequestId: ir.id, description: "Business Case" });
    await addInformationRequestItem(actor, { informationRequestId: ir.id, description: "Programme plan" });
    expect((await status(p2.id)).next).toEqual({ label: "Issue IR-01", href: "information-request" });
    await issueInformationRequest(actor, { informationRequestId: ir.id, issuedOn: CANONICAL.journeyDate });
    let ri = await item(p2.id, "information-request");
    expect(ri.done).toBe(true);
    expect(ri.detail).toBe("IR-01 issued — 2 of 2 items outstanding");
    await updateInformationRequestItem(actor, { itemId: a.id, status: "received" });
    ri = await item(p2.id, "information-request");
    expect(ri.detail).toBe("IR-01 issued — 1 of 2 items outstanding");

    // Original Business Case absent → draft → recorded.
    expect((await status(p2.id)).next?.label).toBe("Capture the Original Business Case");
    const v0 = await createInheritedBusinessCase(actor, {
      projectId: p2.id,
      title: "Original Business Case",
      statedTotalValue: "1000000.00",
    });
    expect((await status(p2.id)).next).toEqual({
      label: "Finish and record the Original Business Case",
      href: "value-case/v/0",
    });
    await recordInheritedBusinessCase(actor, { versionId: v0.id });
    expect((await item(p2.id, "original-business-case")).done).toBe(true);

    // V1 draft (no drivers) → drivers → proposed → authorised.
    expect((await status(p2.id)).next?.label).toMatch(/Start Value Case Definition/);
    const v1 = await createDraftVersion(actor, { projectId: p2.id, title: "Value Case", basedOnVersionId: v0.id });
    expect((await status(p2.id)).next?.label).toBe("Add Value Drivers to the draft V1");
    await addValueDriver(actor, { versionId: v1.id, code: "VD-01", name: "D", financialValue: "900000.00" });
    expect((await item(p2.id, "v1-drivers")).detail).toBe(
      "1 driver · 1 unqualified · 1 unevidenced (visible, not blocking)",
    );
    expect((await status(p2.id)).next?.label).toBe("Complete Value Case Definition and propose V1");
    await proposeVersion(actor, { versionId: v1.id });
    expect((await status(p2.id)).next?.label).toBe("Record the VCO's authorisation of the proposed Value Case");
    const ev = await recordEvidence(actor, { projectId: p2.id, code: "E-001", title: "Signed notice" });
    await authoriseInitialVersion(actor, {
      versionId: v1.id,
      authorisedByPersonId: vco.id,
      authorisedOn: CANONICAL.journeyDate,
      authorisationEvidenceId: ev.id,
    });
    s = await status(p2.id);
    expect(s).toMatchObject({ stage: "authorised", inForceVersionNumber: 1, outstanding: [], next: null });
  });

  it("never returns to the checklist after V1 is superseded by an authorised V2 (4D.10B regression)", async () => {
    const actor = await newActor();
    const j = canonicalJourney(actor, { code: `MOB-${uid()}`, name: "Mobilisation status (SYNTHETIC)" });
    const s0 = await j.establish({ inherited: true });
    await j.assure();
    await j.change();
    await j.proposeChange();
    await j.authoriseChange();
    const s = await status(s0.project.id);
    expect(s).toMatchObject({ stage: "authorised", inForceVersionNumber: 2, outstanding: [], next: null });
    // No Information Request was ever created — the condition behind the original defect.
    const o = (await getProjectOverview(s0.project.id))!;
    expect(o.requests).toHaveLength(0);
    expect(o.nextStep).toBeNull();
  });
});
