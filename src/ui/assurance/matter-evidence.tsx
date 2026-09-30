import {
  documentMatterEvidenceAction,
  fulfilRequestItemAction,
  linkMatterEvidenceAction,
  requestMatterEvidenceAction,
  unlinkMatterEvidenceAction,
} from "@/server/actions/matters";
import { INFORMATION_REQUEST_ITEM_STATUSES } from "@/domain/statuses";
import type { MatterEvidence } from "@/server/queries/evidence";
import type { LeakageEntry } from "@/server/queries/response";

import { ActionForm, SubmitButton } from "../components/action-form";
import { LockedBadge, PlainBadge, RequestItemBadge } from "../components/badges";
import { DateField, FormGrid, Hidden, SelectField, TextArea, TextField } from "../components/fields";
import { Empty, Expander, Notice, Section, TextLink } from "../components/layout";
import { formatDate } from "../format";
import { IR_ITEM_STATUS_LABELS } from "../labels";

type Option = { value: string; label: string };

// Evidence around a living Assurance matter (Phase 4D.2): what supports it, what is still needed,
// and what the consultant does next. Everything here is a working link — it informs the
// consultant's assessment; it never sets figures, stages or formal review evidence by itself.

export const WORKING_LINK = "Working link";

export function MatterEvidenceSections({
  projectId,
  entry,
  ev,
  stakeholders,
}: {
  projectId: string;
  entry: LeakageEntry;
  ev: MatterEvidence;
  stakeholders: Option[];
}) {
  const { leakage } = entry;
  const open = leakage.status === "open";
  const base = `/projects/${projectId}`;
  const affected = new Set(entry.drivers.map((d) => d.valueDriverId));
  const driverOptions = [
    ...ev.drivers.filter((d) => affected.has(d.driverId)).map((d) => ({ d, tag: " (affected)" })),
    ...ev.drivers.filter((d) => !affected.has(d.driverId)).map((d) => ({ d, tag: "" })),
  ].map(({ d, tag }) => ({ value: d.driverId, label: `${d.code} ${d.name}${tag}` }));
  const hidden = (
    <>
      <Hidden name="projectId" value={projectId} />
      <Hidden name="matterId" value={leakage.id} />
    </>
  );
  const outstanding = ev.items.filter((i) => i.item.status === "open" || i.item.status === "partially_received");
  const arrived = ev.items.filter((i) => i.item.status === "received");

  return (
    <>
      <Section
        id="evidence"
        title="Evidence supporting this matter"
        description="Evidence Cardaxia or the client already has, linked to this matter as a working link. It informs your assessment; it is not formal reliance, does not lock the evidence and does not become Assurance Review evidence unless you link it to a review."
      >
        {ev.linked.length === 0 ? (
          <Empty>No evidence linked yet.</Empty>
        ) : (
          <ul className="space-y-2 text-sm" data-testid="matter-evidence">
            {ev.linked.map((l) => (
              <li
                key={l.linkId}
                className="flex items-start justify-between gap-2 rounded border border-slate-200 p-2"
                data-testid="matter-evidence-row"
              >
                <span>
                  <TextLink href={`${base}/evidence/${l.evidence.id}`}>
                    <span className="font-mono">{l.evidence.code}</span> {l.evidence.title}
                  </TextLink>{" "}
                  <PlainBadge tone="violet">{WORKING_LINK}</PlainBadge>
                  {l.locked && (
                    <>
                      {" "}
                      <LockedBadge label="Locked by formal reliance elsewhere" />
                    </>
                  )}
                  <span className="block text-xs text-slate-500">
                    {[
                      l.evidence.evidenceDate && `Dated ${formatDate(l.evidence.evidenceDate)}`,
                      l.evidence.receivedOn && `received ${formatDate(l.evidence.receivedOn)}`,
                      l.sourcePersonName && `from ${l.sourcePersonName}`,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "No dates recorded"}
                  </span>
                  {l.relevanceNote && <span className="block text-xs text-slate-600">{l.relevanceNote}</span>}
                </span>
                {open && (
                  <ActionForm
                    action={unlinkMatterEvidenceAction}
                    confirm="Remove this working link? The evidence record is kept."
                    showSuccess={false}
                  >
                    <Hidden name="projectId" value={projectId} />
                    <Hidden name="evidenceLinkId" value={l.linkId} />
                    <SubmitButton variant="danger">Remove link</SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}

        {open && (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Expander summary="Document / add evidence" testId="document-evidence">
              <ActionForm action={documentMatterEvidenceAction} resetOnSuccess testId="document-evidence-form">
                {hidden}
                <div className="space-y-2">
                  <FormGrid>
                    <TextField name="code" label="Code" required defaultValue={ev.nextEvidenceCode} />
                    <DateField name="evidenceDate" label="Evidence date" />
                  </FormGrid>
                  <TextField name="title" label="Title" required />
                  <TextArea name="summary" label="What it shows" rows={2} />
                  <FormGrid>
                    <SelectField name="sourcePersonId" label="Source" placeholder="—" options={stakeholders} />
                    <DateField name="receivedOn" label="Received on" />
                  </FormGrid>
                  <SelectField
                    name="valueDriverId"
                    label="Also relates to Value Driver (working link)"
                    placeholder="— No driver link —"
                    options={driverOptions}
                  />
                  <TextField name="relevanceNote" label="Relevance to this matter" />
                  <SubmitButton>Record and link evidence</SubmitButton>
                </div>
              </ActionForm>
            </Expander>
            <Expander summary="Link existing evidence" testId="link-matter-evidence">
              {ev.linkableEvidence.length === 0 ? (
                <Empty>All recorded evidence is already linked.</Empty>
              ) : (
                <ActionForm action={linkMatterEvidenceAction} resetOnSuccess testId="link-matter-evidence-form">
                  {hidden}
                  <div className="space-y-2">
                    <SelectField
                      name="evidenceId"
                      label="Evidence"
                      required
                      placeholder="— Choose evidence —"
                      options={ev.linkableEvidence.map((e) => ({ value: e.id, label: `${e.code} ${e.title}` }))}
                    />
                    <TextField name="relevanceNote" label="Relevance to this matter" />
                    <SubmitButton variant="secondary">Link evidence</SubmitButton>
                  </div>
                </ActionForm>
              )}
            </Expander>
          </div>
        )}
      </Section>

      <Section
        id="evidence-required"
        title="Evidence required"
        description="Evidence still to come, requested on an Assurance Information Request. When it arrives, record it and mark the item received with the evidence that satisfied it."
      >
        {ev.items.length === 0 ? (
          <Empty>No evidence requested for this matter.</Empty>
        ) : (
          <div className="space-y-2" data-testid="matter-requests">
            {ev.items.map((i) => (
              <div key={i.item.id} className="rounded border border-slate-200 p-2 text-sm" data-testid="matter-request">
                <div className="flex flex-wrap items-center gap-2">
                  <TextLink href={`${base}/information-request#ir-${i.request.id}`}>
                    {i.request.reference} #{i.item.sequence}
                  </TextLink>
                  <span className="font-medium">{i.item.description}</span>
                  <RequestItemBadge status={i.item.status} />
                </div>
                <div className="text-xs text-slate-500">
                  {[
                    `Requested from ${i.requestedFromName ?? "—"}`,
                    i.item.dueOn && `due ${formatDate(i.item.dueOn)}`,
                    i.driverCode && `Value Driver ${i.driverCode}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                {i.evidence && (
                  <div className="mt-1 text-xs" data-testid="request-fulfilled-by">
                    Fulfilled by{" "}
                    <TextLink href={`${base}/evidence/${i.evidence.id}`}>
                      {i.evidence.code} {i.evidence.title}
                    </TextLink>
                  </div>
                )}
                {i.request.status !== "closed" && (
                  <ActionForm action={fulfilRequestItemAction} testId="fulfil-item-form">
                    <Hidden name="projectId" value={projectId} />
                    <Hidden name="itemId" value={i.item.id} />
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <div className="min-w-36">
                        <SelectField
                          name="status"
                          label="Status"
                          required
                          defaultValue={i.item.status}
                          options={INFORMATION_REQUEST_ITEM_STATUSES.map((s) => ({
                            value: s,
                            label: IR_ITEM_STATUS_LABELS[s],
                          }))}
                        />
                      </div>
                      <div className="min-w-60 flex-1">
                        <SelectField
                          name="fulfilledByEvidenceId"
                          label="Fulfilled by evidence"
                          defaultValue={i.item.fulfilledByEvidenceId}
                          placeholder="—"
                          options={ev.fulfilmentEvidence.map((e) => ({ value: e.id, label: `${e.code} ${e.title}` }))}
                        />
                      </div>
                      <SubmitButton variant="secondary">Update request</SubmitButton>
                    </div>
                  </ActionForm>
                )}
              </div>
            ))}
          </div>
        )}

        {open && (
          <div className="mt-4">
            <Expander summary="+ Request evidence" testId="request-evidence">
              <ActionForm action={requestMatterEvidenceAction} resetOnSuccess testId="request-evidence-form">
                {hidden}
                <div className="space-y-2">
                  <TextArea
                    name="description"
                    label="Evidence required"
                    required
                    rows={2}
                    placeholder="e.g. Revised vendor implementation schedule"
                  />
                  <FormGrid cols={3}>
                    <SelectField
                      name="requestedFromPersonId"
                      label="Requested from"
                      placeholder="—"
                      options={stakeholders}
                    />
                    <DateField name="dueOn" label="Due" />
                    <SelectField
                      name="valueDriverId"
                      label="Value Driver"
                      placeholder="— Not driver-specific —"
                      options={driverOptions}
                    />
                  </FormGrid>
                  <FormGrid>
                    <SelectField
                      name="informationRequestId"
                      label="Add to Assurance Information Request"
                      required
                      defaultValue={ev.assuranceRequests.at(-1)?.id ?? "new"}
                      options={[
                        ...ev.assuranceRequests.map((r) => ({ value: r.id, label: `${r.reference} · ${r.title}` })),
                        { value: "new", label: `New request (${ev.nextRequestReference})` },
                      ]}
                    />
                    <TextField
                      name="newRequestTitle"
                      label="Title, if a new request"
                      defaultValue={`Assurance evidence — ${leakage.code}`}
                    />
                  </FormGrid>
                  <p className="text-xs text-slate-500">
                    Requesting evidence does not change the working stage — set it yourself if the matter is now
                    awaiting evidence.
                  </p>
                  <SubmitButton>Request evidence</SubmitButton>
                </div>
              </ActionForm>
            </Expander>
          </div>
        )}
      </Section>

      {open && (
        <NextStep
          stage={leakage.stage}
          outstanding={outstanding.length}
          arrived={arrived.length}
          evidence={ev.linked.length}
        />
      )}
    </>
  );
}

/** A suggestion only: stage and figures change solely through the consultant's explicit actions. */
function NextStep({
  stage,
  outstanding,
  arrived,
  evidence,
}: {
  stage: string | null;
  outstanding: number;
  arrived: number;
  evidence: number;
}) {
  let text: string;
  if (stage === "awaiting_evidence" && outstanding === 0 && arrived > 0) {
    text =
      "Requested evidence has arrived. Review what it shows; if you are ready to assess, move the stage to Assessing.";
  } else if (outstanding > 0) {
    text = `${outstanding} evidence request(s) outstanding. Follow up with the Risk / Leakage Owner or document what you already hold.`;
  } else if (evidence === 0) {
    text = "What would prove or disprove this risk? Document evidence you already hold, or request what is missing.";
  } else {
    text = "Evaluate what the evidence means, then update the working assessment and remediation yourself.";
  }
  return (
    <div data-testid="matter-next-step">
      <Notice tone="info" title="Suggested next step">
        {text}
      </Notice>
    </div>
  );
}
