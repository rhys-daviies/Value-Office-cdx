// Mobilisation status (Phase 4D.10C): what has been established, what remains outstanding and the recommended next
// action on the way to the first Authorised Value Case. Derived at read time from authoritative facts — nothing is
// stored, scored or gated. "Required" marks only what the domain itself already requires for V1 (a Value Basis and
// at least one driver to propose; a VCO to record authorisation); everything else is "recommended" guidance.
// Once any Value Case version has ever been authorised the checklist ends for good (4D.10B rule).

export type Requirement = "required" | "recommended";

export type MobilisationFacts = {
  /** Any value_case version authorised or superseded. */
  everAuthorised: boolean;
  /** The Authorised Value Case in force, once there is one. */
  inForceVersionNumber: number | null;
  hasValueBasis: boolean;
  hasValuePeriod: boolean;
  vcoName: string | null;
  kickoffDate: string | null;
  goLiveDate: string | null;
  /** Mobilisation-purpose Information Requests (legacy requests without a purpose read as Mobilisation). */
  requests: readonly { reference: string; status: "draft" | "issued" | "closed"; items: number; outstanding: number }[];
  originalBusinessCase: "draft" | "recorded" | null;
  v1: {
    status: string;
    driverCount: number;
    unqualified: number;
    unevidenced: number;
  } | null;
};

export type MobilisationAction = { label: string; href: string };

export type MobilisationItem = {
  key:
    | "project"
    | "value-basis"
    | "vco"
    | "kickoff"
    | "go-live"
    | "information-request"
    | "original-business-case"
    | "v1-draft"
    | "v1-drivers"
    | "v1-proposed"
    | "v1-authorised";
  title: string;
  requirement: Requirement;
  done: boolean;
  detail: string;
  /** Where the consultant acts on an outstanding item. */
  action?: MobilisationAction;
};

export type MobilisationStatus =
  | {
      stage: "authorised";
      inForceVersionNumber: number | null;
      completed: MobilisationItem[];
      outstanding: [];
      next: null;
    }
  | {
      stage: "mobilising";
      completed: MobilisationItem[];
      outstanding: MobilisationItem[];
      next: MobilisationAction | null;
    };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function requestDetail(r: MobilisationFacts["requests"][number]): string {
  const items = plural(r.items, "item");
  if (r.status === "draft") return `${r.reference} drafted (${items}) — not yet issued`;
  if (r.status === "closed") return `${r.reference} closed (${items})`;
  return r.outstanding > 0
    ? `${r.reference} issued — ${r.outstanding} of ${items} outstanding`
    : `${r.reference} issued — no items outstanding (${items})`;
}

