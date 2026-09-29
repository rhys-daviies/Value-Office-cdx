import { notFound } from "next/navigation";

import { linkEvidenceAction, unlinkEvidenceAction, updateEvidenceAction } from "@/server/actions/evidence";
import { getEvidenceDetail } from "@/server/queries/evidence";
import { ActionForm, SubmitButton } from "@/ui/components/action-form";
import { LockedBadge, PlainBadge } from "@/ui/components/badges";
import { Checkbox, DateField, FormGrid, Hidden, SelectField, TextArea, TextField } from "@/ui/components/fields";
import { Empty, KeyValues, Notice, Section, TextLink } from "@/ui/components/layout";
import { formatDate, formatDateTime } from "@/ui/format";
import { VERSION_STATUS_LABELS } from "@/ui/labels";
import { isUuid, requireProject } from "@/ui/require";
import type { VersionStatus } from "@/domain/statuses";

export const metadata = { title: "Evidence" };

export default async function EvidenceDetailPage({ params }: PageProps<"/projects/[projectId]/evidence/[evidenceId]">) {
  const { projectId, evidenceId } = await params;
  await requireProject(projectId);
  if (!isUuid(evidenceId)) notFound();
  const detail = await getEvidenceDetail(projectId, evidenceId);
  if (!detail) notFound();
  const { entry, documents, stakeholders, otherEvidence, draftTargets, draftAssumptions } = detail;
  const e = entry.evidence;

  const linkTargets = [
    ...draftTargets.map((t) => ({
      value: `driver:${t.driverVersionId}`,
      label: `V${t.versionNumber} ${t.code} ${t.name}`,
    })),
    ...draftAssumptions.map((a) => ({
      value: `assumption:${a.assumptionId}`,
      label: `V${a.versionNumber} ${a.code} — assumption: ${a.statement.slice(0, 60)}`,
    })),
  ];

  return (
    <>
      <p className="mb-3 text-sm">
        <TextLink href={`/projects/${projectId}/evidence`}>← Evidence register</TextLink>
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">
          <span className="font-mono">{e.code}</span> · {e.title}
        </h2>
        {entry.locked && <LockedBadge label="Locked — relied on by a locked version" />}
        {e.isMaterialChange && <PlainBadge tone="red">Material change</PlainBadge>}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Evidence">
          <KeyValues
            items={[
              ["Summary", e.summary ?? "—"],
              ["Source", entry.sourcePersonName ?? "—"],
              ["Evidence date", formatDate(e.evidenceDate)],
              ["Received", formatDate(e.receivedOn)],
              [
                "Document",
                entry.documentTitle ? (
                  <>
                    {entry.documentTitle}
                    {entry.documentUri && (
                      <span className="block truncate text-xs text-sky-800">{entry.documentUri}</span>
                    )}
                  </>
                ) : (
                  "—"
                ),
              ],
              ["Supersedes", entry.supersedesCode ?? "—"],
              ["Superseded by", entry.supersededBy.length ? entry.supersededBy.join(", ") : "—"],
              ["Material change", e.isMaterialChange ? (e.materialChangeNote ?? "Yes") : "No"],
              ["Recorded", formatDateTime(e.createdAt)],
            ]}
          />
        </Section>

        <Section title="Supports" description="Value Drivers and assumptions that rely on this evidence.">
          {entry.links.length === 0 && entry.authorises.length === 0 ? (
            <Empty>Not linked to anything yet.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {entry.authorises.map((v) => (
                <li key={`auth-${v}`}>
                  <PlainBadge tone="emerald">Authorisation evidence for V{v}</PlainBadge>
                </li>
              ))}
              {entry.links.map((l) => (
                <li
                  key={l.linkId}
                  className="flex items-start justify-between gap-2 rounded border border-slate-200 p-2"
                >
                  <span>
                    V{l.versionNumber} ({VERSION_STATUS_LABELS[l.versionStatus as VersionStatus]}) · {l.driverCode}{" "}
                    {l.driverName}
                    {l.assumption && <span className="block text-xs text-slate-500">Assumption: {l.assumption}</span>}
                  </span>
                  {l.versionStatus === "draft" && (
                    <ActionForm action={unlinkEvidenceAction} confirm="Remove this evidence link?" showSuccess={false}>
                      <Hidden name="projectId" value={projectId} />
                      <Hidden name="evidenceLinkId" value={l.linkId} />
                      <SubmitButton variant="danger">Unlink</SubmitButton>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            {linkTargets.length === 0 ? (
              <p className="text-xs text-slate-500">
                Evidence can be linked to drivers and assumptions of a draft version.
              </p>
            ) : (
              <ActionForm action={linkEvidenceAction} resetOnSuccess testId="link-evidence-form">
                <Hidden name="projectId" value={projectId} />
                <Hidden name="evidenceId" value={e.id} />
                <div className="space-y-3">
                  <SelectField
                    name="target"
                    label="Link to (draft versions only)"
                    required
                    placeholder="— Choose —"
                    options={linkTargets}
                  />
                  <TextField name="relevanceNote" label="Relevance note" />
                  <SubmitButton variant="secondary">Link evidence</SubmitButton>
                </div>
              </ActionForm>
            )}
          </div>
        </Section>
      </div>

      <Section title="Edit evidence">
        {entry.locked ? (
          <Notice tone="locked" title="Frozen">
            This evidence is relied on by a proposed, recorded or authorised version. Record new evidence that
            supersedes it rather than editing it.
          </Notice>
        ) : (
          <ActionForm action={updateEvidenceAction}>
            <Hidden name="projectId" value={projectId} />
            <Hidden name="evidenceId" value={e.id} />
            <div className="space-y-3">
              <TextField name="title" label="Title" required defaultValue={e.title} />
              <TextArea name="summary" label="Summary" rows={2} defaultValue={e.summary} />
              <FormGrid cols={3}>
                <SelectField
                  name="sourcePersonId"
                  label="Source"
                  defaultValue={e.sourcePersonId}
                  placeholder="—"
                  options={stakeholders.map((s) => ({ value: s.personId, label: s.name }))}
                />
                <DateField name="evidenceDate" label="Evidence date" defaultValue={e.evidenceDate} />
                <DateField name="receivedOn" label="Received on" defaultValue={e.receivedOn} />
                <SelectField
                  name="documentId"
                  label="Document"
                  defaultValue={e.documentId}
                  placeholder="— None —"
                  options={documents.map(({ document: d }) => ({ value: d.id, label: d.title }))}
                />
                <SelectField
                  name="supersedesEvidenceId"
                  label="Supersedes"
                  defaultValue={e.supersedesEvidenceId}
                  placeholder="— Nothing —"
                  options={otherEvidence.map((o) => ({ value: o.id, label: `${o.code} ${o.title}` }))}
                />
              </FormGrid>
              <Checkbox name="isMaterialChange" label="Material change" defaultChecked={e.isMaterialChange} />
              <TextField name="materialChangeNote" label="Material change note" defaultValue={e.materialChangeNote} />
              <SubmitButton variant="secondary">Save evidence</SubmitButton>
            </div>
          </ActionForm>
        )}
      </Section>
    </>
  );
}
