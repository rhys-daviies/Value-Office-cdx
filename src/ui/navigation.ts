// Project navigation (Phase 4D.4). Primary: daily work, then governed value. Secondary ("More"):
// set-up and less frequent work — still one click away, never hidden in a menu. Every route kept.
export type Tab = { href: string; label: string };

export const PRIMARY: Tab[] = [
  { href: "", label: "Overview" },
  { href: "/assurance", label: "Assurance" },
  { href: "/value-drivers", label: "Value Drivers" },
  { href: "/evidence", label: "Evidence" },
  { href: "/value-case", label: "Value Case" },
  { href: "/changes", label: "Value Changes" },
  { href: "/reports", label: "Reports" },
];

export const SECONDARY: Tab[] = [
  { href: "/setup", label: "Setup" },
  { href: "/information-request", label: "Information Requests" },
  { href: "/requalification", label: "Re-Qualification" },
  { href: "/history", label: "History" },
];
