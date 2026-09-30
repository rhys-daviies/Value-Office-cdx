"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { PRIMARY, SECONDARY, type Tab } from "../navigation";

export function ProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const root = `/projects/${projectId}`;
  const isActive = (t: Tab) => (t.href === "" ? pathname === root : pathname.startsWith(root + t.href));
  return (
    <nav className="-mb-px flex flex-wrap items-end justify-between gap-x-4 print:hidden" aria-label="Project">
      <ul className="flex flex-wrap gap-1">
        {PRIMARY.map((t) => (
          <li key={t.label}>
            <Link
              href={root + t.href}
              aria-current={isActive(t) ? "page" : undefined}
              className={`block border-b-2 px-3 py-2 text-sm whitespace-nowrap ${
                isActive(t)
                  ? "border-slate-900 font-semibold text-slate-900"
                  : "border-transparent text-slate-700 hover:border-slate-300 hover:text-slate-900"
              }`}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
      <div className="flex items-end gap-1" data-testid="nav-secondary">
        <span id="project-nav-more" className="pb-2 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
          More
        </span>
        <ul className="flex gap-0.5" aria-labelledby="project-nav-more">
          {SECONDARY.map((t) => (
            <li key={t.label}>
              <Link
                href={root + t.href}
                aria-current={isActive(t) ? "page" : undefined}
                className={`block border-b-2 px-2 py-2 text-xs whitespace-nowrap ${
                  isActive(t)
                    ? "border-slate-700 font-semibold text-slate-900"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
                }`}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
