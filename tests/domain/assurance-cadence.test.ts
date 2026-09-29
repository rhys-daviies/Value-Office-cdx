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

  it("six-monthly is anchored on Go-Live: +6, then +12 months", () => {
    const withGoLive = { ...base, keyDates: [{ kind: "go_live", date: "2026-03-10" }] };
    expect(find(withGoLive, "six_month")).toMatchObject({ status: "due", date: "2026-09-10" });
    expect(find(withGoLive, "six_month")?.basis).toMatch(/Go-Live \(2026-03-10\) \+ 6 months/);
    const oneDone = { ...withGoLive, reviews: [review({ trigger: "six_month", reviewDate: "2026-09-10" })] };
    expect(find(oneDone, "six_month")).toMatchObject({ status: "upcoming", date: "2027-03-10" });
  });

  it("handles month ends from the anchor without drifting", () => {
    const keyDates = [{ kind: "go_live", date: "2026-08-31" }];
    expect(find({ ...base, today: "2026-01-01", keyDates }, "six_month")?.date).toBe("2027-02-28");
    const one = review({ trigger: "six_month", reviewDate: "2027-02-28" });
    // +12 from the anchor is 31 Aug — not 28 Aug, which chaining from 28 Feb would give.
    expect(find({ ...base, today: "2026-01-01", keyDates, reviews: [one] }, "six_month")?.date).toBe("2027-08-31");
  });

  it("a late or early review does not move the next scheduled occurrence", () => {
    const keyDates = [{ kind: "go_live", date: "2026-01-31" }];
    const late = review({ trigger: "six_month", reviewDate: "2026-09-15" }); // due 2026-07-31
    expect(find({ ...base, keyDates, reviews: [late] }, "six_month")?.date).toBe("2027-01-31");
    const early = review({ trigger: "six_month", reviewDate: "2026-06-01" });
    expect(find({ ...base, keyDates, reviews: [early] }, "six_month")?.date).toBe("2027-01-31");
    // Ad-hoc reviews are separate and do not satisfy the six-monthly cadence.
    const adHoc = review({ trigger: "ad_hoc", reviewDate: "2026-07-31" });
    expect(find({ ...base, keyDates, reviews: [adHoc] }, "six_month")?.date).toBe("2026-07-31");
  });

  it("does not invent a six-monthly date without Go-Live, unless six-month key dates are recorded", () => {
    expect(find(base, "six_month")).toMatchObject({ status: "unknown", date: null });
    const explicit = {
      ...base,
      keyDates: [
        { kind: "six_month_review", date: "2026-09-30" },
        { kind: "six_month_review", date: "2027-03-31" },
      ],
    };
    expect(find(explicit, "six_month")).toMatchObject({ status: "due", date: "2026-09-30" });
    const oneDone = { ...explicit, reviews: [review({ trigger: "six_month" })] };
    expect(find(oneDone, "six_month")).toMatchObject({ status: "upcoming", date: "2027-03-31" });
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
