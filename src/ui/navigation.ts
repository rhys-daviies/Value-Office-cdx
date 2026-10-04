// Project navigation (Phase 4D.10B): grouped the way a consultant operates Value Office. The lifecycle runs in
// order; Evidence and Information Requests serve every stage; utilities support the work. Nothing is hidden by
// project state: each page keeps its own governance gates. Every route is kept. Value Changes are not a navigation
// destination: they are reached from the Value Case, the Assurance review that prompts them and pending-change
// notices (/changes is unchanged).
export type Tab = { href: string; label: string };
export type NavGroup = { id: "lifecycle" | "cross-lifecycle" | "utility"; label: string; tabs: Tab[] };

export const LIFECYCLE: Tab[] = [
  { href: "", label: "Overview" },
  { href: "/setup", label: "Mobilisation" },
  { href: "/requalification", label: "Value Case Definition" },
  { href: "/value-case", label: "Value Case" },
  { href: "/assurance", label: "Assurance" },
];

export const CROSS_LIFECYCLE: Tab[] = [
  { href: "/evidence", label: "Evidence" },
  { href: "/information-request", label: "Information Requests" },
];

export const UTILITY: Tab[] = [
  { href: "/value-drivers", label: "Value Drivers" },
  { href: "/reports", label: "Reports" },
  { href: "/history", label: "History" },
];

export const NAV_GROUPS: NavGroup[] = [
  { id: "lifecycle", label: "Lifecycle", tabs: LIFECYCLE },
  { id: "cross-lifecycle", label: "Across the lifecycle", tabs: CROSS_LIFECYCLE },
  { id: "utility", label: "Utility", tabs: UTILITY },
];

/** Consultant-facing aliases (next.config redirects) for pages whose routes keep their original names. */
export const ROUTE_ALIASES: { alias: string; route: string }[] = [
  { alias: "/mobilisation", route: "/setup" },
  { alias: "/value-case-definition", route: "/requalification" },
];
