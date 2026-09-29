import type { ReportIssueMeta } from "@/ui/reports/render";

/** Issue details as printed on a stored issue. */
export function issueMetaOf(row: { issueNumber: number; issuedAt: Date; issuedByName: string }): ReportIssueMeta {
  return {
    state: "issued",
    issueNumber: row.issueNumber,
    issuedOn: row.issuedAt.toISOString().slice(0, 10),
    issuedBy: row.issuedByName,
  };
}
