import { describe, expect, it } from "vitest";

import { recordEvidence, updateEvidence } from "@/server/commands/evidence";
import {
  addValueDriver,
  createInheritedBusinessCase,
  linkEvidence,
  recordInheritedBusinessCase,
} from "@/server/commands/value-case";

import { expectDomainError, newActor, newProject } from "../support/fixtures";

// Regression for 0002_fix_evidence_lock_parameter: evidence is locked only when
// *it* is relied on by a non-draft version — not whenever any link exists.
describe("evidence locking scope", () => {
  async function projectWithRecordedLink() {
    const actor = await newActor();
    const { project } = await newProject(actor);
    const v0 = await createInheritedBusinessCase(actor, { projectId: project.id, title: "BC" });
    const { driverVersion } = await addValueDriver(actor, { versionId: v0.id, code: "VD-01", name: "D" });
    const linked = await recordEvidence(actor, { projectId: project.id, code: "E-001", title: "Linked" });
    const unrelated = await recordEvidence(actor, { projectId: project.id, code: "E-002", title: "Unrelated" });
    await linkEvidence(actor, { evidenceId: linked.id, driverVersionId: driverVersion.id });
    await recordInheritedBusinessCase(actor, { versionId: v0.id });
    return { actor, project, linked, unrelated };
  }

  it("locks evidence relied on by a recorded version", async () => {
    const { actor, linked } = await projectWithRecordedLink();
    await expectDomainError(updateEvidence(actor, { evidenceId: linked.id, title: "Changed" }), "VO_EVIDENCE_LOCKED");
  });

  it("leaves unrelated evidence in the same project editable", async () => {
    const { actor, unrelated } = await projectWithRecordedLink();
    const row = await updateEvidence(actor, { evidenceId: unrelated.id, title: "Still editable" });
    expect(row.title).toBe("Still editable");
  });

  it("leaves evidence in other projects editable", async () => {
    await projectWithRecordedLink();
    const actor = await newActor();
    const { project } = await newProject(actor);
    const e = await recordEvidence(actor, { projectId: project.id, code: "E-001", title: "Elsewhere" });
    const row = await updateEvidence(actor, { evidenceId: e.id, summary: "Edited" });
    expect(row.summary).toBe("Edited");
  });
});
