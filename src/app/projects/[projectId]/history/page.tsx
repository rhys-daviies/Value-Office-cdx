import { getProjectHistory } from "@/server/queries/history";
import { Empty, Section } from "@/ui/components/layout";
import { formatDateTime } from "@/ui/format";
import { areaOf, commandLabel, fieldChanges, insertedFields, recordName, tableLabel } from "@/ui/history";
import { requireProject } from "@/ui/require";

export const metadata = { title: "History" };

export default async function HistoryPage({ params }: PageProps<"/projects/[projectId]/history">) {
  const { projectId } = await params;
  await requireProject(projectId);
  const entries = await getProjectHistory(projectId);

  return (
    <Section
      title="History"
      description="Every change to this project's Value Record, from the audit trail. Each entry is one command, attributed to the consultant who ran it."
    >
      {entries.length === 0 ? (
        <Empty>No history yet.</Empty>
      ) : (
        <ol className="divide-y divide-slate-100" data-testid="history">
          {entries.map((e) => (
            <li key={e.transactionId} className="py-2" data-testid="history-entry">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
                  <span className="w-40 shrink-0 text-xs text-slate-500">{formatDateTime(e.occurredAt)}</span>
                  <span className="font-medium text-slate-900">{commandLabel(e.command)}</span>
                  <span className="text-slate-600">
                    {[...new Set(e.changes.map(recordName).filter(Boolean))].slice(0, 3).join(" · ")}
                  </span>
                  <span className="ml-auto text-xs text-slate-500">
                    {areaOf(e.changes)} · {e.actorName}
                  </span>
                </summary>
                <div className="mt-2 ml-40 space-y-2 text-xs">
                  <p className="text-slate-500">
                    Consultant {e.actorName} ({e.actorEmail}) · command <code>{e.command}</code> · transaction{" "}
                    {e.transactionId}
                  </p>
                  {e.changes.map((c) => {
                    const fields = c.action === "UPDATE" ? fieldChanges(c) : insertedFields(c);
                    return (
                      <div key={c.id} className="rounded border border-slate-200 p-2">
                        <p className="font-medium">
                          {c.action === "INSERT" ? "Created" : c.action === "UPDATE" ? "Changed" : "Removed"}{" "}
                          {tableLabel(c.tableName)} {recordName(c) && `— ${recordName(c)}`}
                        </p>
                        {fields.length > 0 && (
                          <table className="mt-1">
                            <tbody>
                              {fields.map((f) => (
                                <tr key={f.field}>
                                  <td className="pr-3 align-top text-slate-500">{f.field}</td>
                                  {c.action === "UPDATE" && (
                                    <td className="pr-2 align-top text-slate-400 line-through">{f.before}</td>
                                  )}
                                  <td className="align-top">{f.after}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