/** The items in journey order. */
export function mobilisationItems(f: MobilisationFacts): MobilisationItem[] {
  const request = f.requests[0] ?? null;
  const v1 = f.v1;
  const proposedOrLater = v1 !== null && v1.status !== "draft";
  return [
    {
      key: "project",
      title: "Project established",
      requirement: "required",
      done: true,
      detail: "Client, project and currency recorded",
    },
    {
      key: "value-basis",
      title: "Value Basis",
      requirement: "required",
      done: f.hasValueBasis,
      detail: f.hasValueBasis
        ? f.hasValuePeriod
          ? "Defined, with a Value Period"
          : "Defined (no Value Period yet — needed later for trajectories)"
        : "Not defined — required before V1 can be proposed",
      action: { label: "Define the Value Basis", href: "setup#value-basis" },
    },
    {
      key: "vco",
      title: "Value Case Owner",
      requirement: "required",
      done: f.vcoName !== null,
      detail: f.vcoName ?? "Not nominated — needed to record the authorisation of V1",
      action: { label: "Nominate the Value Case Owner", href: "setup#stakeholders" },
    },
    {
      key: "kickoff",
      title: "Kick-off date",
      requirement: "recommended",
      done: f.kickoffDate !== null,
      detail: f.kickoffDate ?? "Not recorded — drives the kick-off Assurance review",
      action: { label: "Record the kick-off date", href: "setup#key-dates" },
    },
    {
      key: "go-live",
      title: "Go-Live date",
      requirement: "recommended",
      done: f.goLiveDate !== null,
      detail: f.goLiveDate ?? "Not recorded (if known) — anchors the six-monthly Assurance cadence",
      action: { label: "Record the Go-Live date", href: "setup#key-dates" },
    },
    {
      key: "information-request",
      title: "Day-1 Information Request",
      requirement: "recommended",
      done: request !== null && request.status !== "draft",
      detail: request
        ? requestDetail(request)
        : "Not created — what Cardaxia needs from the client to define the Value Case",
      action: request
        ? { label: `Issue ${request.reference}`, href: "information-request" }
        : { label: "Create the Day-1 Information Request", href: "setup#day-one-request" },
    },
    {
      key: "original-business-case",
      title: "Original Business Case",
      requirement: "recommended",
      done: f.originalBusinessCase === "recorded",
      detail:
        f.originalBusinessCase === "recorded"
          ? "Recorded — the starting point for Value Case Definition"
          : f.originalBusinessCase === "draft"
            ? "Being captured — record it to make it the starting point for Value Case Definition"
            : "Not captured — the existing business case is the starting point for Value Case Definition",
      action:
        f.originalBusinessCase === "draft"
          ? { label: "Finish and record the Original Business Case", href: "value-case/v/0" }
          : { label: "Capture the Original Business Case", href: "value-case" },
    },
    {
      key: "v1-draft",
      title: "Value Case Definition started",
      requirement: "required",
      done: v1 !== null,
      detail: v1 ? "Draft Value Case (V1) created" : "No draft Value Case (V1) yet",
      action: { label: "Start Value Case Definition: create the draft Value Case (V1)", href: "requalification" },
    },
    {
      key: "v1-drivers",
      title: "Value Drivers",
      requirement: "required",
      done: (v1?.driverCount ?? 0) > 0,
      detail:
        v1 && v1.driverCount > 0
          ? `${plural(v1.driverCount, "driver")} · ${v1.unqualified} unqualified · ${v1.unevidenced} unevidenced (visible, not blocking)`
          : "At least one Value Driver is needed to propose V1",
      action: { label: "Add Value Drivers to the draft V1", href: "requalification" },
    },
    {
      key: "v1-proposed",
      title: "V1 proposed",
      requirement: "required",
      done: proposedOrLater,
      detail: proposedOrLater ? "Proposed for VCO authorisation" : "Not yet proposed to the Value Case Owner",
      action: { label: "Complete Value Case Definition and propose V1", href: "requalification" },
    },
    {
      key: "v1-authorised",
      title: "V1 authorised",
      requirement: "required",
      done: f.everAuthorised,
      detail: f.everAuthorised ? "Authorised by the Value Case Owner" : "Awaiting the VCO's authorisation",
      action: { label: "Record the VCO's authorisation of the proposed Value Case", href: "requalification#authorise" },
    },
  ];
}

/**
 * The next action follows the journey order: Value Basis → VCO → Day-1 Information Request → Original Business Case
 * → V1 draft → drivers → proposal. Key dates are listed but never pushed as the next action. Once V1 is proposed,
 * only its authorisation (or the VCO it needs) is next.
 */
const JOURNEY: MobilisationItem["key"][] = [
  "value-basis",
  "vco",
  "information-request",
  "original-business-case",
  "v1-draft",
  "v1-drivers",
  "v1-proposed",
];

export function deriveMobilisationStatus(f: MobilisationFacts): MobilisationStatus {
  const items = mobilisationItems(f);
  const completed = items.filter((i) => i.done);
  if (f.everAuthorised) {
    return {
      stage: "authorised",
      inForceVersionNumber: f.inForceVersionNumber,
      completed,
      outstanding: [],
      next: null,
    };
  }
  const outstanding = items.filter((i) => !i.done);
  const open = (key: MobilisationItem["key"]) => outstanding.find((i) => i.key === key);
  const proposed = f.v1?.status === "proposed";
  const nextItem = proposed
    ? (open("vco") ?? open("v1-authorised"))
    : JOURNEY.map(open).find((i): i is MobilisationItem => i !== undefined);
  return { stage: "mobilising", completed, outstanding, next: nextItem?.action ?? null };
}
