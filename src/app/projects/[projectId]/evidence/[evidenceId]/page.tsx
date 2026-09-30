import { notFound } from "next/navigation";

import {
  linkDriverEvidenceAction,
  linkEvidenceAction,
  unlinkDriverEvidenceAction,
  unlinkEvidenceAction,
  updateEvidenceAction,
} from "@/server/actions/evidence";
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
  const { entry, documents, stakeholders, otherEvidence, draftTargets, draftAssumptions, driverTargets } = detail;
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
        {entry.locked && <LockedBadge label="Locked — formally relied on" />}
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

        <Section
          title="Formal reliance"
          description="Value Case versions, drivers, assumptions and Assurance Reviews that rely on this evidence. Once the version is locked or the review finalised, the evidence is frozen."
        >
          {entry.links.length === 0 && entry.authorises.length === 0 && entry.reviewLinks.length === 0 ? (
            <Empty>Not formally relied on.</Empty>
          ) : (
            <ul className="space-y-2 text-sm" data-testid="formal-reliance">
              {entry.reviewLinks.map((l) => (
                <li key={l.linkId}>
                  <TextLink href={`/projects/${projectId}/assurance/${l.reviewId}`}>
                    Assurance Review #{l.sequence}
                  </TextLink>{" "}
                  <span className="text-xs text-slate-500">({l.status})</span>
                </li>
              ))}
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

      <Section
        title="Working links"
        description="Living Assurance matters and continuing Value Drivers this evidence informs. Working links are not formal reliance: they never lock the evidence and never change figures."
      >
        {entry.matterLinks.length === 0 && entry.driverLinks.length === 0 && entry.fulfils.length === 0 ? (
          <Empty>No working links.</Empty>
        ) : (
          <ul className="space-y-2 text-sm" data-testid="working-links">
            {entry.matterLinks.map((l) => (
              <li key={l.linkId}>
                <PlainBadge tone="violet">Working link</PlainBadge> Assurance matter{" "}
                <TextLink href={`/projects/${projectId}/assurance/matters/${l.matterId}`}>
                  {l.code} {l.title}
                </TextLink>
                {l.status === "closed" && <span className="text-xs text-slate-500"> (closed)</span>}
              </li>
            ))}
            {entry.driverLinks.map((l) => (
              <li key={l.linkId} className="flex items-start justify-between gap-2">
                <span>
                  <PlainBadge tone="violet">Working link</PlainBadge> Value Driver {l.code}
                </span>
                <ActionForm action={unlinkDriverEvidenceAction} confirm="Remove this working link?" showSuccess={false}>
                  <Hidden name="projectId" value={projectId} />
                  <Hidden name="evidenceLinkId" value={l.linkId} />
                  <SubmitButton variant="danger">Unlink</SubmitButton>
                </ActionForm>
              </li>
            ))}
            {entry.fulfils.map((f) => (
              <li key={`${f.requestId}-${f.sequence}`}>
                Fulfils{" "}
                <TextLink href={`/projects/${projectId}/information-request#ir-${f.requestId}`}>
                  {f.reference} #{f.sequence}
                </TextLink>
              </li>
            ))}
          </ul>
        )}
        {driverTargets.length > 0 && (
          <div className="mt-4">
            <ActionForm action={linkDriverEvidenceAction} resetOnSuccess testId="link-driver-evidence-form">
              <Hidden name="projectId" value={projectId} />
              <Hidden name="evidenceId" value={e.id} />
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-60 flex-1">
                  <SelectField
                    name="valueDriverId"
                    label="Link to Value Driver (working)"
                    required
                    placeholder="— Choose —"
                    options={driverTargets.map((d) => ({ value: d.driverId, label: `${d.code} ${d.name}` }))}
                  />
                </div>
                <div className="min-w-48 flex-1">
                  <TextField name="relevanceNote" label="Relevance note" />
                </div>
                <SubmitButton variant="secondary">Link</SubmitButton>
              </div>
            </ActionForm>
            <p className="mt-1 text-xs text-slate-500">
              Links the continuing driver, not a Value Case version — no authorised figure changes. Matter evidence is
              linked from the Assurance matter.
            </p>
          </div>
        )}
      </Section>

      <Section title="Edit evidence">
        {entry.locked ? (
          <Notice tone="locked" title="Frozen">
            This evidence is formally relied on — by a proposed, recorded or authorised version, a finalised Assurance
            Review, an authorised Value Change or a recorded decision. Working links do not change that. Record new
            evidence that supersedes it rather than editing it.
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
