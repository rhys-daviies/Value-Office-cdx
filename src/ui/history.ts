import type { AuditRow } from "@/server/queries/history";

import { COMMAND_LABELS, TABLE_AREAS, TABLE_LABELS } from "./labels";

// Turns audit row images into readable descriptions. Presentation only.

const HIDDEN_FIELDS = new Set([
  "id",
  "created_at",
  "project_id",
  "client_id",
  "value_case_id",
  "recorded_by",
  "created_by",
]);

function rowOf(change: AuditRow): Record<string, unknown> {
  return (change.newRow ?? change.oldRow ?? {}) as Record<string, unknown>;
}

/** A short name for the affected record, e.g. "VD-01 Service Productivity" or "V1". */
export function recordName(change: AuditRow): string {
  const r = rowOf(change);
  switch (change.tableName) {
    case "value_case_version":
      return `V${r.version_number} ${r.title ?? ""}`.trim();
    case "value_driver":
      return String(r.code ?? "");
    case "evidence":
      return `${r.code} ${r.title}`;
    case "information_request":
      return `${r.reference} ${r.title}`;
    case "information_request_item":
      return `#${r.sequence} ${truncate(String(r.description ?? ""), 60)}`;
    case "assumption":
      return truncate(String(r.statement ?? ""), 60);
    case "key_date":
      return `${r.label} ${r.date}`;
    case "evidence_link":
      return "evidence link";
    default:
      return String(r.name ?? r.title ?? r.code ?? "");
  }
}

export function commandLabel(command: string): string {
  return COMMAND_LABELS[command] ?? command;
}

export function areaOf(changes: AuditRow[]): string {
  const areas = [...new Set(changes.map((c) => TABLE_AREAS[c.tableName] ?? c.tableName))];
  return areas.join(", ");
}

export function tableLabel(table: string): string {
  return TABLE_LABELS[table] ?? table;
}

export type FieldChange = { field: string; before: string; after: string };

/** For updates: the fields that actually changed, formatted for display. */
export function fieldChanges(change: AuditRow): FieldChange[] {
  if (change.action !== "UPDATE" || !change.oldRow || !change.newRow) return [];
  const before = change.oldRow as Record<string, unknown>;
  const after = change.newRow as Record<string, unknown>;
  return Object.keys(after)
    .filter((k) => !HIDDEN_FIELDS.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => ({ field: humanise(k), before: display(before[k]), after: display(after[k]) }));
}

/** For inserts: the populated fields. */
export function insertedFields(change: AuditRow): FieldChange[] {
  if (change.action !== "INSERT" || !change.newRow) return [];
  return Object.entries(change.newRow as Record<string, unknown>)
    .filter(([k, v]) => !HIDDEN_FIELDS.has(k) && !k.endsWith("_id") && v !== null && v !== "")
    .map(([k, v]) => ({ field: humanise(k), before: "", after: display(v) }));
}

function humanise(key: string): string {
  const s = key.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function display(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return truncate(String(v), 120);
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
