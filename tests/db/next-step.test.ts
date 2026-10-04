import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CANONICAL, canonicalJourney } from "@/fixtures/canonical";
import { recordEvidence } from "@/server/commands/evidence";
import { authoriseValueChange, createValueChange, proposeValueChange } from "@/server/commands/value-change";
import { createDraftVersion } from "@/server/commands/value-case";
import { getProjectOverview } from "@/server/queries/projects";
import { getValueCaseTimeline } from "@/server/queries/value-case";

import { newActor, newProject, uid } from "../support/fixtures";

// Phase 4D.10B regression: the Overview's "Next step" checklist leads to the first Authorised Value Case. Once any
// version has been authorised — including V1 later superseded by a Value Change — the project never falls back into
// it. The canonical journey creates no Information Request, exactly like DEMO-TRAJ2, which used to be told to
// "Create the Information Request" after V2 was authorised.

const step = async (projectId: string) => (await getProjectOverview(projectId))!.nextStep;
const statuses = async (projectId: string) =>
  (await getValueCaseTimeline(projectId)).map((t) => `V${t.version.versionNumber}:${t.version.status}`);

beforeAll(() => {
  // Same clock pin as the canonical journey tests: the domain stamps recommendation issue and finalisation.
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true, now: new Date(`${CANONICAL.journeyDate}T09:00:00Z`) });
});
afterAll(() => {
  vi.useRealTimers();
});

describe("nextStep across the Value Case lifecycle", () => {
  it("guides a project with no authorised version, including a draft V1", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor, { valueBasis: false });
    expect((await step(project.id))?.label).toBe("Define the Value Basis");

    const { project: p2 } = await newProject(actor);
    await createDraftVersion(actor, { projectId: p2.id, title: "Value Case" });
    expect(await statuses(p2.id)).toEqual(["V1:draft"]);
    expect((await step(p2.id))?.label).toMatch(/Value Case Owner/);
  });

  it("gives no step once V1 is authorised, after V2 supersedes it, and after a further V3", async () => {
    const actor = await newActor();
    const j = canonicalJourney(actor, { code: `NEXT-${uid()}`, name: "Next step regression (SYNTHETIC)" });
    const s = await j.establish({ inherited: true });
    expect(await statuses(s.project.id)).toEqual(["V0:recorded", "V1:authorised"]);
    expect(await step(s.project.id)).toBeNull();

    await j.assure();
    await j.change();
    await j.proposeChange();
    // While VC-001 is open V1 is still the version in force.
    expect(await step(s.project.id)).toBeNull();

    await j.authoriseChange();
    expect(await statuses(s.project.id)).toEqual(["V0:recorded", "V1:superseded", "V2:authorised"]);
    const overview = (await getProjectOverview(s.project.id))!;
    expect(overview.requests).toHaveLength(0); // the condition that used to surface "Create the Information Request"
    expect(overview.nextStep).toBeNull();

    // A further, phasing-only Value Change: V3 in force, V1 and V2 superseded.
    const { change } = await createValueChange(actor, {
      projectId: s.project.id,
      code: "VC-002",
      reason: "Phasing confirmation (synthetic regression)",
      statedChangeAmount: "0.00",
    });
    await proposeValueChange(actor, { changeId: change.id });
    const ev = await recordEvidence(actor, { projectId: s.project.id, code: "E-099", title: "VCO approval of VC-002" });
    await authoriseValueChange(actor, {
      changeId: change.id,
      authorisedByPersonId: s.vco.id,
      authorisedOn: j.journeyDate,
      authorisationEvidenceId: ev.id,
    });
    expect(await statuses(s.project.id)).toEqual(["V0:recorded", "V1:superseded", "V2:superseded", "V3:authorised"]);
    expect(await step(s.project.id)).toBeNull();
  });
});
