import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {description && <div className="mt-1 max-w-3xl text-sm text-slate-600">{description}</div>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Section({
  title,
  id,
  description,
  actions,
  children,
  tone = "default",
}: {
  title: ReactNode;
  id?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  tone?: "default" | "muted";
}) {
  return (
    <section
      id={id}
      className={`mb-6 scroll-mt-4 rounded-lg border border-slate-200 ${tone === "muted" ? "bg-slate-50" : "bg-white"} p-4 shadow-sm`}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {description && <div className="mt-0.5 text-sm text-slate-600">{description}</div>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function KeyValues({ items }: { items: readonly [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1.5 text-sm">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-slate-500">{k}</dt>
          <dd className="text-slate-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Missing({ children }: { children: ReactNode }) {
  return <span className="text-amber-700">⚠ {children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-500">{children}</p>;
}

export function Notice({
  tone,
  title,
  children,
}: {
  tone: "info" | "warning" | "locked" | "success";
  title?: ReactNode;
  children?: ReactNode;
}) {
  const tones = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    locked: "border-slate-300 bg-slate-100 text-slate-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  };
  return (
    <div className={`mb-4 rounded border px-3 py-2 text-sm ${tones[tone]}`} role="note">
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? "mt-0.5" : undefined}>{children}</div>}
    </div>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-sky-800 underline decoration-sky-300 underline-offset-2 hover:decoration-sky-700">
      {children}
    </Link>
  );
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
}) {
  const styles =
    variant === "primary"
      ? "bg-slate-900 text-white hover:bg-slate-700"
      : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50";
  return (
    <Link href={href} className={`inline-flex items-center rounded px-3 py-1.5 text-sm font-medium ${styles}`}>
      {children}
    </Link>
  );
}

export { Expander } from "./expander";

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm [&_td]:border-t [&_td]:border-slate-100 [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:tracking-wide [&_th]:text-slate-500 [&_th]:uppercase">
        {children}
      </table>
    </div>
  );
}
