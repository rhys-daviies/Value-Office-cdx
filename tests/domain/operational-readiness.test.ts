import { describe, expect, it } from "vitest";

import { ATTENTION_WINDOW_DAYS } from "@/domain/attention";
import {
  isOutstandingItem,
  itemDueState,
  outstandingQueue,
  overdueCount,
  type QueueInput,
} from "@/domain/request-queue";
import { ownerOptions, personWithRole } from "@/ui/people";

// Phase 4D.13 operational readiness: the Information Request working queue and named-person accountability.

const today = "2026-10-07";
const item = (over: Partial<QueueInput> & { id: string }): QueueInput & { id: string } => ({
  requestStatus: "issued",
  itemStatus: "open",
  dueOn: null,
  reference: "IR-01",
  sequence: 1,
  ...over,
});

describe("Information Request queue", () => {
  it("outstanding = open or partially received items on ISSUED requests only", () => {
    expect(isOutstandingItem("issued", "open")).toBe(true);
    expect(isOutstandingItem("issued", "partially_received")).toBe(true);
    expect(isOutstandingItem("issued", "received")).toBe(false);
    expect(isOutstandingItem("issued", "not_available")).toBe(false);
    expect(isOutstandingItem("draft", "open")).toBe(false); // not asked yet
    expect(isOutstandingItem("closed", "open")).toBe(false); // finished
  });

  it("overdue when the due date has passed; due soon from today to the attention window; else outstanding", () => {
    expect(ATTENTION_WINDOW_DAYS).toBe(14);
    expect(itemDueState("2026-10-06", today)).toBe("overdue");
    expect(itemDueState("2026-10-07", today)).toBe("due_soon");
    expect(itemDueState("2026-10-21", today)).toBe("due_soon"); // today + 14
    expect(itemDueState("2026-10-22", today)).toBe("outstanding"); // today + 15
    expect(itemDueState(null, today)).toBe("outstanding");
  });

  it("orders earliest due first, undated last, then request reference and item number; excludes finished items", () => {
    const queue = outstandingQueue(
      [
        item({ id: "undated", dueOn: null }),
        item({ id: "later", dueOn: "2026-12-01" }),
        item({ id: "received", dueOn: "2026-09-01", itemStatus: "received" }),
        item({ id: "draft", dueOn: "2026-09-01", requestStatus: "draft" }),
        item({ id: "overdue-b", dueOn: "2026-10-01", reference: "IR-02", sequence: 1 }),
        item({ id: "overdue-a2", dueOn: "2026-10-01", reference: "IR-01", sequence: 2 }),
        item({ id: "soon", dueOn: "2026-10-10", itemStatus: "partially_received" }),
      ],
      today,
    );
    expect(queue.map((q) => [q.id, q.due])).toEqual([
      ["overdue-a2", "overdue"],
      ["overdue-b", "overdue"],
      ["soon", "due_soon"],
      ["later", "outstanding"],
      ["undated", "outstanding"],
    ]);
    expect(overdueCount(queue, today)).toBe(2);
  });
});

describe("named-person accountability", () => {
  it("presents PERSON — ROLE, and just the person when no role is recorded", () => {
    expect(personWithRole("Dana Whitfield", "Risk / Leakage Owner")).toBe("Dana Whitfield — Risk / Leakage Owner");
    expect(personWithRole("Dana Whitfield", null)).toBe("Dana Whitfield");
    expect(personWithRole("Dana Whitfield", "  ")).toBe("Dana Whitfield");
    expect(
      ownerOptions([
        { personId: "p1", name: "Dana Whitfield", roleDescription: "Risk / Leakage Owner" },
        { personId: "p2", name: "Sam Okafor", roleDescription: null },
      ]),
    ).toEqual([
      { value: "p1", label: "Dana Whitfield — Risk / Leakage Owner" },
      { value: "p2", label: "Sam Okafor" },
    ]);
  });
});
