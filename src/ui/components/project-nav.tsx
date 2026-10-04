"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_GROUPS, type NavGroup, type Tab } from "../navigation";

const STYLES: Record<NavGroup["id"], { link: string; active: string; idle: string }> = {
  lifecycle: {
    link: "px-3 py-2 text-sm",
    active: "border-slate-900 font-semibold text-slate-900",
    idle: "border-transparent text-slate-700 hover:border-slate-300 hover:text-slate-900",
  },
  "cross-lifecycle": {
    link: "px-2.5 py-2 text-sm",
    active: "border-slate-800 font-semibold text-slate-900",
    idle: "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900",
  },
  utility: {
    link: "px-2 py-2 text-xs",
    active: "border-slate-700 font-semibold text-slate-900",
    idle: "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800",
  },
};

export function ProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const root = `/projects/${projectId}`;
  const isActive = (t: Tab) => (t.href === "" ? pathname === root : pathname.startsWith(root + t.href));
  return (
    <nav className="-mb-px flex flex-wrap items-end gap-x-6 gap-y-1 print:hidden" aria-label="Project">
      {NAV_GROUPS.map((g) => {
        const s = STYLES[g.id];
        const labelId = `project-nav-${g.id}`;
        return (
          <div key={g.id} className={g.id === "utility" ? "ml-auto" : undefined} data-testid={`nav-${g.id}`}>
            <span id={labelId} className="block px-2 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
              {g.label}
            </span>
            <ul className="flex flex-wrap items-end gap-0.5" aria-labelledby={labelId}>
              {g.tabs.map((t, i) => (
                <li key={t.label} className="flex items-end">
                  {g.id === "lifecycle" && i > 0 && (
                    <span aria-hidden className="pb-2 text-xs text-slate-300">
                      ›
                    </span>
                  )}
                  <Link
                    href={root + t.href}
                    aria-current={isActive(t) ? "page" : undefined}
                    className={`block border-b-2 whitespace-nowrap ${s.link} ${isActive(t) ? s.active : s.idle}`}
                  >
                    {t.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
