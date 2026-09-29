import { describe, expect, it } from "vitest";

import { addMonths, deriveAssuranceRequirements, nextRequirement, type CadenceInput } from "@/domain/assurance-cadence";

const base: CadenceInput = {
  today: "2026-10-01",
  authorised: true,
  authorisationRecordedAt: new Date("2026-09-01T00:00:00Z"),
  keyDates: [],
  reviews: [],
  materialEvidence: [],
};
const find = (input: CadenceInput, trigger: string) =>
  deriveAssuranceRequirements(input).find((r) => r.trigger === trigger);
const review = (over: Partial<CadenceInput["reviews"][number]>): CadenceInput["reviews"][number] => ({
  id: "r1",
  sequence: 1,
  trigger: "ad_hoc",
  status: "finalised",
  reviewDate: "2026-09-15",
  finalisedAt: new Date("2026-09-15T12:00:00Z"),
  triggerEvidenceId: null,
  ...over,
});

describe("addMonths", () => {
  it("clamps to the end of shorter months", () => {
    expect(addMonths("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonths("2027-08-31", 6)).toBe("2028-02-29");
    expect(addMonths("2026-03-15", 6)).toBe("2026-09-15");
  });
});

describe("deriveAssuranceRequirements", () => {
  it("derives nothing before the Value Case is authorised", () => {
    expect(deriveAssuranceRequirements({ ...base, authorised: false })).toEqual([]);
  });

  it("kick-off: due when the date has passed, upcoming before, done once finalised", () => {
    expect(find({ ...base, keyDates: [{ kind: "kickoff", date: "2026-09-20" }] }, "kickoff")?.status).toBe("due");
    expect(find({ ...base, keyDates: [{ kind: "kickoff", date: "2026-11-01" }] }, "kickoff")?.status).toBe("upcoming");
    expect(find({ ...base, reviews: [review({ trigger: "kickoff" })] }, "kickoff")?.status).toBe("satisfied");
    expect(
      find({ ...base, reviews: [review({ trigger: "kickoff", status: "draft", finalisedAt: null })] }, "kickoff")
        ?.status,
    ).toBe("in_progress");
  });

  it("Go-Live cannot be derived without a Go-Live date", () => {
    expect(find(base, "go_live")).toMatchObject({ status: "unknown", basis: expect.stringMatching(/Go-Live date/) });
    expect(find({ ...base, keyDates: [{ kind: "go_live", date: "2027-03-01" }] }, "go_live")).toMatchObject({
      status: "upcoming",
      date: "2027-03-01",
    });
  });

  it("six-monthly is anchored on the latest finalised review and states its basis", () => {
    expect(find(base, "six_month")?.status).toBe("unknown");
    const r = find({ ...base, reviews: [review({ reviewDate: "2026-03-10" })] }, "six_month");
    expect(r).toMatchObject({ status: "due", date: "2026-09-10" });
    expect(r?.basis).toMatch(/Six months after the latest finalised review \(#1, 2026-03-10\)/);
    expect(find({ ...base, reviews: [review({})] }, "six_month")).toMatchObject({
      status: "upcoming",
      date: "2027-03-15",
    });
  });

  it("flags material-change evidence recorded since the latest finalised position and not yet reviewed", () => {
    const evidence = {
      id: "e1",
      code: "E-007",
      title: "Vendor delay notice",
      createdAt: new Date("2026-09-20T00:00:00Z"),
      reviewIds: [],
    };
    const withReview = { ...base, reviews: [review({})], materialEvidence: [evidence] };
    expect(find(withReview, "material_evidence_change")).toMatchObject({
      status: "due",
      evidence: [{ code: "E-007" }],
    });

    // Older than the latest finalised review: already covered by that position.
    const older = { ...evidence, createdAt: new Date("2026-09-10T00:00:00Z") };
    expect(find({ ...withReview, materialEvidence: [older] }, "material_evidence_change")).toBeUndefined();

    // Associated with an open draft review: in progress.
    const inDraft = { ...evidence, reviewIds: ["r2"] };
    const draft = review({ id: "r2", sequence: 2, status: "draft", finalisedAt: null, reviewDate: "2026-09-25" });
    expect(
      find({ ...withReview, reviews: [review({}), draft], materialEvidence: [inDraft] }, "material_evidence_change")
        ?.status,
    ).toBe("in_progress");
  });

  it("nextRequirement prefers due, then in progress, then the earliest upcoming", () => {
    const reqs = deriveAssuranceRequirements({
      ...base,
      keyDates: [
        { kind: "kickoff", date: "2026-11-01" },
        { kind: "go_live", date: "2026-10-15" },
      ],
    });
    expect(nextRequirement(reqs)).toMatchObject({ trigger: "go_live", status: "upcoming" });
    const due = deriveAssuranceRequirements({ ...base, keyDates: [{ kind: "kickoff", date: "2026-09-01" }] });
    expect(nextRequirement(due)).toMatchObject({ trigger: "kickoff", status: "due" });
  });
});
