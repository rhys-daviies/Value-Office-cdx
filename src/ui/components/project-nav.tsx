"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "", label: "Overview" },
  { href: "/setup", label: "Setup" },
  { href: "/information-request", label: "Information Request" },
  { href: "/evidence", label: "Evidence" },
  { href: "/value-case", label: "Value Case" },
  { href: "/requalification", label: "Re-Qualification" },
  { href: "/assurance", label: "Assurance" },
  { href: "/changes", label: "Value Changes" },
  { href: "/history", label: "History" },
];

export function ProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const root = `/projects/${projectId}`;
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto print:hidden" aria-label="Project">
      {TABS.map((t) => {
        const href = root + t.href;
        const active = t.href === "" ? pathname === root : pathname.startsWith(href);
        return (
          <Link
            key={t.label}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`border-b-2 px-3 py-2 text-sm whitespace-nowrap ${
              active
                ? "border-slate-900 font-semibold text-slate-900"
                : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
