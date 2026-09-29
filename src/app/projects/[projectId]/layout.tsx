import Link from "next/link";

import { ProjectNav } from "@/ui/components/project-nav";
import { requireProject } from "@/ui/require";

export default async function ProjectLayout({ children, params }: LayoutProps<"/projects/[projectId]">) {
  const { projectId } = await params;
  const { project, clientName } = await requireProject(projectId);
  return (
    <>
      <div className="mb-6 border-b border-slate-200">
        <div className="mb-2 text-xs text-slate-500 print:hidden">
          <Link href="/projects" className="hover:underline">
            Projects
          </Link>{" "}
          / {clientName}
        </div>
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold text-slate-900" data-testid="project-name">
            {project.name}
          </h1>
          <span className="text-sm text-slate-500">
            {clientName} · {project.code} · {project.currency}
          </span>
        </div>
        <ProjectNav projectId={projectId} />
      </div>
      {children}
    </>
  );
}
