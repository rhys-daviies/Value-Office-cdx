import Link from "next/link";

import { listValueChanges } from "@/server/queries/response";
import { PlainBadge } from "@/ui/components/badges";
import { Empty, Section, Table, TextLink } from "@/ui/components/layout";
import { formatDate, formatMoneyChange, formatMoneyShort } from "@/ui/format";
import { requireProject } from "@/ui/require";

export const metadata = { title: "Value Changes" };

const TONE = { draft: "amber", proposed: "sky", authorised: "emerald", rejected: "red", withdrawn: "slate" } as const;

export default async function ChangesPage({ params }: PageProps<"/projects/[projectId]/changes">) {
  const { projectId } = await params;
  const { project } = await requireProject(projectId);
  const changes = await listValueChanges(projectId);
  const base = `/projects/${projectId}`;
  return (
    <>
      <p className="mb-4 max-w-3xl text-sm text-slate-600">
        The only way the Authorised Value Case changes after V1. A Value Change is prepared from a client decision,
        proposed to the Value Case Owner, and — if authorised — supersedes the version in force. Earlier versions and
        the reviews measured against them are preserved.
      </p>
      <Section title={`Value Changes (${changes.length})`}>
        {changes.length === 0 ? (
          <Empty>
            No Value Changes. They are prepared from a recorded client decision in an{" "}
            <TextLink href={`${base}/assurance`}>Assurance Review</TextLink>.
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Change</th>
                <th>From → to</th>
                <th className="text-right">Stated change</th>
                <th className="text-right">Driver-level change</th>
                <th className="text-right">Proposed version total</th>
                <th>Status</th>
                <th>Authorised</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr key={c.change.id} data-testid="change-row">
                  <td>
                    <Link href={`${base}/changes/${c.change.id}`} className="font-medium text-sky-800 hover:underline">
                      {c.change.code}
                    </Link>
                  </td>
                  <td>
                    V{c.fromNumber} → V{c.toNumber}
                  </td>
                  <td className="text-right">
                    {c.change.statedChangeAmount
                      ? formatMoneyChange(c.change.statedChangeAmount, project.currency)
                      : "—"}
                  </td>
                  <td className="text-right">{formatMoneyChange(c.actualChange, project.currency)}</td>
                  <td className="text-right">{formatMoneyShort(c.toTotal, project.currency)}</td>
                  <td>
                    <PlainBadge tone={TONE[c.change.status]}>{c.change.status}</PlainBadge>
                  </td>
                  <td>{formatDate(c.change.authorisedOn)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </>
  );
}
