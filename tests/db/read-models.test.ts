import { describe, expect, it } from "vitest";

import { seedHorizon } from "@/fixtures/horizon";
import { recordEvidence } from "@/server/commands/evidence";
import { addStakeholder, setValueCaseOwner } from "@/server/commands/stakeholders";
import { addValueDriver, createDraftVersion, linkEvidence, proposeVersion } from "@/server/commands/value-case";
import { getEvidenceRegister } from "@/server/queries/evidence";
import { getProjectHistory } from "@/server/queries/history";
import { getProjectOverview, listProjects } from "@/server/queries/projects";
import { getRequalificationWorkspace, getValueCaseTimeline, getVersionDetail } from "@/server/queries/value-case";

import { newActor, newProject, uid } from "../support/fixtures";

describe("read models over Horizon", () => {
  it("expose inherited $18.0m, authorised $15.5m and six drivers", async () => {
    const actor = await newActor();
    const { project } = await seedHorizon(actor, { projectCode: `HORIZON-${uid()}` });

    const timeline = await getValueCaseTimeline(project.id);
    expect(timeline.map((t) => [t.version.versionNumber, t.version.status, t.headlineTotal])).toEqual([
      [0, "recorded", "18000000.00"],
      [1, "authorised", "15500000.00"],
      // VC-002 proposed only: V2 is an unadjusted copy of V1 (per-driver allocation unknown).
      [2, "proposed", "15500000.00"],
    ]);

    const ws = await getRequalificationWorkspace(project.id);
    expect(ws.inheritedTotal).toBe("18000000.00");
    expect(ws.requalifiedSummary.financialTotal).toBe("15500000.00");
    expect(ws.comparison).toHaveLength(6);
    expect(ws.comparison.every((r) => r.inherited === null && r.requalified !== null)).toBe(true);
    expect(ws.nextDriverCode).toBe("VD-07");

    const v1 = await getVersionDetail(project.id, 1);
    expect(v1!.authoriserName).toBe("[FIXTURE PLACEHOLDER] Value Case Owner");
    expect(v1!.evidenceCode).toBe("E-001");
    expect(v1!.drivers.map((d) => d.name)).toEqual([
      "Service Productivity",
      "Customer Retention",
      "Technology Run Cost",
      "Contact Avoidance",
      "Quality / Rework",
      "New Automation",
    ]);

    const overview = await getProjectOverview(project.id);
    expect(overview!.nextStep).toBeNull();
    expect(overview!.header.valueBasisLocked).toBe(true);

    const listed = (await listProjects()).find((p) => p.id === project.id);
    expect(listed!.latestVersion).toMatchObject({ versionNumber: 1, status: "authorised" });
  });
});

describe("evidence register", () => {
  it("reports links and lock state per evidence item", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    const { person } = await addStakeholder(actor, { projectId: project.id, name: "VCO" });
    await setValueCaseOwner(actor, { projectId: project.id, personId: person.id });
    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "V1" });
    const { driverVersion } = await addValueDriver(actor, {
      adjustmentRationale: "Synthetic test rationale",
      versionId: v1.id,
      code: "VD-01",
      name: "D",
      financialValue: "1.00",
    });
    const linked = await recordEvidence(actor, { projectId: project.id, code: "E-001", title: "Linked" });
    await recordEvidence(actor, { projectId: project.id, code: "E-002", title: "Loose" });
    await linkEvidence(actor, { evidenceId: linked.id, driverVersionId: driverVersion.id });

    let reg = await getEvidenceRegister(project.id);
    expect(reg.entries.map((e) => [e.evidence.code, e.links.length, e.locked])).toEqual([
      ["E-001", 1, false],
      ["E-002", 0, false],
    ]);

    await proposeVersion(actor, { versionId: v1.id });
    reg = await getEvidenceRegister(project.id);
    expect(reg.entries.map((e) => [e.evidence.code, e.locked])).toEqual([
      ["E-001", true],
      ["E-002", false],
    ]);
  });
});

describe("project history", () => {
  it("groups row changes by command and attributes the consultant", async () => {
    const actor = await newActor();
    const { project } = await newProject(actor);
    const v1 = await createDraftVersion(actor, { projectId: project.id, title: "V1" });
    await addValueDriver(actor, { versionId: v1.id, code: "VD-01", name: "D" });

    const history = await getProjectHistory(project.id);
    expect(history[0]!.command).toBe("valueCase.addValueDriver");
    expect(history[0]!.changes.map((c) => c.tableName)).toEqual(["value_driver", "value_driver_version"]);
    expect(history.map((h) => h.command)).toContain("project.create");
    expect(new Set(history.map((h) => h.actorEmail))).toEqual(new Set([expect.stringMatching(/@cardaxia\.ai$/)]));

    // Another project's changes never appear.
    const other = await newProject(actor);
    await createDraftVersion(actor, { projectId: other.project.id, title: "Other V1" });
    const again = await getProjectHistory(project.id);
    expect(
      again.flatMap((h) => h.changes).some((c) => (c.newRow as { title?: string } | null)?.title === "Other V1"),
    ).toBe(false);
  });
});
