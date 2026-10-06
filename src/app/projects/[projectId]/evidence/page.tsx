import Link from "next/link";

import { recordEvidenceAction } from "@/server/actions/evidence";
import { recordDocumentAction } from "@/server/actions/setup";
import { getEvidenceRegister, nextEvidenceCode } from "@/server/queries/evidence";
import { ActionForm, SubmitButton } from "@/ui/components/action-form";
import { GovernedTag, LockedBadge, PlainBadge, WorkingTag } from "@/ui/components/badges";
import { Checkbox, DateField, FormGrid, Hidden, SelectField, TextArea, TextField } from "@/ui/components/fields";
import { Empty, Expander, Section, Table } from "@/ui/components/layout";
import { formatDate } from "@/ui/format";
import { requireProject } from "@/ui/require";

export const metadata = { title: "Evidence" };

export default async function EvidencePage({ params, searchParams }: PageProps<"/projects/[projectId]/evidence">) {
  const { projectId } = await params;
  const query = await searchParams;
  await requireProject(projectId);
  const { entries: all, documents, stakeholders } = await getEvidenceRegister(projectId);
  const base = `/projects/${projectId}/evidence`;
  // Phase 4D.13: a simple lens, not a workflow — evidence with no existing relationship to anything it supports.
  const onlyUnclassified = query.show === "needs-classification";
  const unclassifiedCount = all.filter((e) => e.needsClassification).length;
  const entries = onlyUnclassified ? all.filter((e) => e.needsClassification) : all;
  const stakeholderOptions = stakeholders.map((s) => ({ value: s.personId, label: s.name }));
  const documentOptions = documents.map(({ document: d }) => ({ value: d.id, label: d.title }));

  return (
    <>
      <p className="mb-4 max-w-3xl text-sm text-slate-600">
        Every item of evidence, where it came from, and what it supports. Formal reliance — a locked Value Case version,
        a finalised Assurance Review, an authorised Value Change or a recorded decision — freezes evidence: record
        superseding evidence instead of editing it. Working links to a living Assurance matter or a Value Driver (shown
        in violet) inform the consultant and never lock evidence.
      </p>

      <Section
        title={`Evidence register (${all.length})`}
        actions={
          <span className="inline-flex gap-3 text-sm" data-testid="evidence-filter">
            {onlyUnclassified ? (
              <Link href={base} className="text-sky-800 hover:underline">
                Show all
              </Link>
            ) : (
              <span className="font-medium text-slate-700">All</span>
            )}
            {onlyUnclassified ? (
              <span className="font-medium text-slate-700">Needs classification ({unclassifiedCount})</span>
            ) : (
              <Link href={`${base}?show=needs-classification`} className="text-sky-800 hover:underline">
                Needs classification ({unclassifiedCount})
              </Link>
            )}
          </span>
        }
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            Why do we believe it? <GovernedTag>Formal reliance</GovernedTag> locks evidence once relied on;{" "}
            <WorkingTag>Working link</WorkingTag> informs live work and never locks.
          </span>
        }
      >
        {entries.length === 0 ? (
          <Empty>
            {onlyUnclassified
              ? "Every item of evidence is linked to something it supports."
              : "No evidence recorded yet."}
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Title / summary</th>
                <th>Source</th>
                <th>Evidence date</th>
                <th>Document</th>
                <th>Formal reliance</th>
                <th>Working links</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.evidence.id} data-testid="evidence-row">
                  <td className="font-mono whitespace-nowrap">
                    <Link href={`${base}/${e.evidence.id}`} className="text-sky-800 hover:underline">
                      {e.evidence.code}
                    </Link>
                  </td>
                  <td className="max-w-sm">
                    <Link href={`${base}/${e.evidence.id}`} className="font-medium hover:underline">
                      {e.evidence.title}
                    </Link>
                    {e.evidence.summary && <p className="text-xs text-slate-500">{e.evidence.summary}</p>}
                  </td>
                  <td>{e.sourcePersonName ?? "—"}</td>
                  <td className="whitespace-nowrap">{formatDate(e.evidence.evidenceDate)}</td>
                  <td className="max-w-[12rem] truncate">{e.documentTitle ?? "—"}</td>
                  <td className="text-xs" data-testid="evidence-formal">
                    {e.links.length === 0 && e.authorises.length === 0 && e.reviewLinks.length === 0 && (
                      <span className="text-slate-400">—</span>
                    )}
                    {e.reviewLinks.map((l) => (
                      <div key={l.linkId}>Assurance Review #{l.sequence}</div>
                    ))}
                    {e.links.map((l) => (
                      <div key={l.linkId}>
                        V{l.versionNumber} {l.driverCode}
                        {l.assumption ? ` (assumption)` : ""}
                      </div>
                    ))}
                    {e.authorises.map((v) => (
                      <div key={v}>Authorises V{v}</div>
                    ))}
                  </td>
                  <td className="text-xs" data-testid="evidence-use">
                    {e.matterLinks.length === 0 && e.driverLinks.length === 0 && e.fulfils.length === 0 && (
                      <span className="text-slate-400">—</span>
                    )}
                    {e.matterLinks.map((l) => (
                      <div key={l.linkId} className="text-violet-800">
                        Matter {l.code} <span className="text-violet-600">(working)</span>
                      </div>
                    ))}
                    {e.driverLinks.map((l) => (
                      <div key={l.linkId} className="text-violet-800">
                        Value Driver {l.code} <span className="text-violet-600">(working)</span>
                      </div>
                    ))}
                    {e.fulfils.map((f) => (
                      <div key={`${f.requestId}-${f.sequence}`} className="text-slate-500">
                        Fulfils {f.reference} #{f.sequence}
                      </div>
                    ))}
                  </td>
                  <td className="space-y-1">
                    {e.needsClassification && (
                      <span
                        title="Not yet linked to a Value Driver, assumption, Assurance matter or review, request item or governance record"
                        data-testid="evidence-needs-classification"
                      >
                        <PlainBadge tone="amber">Needs classification</PlainBadge>
                      </span>
                    )}
                    {e.locked && <LockedBadge label="Locked" />}
                    {e.evidence.isMaterialChange && <PlainBadge tone="red">Material change</PlainBadge>}
                    {e.supersedesCode && <PlainBadge>Supersedes {e.supersedesCode}</PlainBadge>}
                    {e.supersededBy.length > 0 && (
                      <PlainBadge tone="amber">Superseded by {e.supersededBy.join(", ")}</PlainBadge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Record evidence">
          <ActionForm action={recordEvidenceAction} resetOnSuccess testId="record-evidence-form">
            <Hidden name="projectId" value={projectId} />
            <div className="space-y-3">
              <FormGrid>
                <TextField
                  name="code"
                  label="Code"
                  required
                  defaultValue={nextEvidenceCode(entries.map((e) => e.evidence.code))}
                />
                <DateField name="evidenceDate" label="Evidence date" hint="Date the evidence relates to" />
              </FormGrid>
              <TextField name="title" label="Title" required />
              <TextArea name="summary" label="Summary" rows={2} />
              <FormGrid>
                <SelectField
                  name="sourcePersonId"
                  label="Source (stakeholder)"
                  placeholder="—"
                  options={stakeholderOptions}
                />
                <DateField name="receivedOn" label="Received on" />
                <SelectField
                  name="documentId"
                  label="Document reference"
                  placeholder="— None —"
                  options={documentOptions}
                />
                <SelectField
                  name="supersedesEvidenceId"
                  label="Supersedes"
                  placeholder="— Nothing —"
                  options={entries.map((e) => ({
                    value: e.evidence.id,
                    label: `${e.evidence.code} ${e.evidence.title}`,
                  }))}
                />
              </FormGrid>
              <Checkbox
                name="isMaterialChange"
                label="Material change"
                hint="Flags a material change to evidence underlying Value Drivers"
              />
              <TextField name="materialChangeNote" label="Material change note" />
              <SubmitButton>Record evidence</SubmitButton>
            </div>
          </ActionForm>
        </Section>

        <Section
          title={`Document references (${documents.length})`}
          description="Record where a document lives, then attach it to evidence."
        >
          {documents.length > 0 && (
            <ul className="mb-3 space-y-1 text-sm">
              {documents.map(({ document: d }) => (
                <li key={d.id}>
                  <span className="font-medium">{d.title}</span>
                  <span className="text-slate-500"> — {d.sourceDescription}</span>
                  {d.uri && <span className="block truncate text-xs text-sky-800">{d.uri}</span>}
                </li>
              ))}
            </ul>
          )}
          <Expander summary="Add document reference">
            <ActionForm action={recordDocumentAction} resetOnSuccess testId="evidence-add-document-form">
              <Hidden name="projectId" value={projectId} />
              <div className="space-y-3">
                <TextField name="title" label="Title" required />
                <TextField name="sourceDescription" label="Source" required />
                <TextField name="uri" label="Location / URL" />
                <FormGrid>
                  <SelectField name="sourcePersonId" label="Provided by" placeholder="—" options={stakeholderOptions} />
                  <DateField name="receivedOn" label="Received on" />
                </FormGrid>
                <SubmitButton>Record document reference</SubmitButton>
              </div>
            </ActionForm>
          </Expander>
        </Section>
      </div>
    </>
  );
}
