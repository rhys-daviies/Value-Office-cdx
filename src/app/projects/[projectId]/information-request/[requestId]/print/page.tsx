import { notFound } from "next/navigation";

import { getInformationRequestWorkspace } from "@/server/queries/information-request";
import { formatDate } from "@/ui/format";
import { IR_ITEM_STATUS_LABELS, IR_STATUS_LABELS } from "@/ui/labels";
import { isUuid, requireProject } from "@/ui/require";

export const metadata = { title: "Information Request (print)" };

// Browser-printable Information Request. Formal PDF issue comes with the reports phase.
export default async function InformationRequestPrintPage({
  params,
}: PageProps<"/projects/[projectId]/information-request/[requestId]/print">) {
  const { projectId, requestId } = await params;
  const { project, clientName } = await requireProject(projectId);
  if (!isUuid(requestId)) notFound();
  const ws = await getInformationRequestWorkspace(projectId);
  const entry = ws.requests.find((r) => r.request.id === requestId);
  if (!entry) notFound();
  const { request, items } = entry;

  return (
    <article className="mx-auto max-w-4xl bg-white p-8 text-sm shadow-sm print:p-0 print:shadow-none">
      <p className="mb-6 text-xs text-slate-500 print:hidden">
        Use your browser&apos;s Print (⌘P / Ctrl+P) to print or save as PDF.
      </p>
      <header className="mb-6 border-b border-slate-300 pb-4">
        <p className="text-xs tracking-wide text-slate-500 uppercase">Cardaxia Value Office · Information Request</p>
        <h1 className="mt-1 text-2xl font-semibold">{request.title}</h1>
        <p className="mt-2 text-slate-600">
          {clientName} · {project.name} · Ref {request.reference} · {IR_STATUS_LABELS[request.status]}
          {request.issuedOn ? ` · Issued ${formatDate(request.issuedOn)}` : ""}
        </p>
      </header>
      <table className="w-full border-collapse [&_td]:border [&_td]:border-slate-300 [&_td]:p-2 [&_td]:align-top [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-100 [&_th]:p-2 [&_th]:text-left">
        <thead>
          <tr>
            <th className="w-10">#</th>
            <th>Information requested</th>
            <th>Requested from</th>
            <th>Due</th>
            <th>Value Driver</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map(({ item, requestedFromName, driverCode }) => (
            <tr key={item.id}>
              <td>{item.sequence}</td>
              <td>
                {item.description}
                {item.notes && <p className="mt-1 text-xs text-slate-500">{item.notes}</p>}
              </td>
              <td>{requestedFromName ?? "—"}</td>
              <td className="whitespace-nowrap">{formatDate(item.dueOn)}</td>
              <td>{driverCode ?? "—"}</td>
              <td>{IR_ITEM_STATUS_LABELS[item.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && <p className="mt-4 text-slate-500">No items.</p>}
    </article>
  );
}
