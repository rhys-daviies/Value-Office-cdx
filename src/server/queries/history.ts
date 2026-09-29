import { sql } from "drizzle-orm";

import { db } from "@/server/db/client";

export type AuditRow = {
  id: number;
  occurredAt: Date;
  transactionId: number;
  actorName: string;
  actorEmail: string;
  command: string;
  tableName: string;
  rowId: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  oldRow: Record<string, unknown> | null;
  newRow: Record<string, unknown> | null;
};

export type HistoryEntry = {
  transactionId: number;
  occurredAt: Date;
  actorName: string;
  actorEmail: string;
  command: string;
  changes: AuditRow[];
};

/**
 * Audit events touching this project, grouped into one entry per command
 * (transaction). Includes the project's own rows, its client and its stakeholders' person records.
 */
export async function getProjectHistory(projectId: string, limit = 400): Promise<HistoryEntry[]> {
  const result = await db().execute<AuditRow>(sql`
    select e.id, e.occurred_at as "occurredAt", e.transaction_id as "transactionId",
           u.display_name as "actorName", u.email as "actorEmail",
           e.command, e.table_name as "tableName", e.row_id as "rowId", e.action,
           e.old_row as "oldRow", e.new_row as "newRow"
    from audit_event e
    join app_user u on u.id = e.actor_user_id
    where (e.table_name = 'project' and e.row_id = ${projectId})
       or coalesce(e.new_row, e.old_row)->>'project_id' = ${projectId}::text
       or (e.table_name = 'client' and e.row_id = (select client_id from project where id = ${projectId}))
       or (e.table_name = 'person' and e.row_id in (select person_id from project_stakeholder where project_id = ${projectId}))
    order by e.id desc
    limit ${limit}`);

  // Newest first; within an entry, changes in the order they happened.
  const byTransaction = new Map<number, HistoryEntry>();
  for (const row of result.rows) {
    const change = {
      ...row,
      id: Number(row.id),
      transactionId: Number(row.transactionId),
      occurredAt: new Date(row.occurredAt),
    };
    const entry = byTransaction.get(change.transactionId);
    if (entry) {
      entry.changes.unshift(change);
    } else {
      byTransaction.set(change.transactionId, {
        transactionId: change.transactionId,
        occurredAt: change.occurredAt,
        actorName: row.actorName,
        actorEmail: row.actorEmail,
        command: row.command,
        changes: [change],
      });
    }
  }
  return [...byTransaction.values()];
}
