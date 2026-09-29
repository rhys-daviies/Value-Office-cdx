import Link from "next/link";

import { requireConsultant } from "@/server/auth/actor";
import { listProjects } from "@/server/queries/projects";
import { VersionBadge } from "@/ui/components/badges";
import { ButtonLink, Empty, Missing, PageHeader, Table } from "@/ui/components/layout";
import { formatDate } from "@/ui/format";

export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  await requireConsultant();
  const projects = await listProjects();
  return (
    <>
      <PageHeader
        title="Projects"
        description="Client engagements run through the Value Office."
        actions={<ButtonLink href="/projects/new">Create project</ButtonLink>}
      />
      {projects.length === 0 ? (
        <Empty>No projects yet. Create the first engagement to begin Mobilise.</Empty>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
          <Table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Project</th>
                <th>Status</th>
                <th>Currency</th>
                <th>Value Basis</th>
                <th>Value Case</th>
                <th>Kick-off</th>
                <th>Go-Live</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} data-testid="project-row">
                  <td>{p.clientName}</td>
                  <td>
                    <Link href={`/projects/${p.id}`} className="font-medium text-sky-800 hover:underline">
                      {p.name}
                    </Link>
                    <div className="text-xs text-slate-500">{p.code}</div>
                  </td>
                  <td className="capitalize">{p.status}</td>
                  <td>{p.currency}</td>
                  <td className="max-w-xs">{p.valueBasisDescription ?? <Missing>Not defined</Missing>}</td>
                  <td>
                    {p.latestVersion ? (
                      <VersionBadge
                        kind={p.latestVersion.kind}
                        status={p.latestVersion.status}
                        versionNumber={p.latestVersion.versionNumber}
                      />
                    ) : (
                      <span className="text-slate-500">Not started</span>
                    )}
                  </td>
                  <td>{formatDate(p.kickoffDate)}</td>
                  <td>{formatDate(p.goLiveDate)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </>
  );
}
