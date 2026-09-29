import type { EvidenceStatus, QualificationStatus, VersionKind, VersionStatus } from "@/domain/statuses";

import { EVIDENCE_STATUS_LABELS, IR_ITEM_STATUS_LABELS, QUALIFICATION_LABELS } from "../labels";

const base = "inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset";

// Version authority is colour-coded consistently everywhere:
//   inherited V0 — slate · draft — amber · proposed — sky · authorised — emerald
export function versionTone(kind: VersionKind, status: VersionStatus): string {
  if (kind === "inherited_business_case") return "bg-slate-100 text-slate-700 ring-slate-300";
  return {
    draft: "bg-amber-50 text-amber-800 ring-amber-300",
    proposed: "bg-sky-50 text-sky-800 ring-sky-300",
    authorised: "bg-emerald-50 text-emerald-800 ring-emerald-300",
    superseded: "bg-slate-50 text-slate-500 ring-slate-200",
    recorded: "bg-slate-100 text-slate-700 ring-slate-300",
    rejected: "bg-red-50 text-red-700 ring-red-200",
    withdrawn: "bg-slate-50 text-slate-500 ring-slate-200",
  }[status];
}

/** Card border matching the version's authority colour. */
export function versionBorder(kind: VersionKind, status: VersionStatus): string {
  if (kind === "inherited_business_case") return "border-slate-300";
  return {
    draft: "border-amber-300",
    proposed: "border-sky-300",
    authorised: "border-emerald-400",
    superseded: "border-slate-200",
    recorded: "border-slate-300",
    rejected: "border-red-200",
    withdrawn: "border-slate-200",
  }[status];
}

export function VersionBadge({
  kind,
  status,
  versionNumber,
}: {
  kind: VersionKind;
  status: VersionStatus;
  versionNumber: number;
}) {
  const label =
    kind === "inherited_business_case"
      ? status === "draft"
        ? "V0 · Inherited · Draft"
        : "V0 · Inherited · Recorded"
      : {
          draft: `V${versionNumber} · Draft`,
          proposed: `V${versionNumber} · Proposed`,
          authorised: `V${versionNumber} · Authorised`,
          superseded: `V${versionNumber} · Superseded`,
          recorded: `V${versionNumber}`,
          rejected: `V${versionNumber} · Rejected`,
          withdrawn: `V${versionNumber} · Withdrawn`,
        }[status];
  return (
    <span className={`${base} ${versionTone(kind, status)}`} data-testid="version-badge">
      {label}
    </span>
  );
}

const QUALIFICATION_TONE: Record<QualificationStatus, string> = {
  unqualified: "bg-red-50 text-red-700 ring-red-200",
  partially_qualified: "bg-amber-50 text-amber-800 ring-amber-200",
  qualified: "bg-emerald-50 text-emerald-800 ring-emerald-200",
};
const EVIDENCE_TONE: Record<EvidenceStatus, string> = {
  unevidenced: "bg-red-50 text-red-700 ring-red-200",
  partially_evidenced: "bg-amber-50 text-amber-800 ring-amber-200",
  evidenced: "bg-emerald-50 text-emerald-800 ring-emerald-200",
};

export function QualificationBadge({ status }: { status: QualificationStatus }) {
  return <span className={`${base} ${QUALIFICATION_TONE[status]}`}>{QUALIFICATION_LABELS[status]}</span>;
}

export function EvidenceBadge({ status }: { status: EvidenceStatus }) {
  return <span className={`${base} ${EVIDENCE_TONE[status]}`}>{EVIDENCE_STATUS_LABELS[status]}</span>;
}

export function NonFinancialBadge() {
  return (
    <span className={`${base} bg-violet-50 text-violet-800 ring-violet-200`} title="Excluded from the financial total">
      Non-financial
    </span>
  );
}

export function LockedBadge({ label = "Read-only" }: { label?: string }) {
  return <span className={`${base} bg-slate-100 text-slate-600 ring-slate-300`}>🔒 {label}</span>;
}

export function PlainBadge({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "amber" | "sky" | "emerald" | "red" | "violet";
}) {
  const tones = {
    slate: "bg-slate-100 text-slate-700 ring-slate-300",
    amber: "bg-amber-50 text-amber-800 ring-amber-300",
    sky: "bg-sky-50 text-sky-800 ring-sky-300",
    emerald: "bg-emerald-50 text-emerald-800 ring-emerald-300",
    red: "bg-red-50 text-red-700 ring-red-200",
    violet: "bg-violet-50 text-violet-800 ring-violet-200",
  };
  return <span className={`${base} ${tones[tone]}`}>{children}</span>;
}

export function RequestItemBadge({ status }: { status: keyof typeof IR_ITEM_STATUS_LABELS }) {
  const tone = { open: "amber", partially_received: "sky", received: "emerald", not_available: "slate" } as const;
  return <PlainBadge tone={tone[status]}>{IR_ITEM_STATUS_LABELS[status]}</PlainBadge>;
}
