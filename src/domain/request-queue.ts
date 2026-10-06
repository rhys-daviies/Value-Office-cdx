import { ATTENTION_WINDOW_DAYS, daysBetween } from "./attention";
import type { INFORMATION_REQUEST_ITEM_STATUSES, INFORMATION_REQUEST_STATUSES } from "./statuses";

// Information Request working queue (Phase 4D.13): which request items are still outstanding, and how pressing their
// due date is. Derived at read time from the existing request and item statuses — nothing is stored, scheduled,
// reminded or escalated. "Due soon" reuses the Assurance attention window (ATTENTION_WINDOW_DAYS: due today or within
// the next 14 days); "overdue" means the due date has passed. Dates are ISO calendar dates compared as UTC days.

type RequestStatus = (typeof INFORMATION_REQUEST_STATUSES)[number];
type ItemStatus = (typeof INFORMATION_REQUEST_ITEM_STATUSES)[number];

export type DueState = "overdue" | "due_soon" | "outstanding";

/**
 * Outstanding = asked of the client and not yet answered: an open or partially received item on an ISSUED request.
 * Draft requests have not been asked yet; closed requests, and received / not available items, are finished.
 */
export function isOutstandingItem(requestStatus: RequestStatus, itemStatus: ItemStatus): boolean {
  return requestStatus === "issued" && (itemStatus === "open" || itemStatus === "partially_received");
}

/** How pressing an outstanding item's due date is; items without a due date are simply outstanding. */
export function itemDueState(dueOn: string | null, today: string): DueState {
  if (!dueOn) return "outstanding";
  const days = daysBetween(today, dueOn);
  if (days < 0) return "overdue";
  return days <= ATTENTION_WINDOW_DAYS ? "due_soon" : "outstanding";
}

export type QueueInput = {
  requestStatus: RequestStatus;
  itemStatus: ItemStatus;
  dueOn: string | null;
  /** Tie-breakers for a stable order: request reference, then item sequence. */
  reference: string;
  sequence: number;
};

/** The consultant's working queue: outstanding items only, earliest due first, undated items last. */
export function outstandingQueue<T extends QueueInput>(items: readonly T[], today: string): (T & { due: DueState })[] {
  return items
    .filter((i) => isOutstandingItem(i.requestStatus, i.itemStatus))
    .map((i) => ({ ...i, due: itemDueState(i.dueOn, today) }))
    .sort(
      (a, b) =>
        (a.dueOn === null ? 1 : 0) - (b.dueOn === null ? 1 : 0) ||
        (a.dueOn ?? "").localeCompare(b.dueOn ?? "") ||
        a.reference.localeCompare(b.reference) ||
        a.sequence - b.sequence,
    );
}

/** Overview signal: how many outstanding items are past their due date. */
export function overdueCount(items: readonly QueueInput[], today: string): number {
  return outstandingQueue(items, today).filter((i) => i.due === "overdue").length;
}
