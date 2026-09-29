import {
  addRequestItemAction,
  closeInformationRequestAction,
  createInformationRequestAction,
  issueInformationRequestAction,
  removeRequestItemAction,
  updateRequestItemAction,
} from "@/server/actions/information-request";
import { getInformationRequestWorkspace, type InformationRequestWorkspace } from "@/server/queries/information-request";
import { INFORMATION_REQUEST_ITEM_STATUSES } from "@/domain/statuses";
import { ActionForm, SubmitButton } from "@/ui/components/action-form";
import { PlainBadge, RequestItemBadge } from "@/ui/components/badges";
import { DateField, FormGrid, Hidden, SelectField, TextArea, TextField } from "@/ui/components/fields";
import { ButtonLink, Empty, Expander, Notice, Section } from "@/ui/components/layout";
import { reportPreviewHref } from "@/ui/reports/routes";
import { formatDate } from "@/ui/format";
import { IR_ITEM_STATUS_LABELS, IR_STATUS_LABELS } from "@/ui/labels";
import { requireProject } from "@/ui/require";

export const metadata = { title: "Information Request" };

type Workspace = InformationRequestWorkspace;
type RequestEntry = Workspace["requests"][number];

export default async function InformationRequestPage({
  params,
}: PageProps<"/projects/[projectId]/information-request">) {
  const { projectId } = await params;
  await requireProject(projectId);
  const ws = await getInformationRequestWorkspace(projectId);

  return (
    <>
      <p className="mb-4 max-w-3xl text-sm text-slate-600">
        What Cardaxia needs from the client to re-qualify the Business Case. Track each item until it is received — and
        link what arrives to the evidence register.
      </p>
      {ws.requests.length === 0 ? (
        <Section title="Create the Information Request">
          <ActionForm action={createInformationRequestAction} testId="create-ir-form">
            <Hidden name="projectId" value={projectId} />
            <FormGrid>
              <TextField name="reference" label="Reference" required defaultValue="IR-01" />
              <TextField name="title" label="Title" required defaultValue="Information Request — Re-Qualification" />
            </FormGrid>
            <div className="mt-3">
              <SubmitButton>Create Information Request</SubmitButton>
            </div>
          </ActionForm>
        </Section>
      ) : (
        ws.requests.map((entry) => <RequestPanel key={entry.request.id} projectId={projectId} entry={entry} ws={ws} />)
      )}
    </>
  );
}

function RequestPanel({ projectId, entry, ws }: { projectId: string; entry: RequestEntry; ws: Workspace }) {
  const { request, items } = entry;
  const stakeholderOptions = ws.stakeholders.map((s) => ({ value: s.personId, label: s.name }));
  const driverOptions = ws.drivers.map((d) => ({ value: d.driverId, label: `${d.code} ${d.name}` }));
  const evidenceOptions = ws.evidence.map((e) => ({ value: e.id, label: `${e.code} ${e.title}` }));

  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          {request.reference} · {request.title}
          <PlainBadge tone={request.status === "draft" ? "amber" : request.status === "issued" ? "sky" : "slate"}>
            {IR_STATUS_LABELS[request.status]}
          </PlainBadge>
        </span>
      }
      description={
        request.status === "draft"
          ? "Draft — items can be added, edited and removed."
          : request.status === "issued"
            ? `Issued ${formatDate(request.issuedOn)} — update item status as information arrives. Items can no longer be removed.`
            : `Closed ${formatDate(request.closedOn)}.`
      }
      actions={
        <div className="flex flex-wrap gap-2">
          <ButtonLink variant="secondary" href={reportPreviewHref(projectId, "information_request", request.id)}>
            Report preview
          </ButtonLink>
          {request.status === "draft" && (
            <ActionForm action={issueInformationRequestAction} confirm="Issue this Information Request to the client?">
              <Hidden name="projectId" value={projectId} />
              <Hidden name="informationRequestId" value={request.id} />
              <SubmitButton>Mark issued</SubmitButton>
            </ActionForm>
          )}
          {request.status === "issued" && (
            <ActionForm action={closeInformationRequestAction} confirm="Close this Information Request?">
              <Hidden name="projectId" value={projectId} />
              <Hidden name="informationRequestId" value={request.id} />
              <SubmitButton variant="secondary">Close request</SubmitButton>
            </ActionForm>
          )}
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap gap-3 text-sm" data-testid="ir-counts">
        {INFORMATION_REQUEST_ITEM_STATUSES.map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <RequestItemBadge status={s} /> {items.filter((i) => i.item.status === s).length}
          </span>
        ))}
      </div>

      {items.length === 0 && <Empty>No items yet.</Empty>}

      {INFORMATION_REQUEST_ITEM_STATUSES.map((status) => {
        const group = items.filter((i) => i.item.status === status);
        if (group.length === 0) return null;
        return (
          <div key={status} className="mb-4">
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              {IR_ITEM_STATUS_LABELS[status]} ({group.length})
            </h3>
            <div className="space-y-2">
              {group.map(({ item, requestedFromName, driverCode, evidenceCode, evidenceTitle }) => (
                <Expander
                  key={item.id}
                  testId="ir-item"
                  summary={
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <span className="text-slate-500">#{item.sequence}</span>
                      <span>{item.description}</span>
                      <RequestItemBadge status={item.status} />
                      <span className="font-normal text-slate-500">
                        {[
                          requestedFromName && `from ${requestedFromName}`,
                          item.dueOn && `due ${formatDate(item.dueOn)}`,
                          driverCode,
                          evidenceCode && `→ ${evidenceCode}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  }
                >
                  {request.status === "closed" ? (
                    <p className="text-sm text-slate-600">
                      Request closed. {evidenceCode ? `Fulfilled by ${evidenceCode} ${evidenceTitle}.` : ""}
                    </p>
                  ) : (
                    <>
                      <ActionForm action={updateRequestItemAction}>
                        <Hidden name="projectId" value={projectId} />
                        <Hidden name="itemId" value={item.id} />
                        <div className="space-y-3">
                          <TextArea
                            name="description"
                            label="Requested information"
                            required
                            rows={2}
                            defaultValue={item.description}
                          />
                          <FormGrid cols={3}>
                            <SelectField
                              name="status"
                              label="Status"
                              required
                              defaultValue={item.status}
                              options={INFORMATION_REQUEST_ITEM_STATUSES.map((s) => ({
                                value: s,
                                label: IR_ITEM_STATUS_LABELS[s],
                              }))}
                            />
                            <SelectField
                              name="requestedFromPersonId"
                              label="Requested from"
                              defaultValue={item.requestedFromPersonId}
                              placeholder="—"
                              options={stakeholderOptions}
                            />
                            <DateField name="dueOn" label="Due" defaultValue={item.dueOn} />
                            <SelectField
                              name="valueDriverId"
                              label="Value Driver"
                              defaultValue={item.valueDriverId}
                              placeholder="— Not driver-specific —"
                              options={driverOptions}
                            />
                            <SelectField
                              name="fulfilledByEvidenceId"
                              label="Fulfilled by evidence"
                              defaultValue={item.fulfilledByEvidenceId}
                              placeholder="—"
                              options={evidenceOptions}
                              hint="Record evidence in the Evidence register first"
                            />
                            <TextField name="notes" label="Notes" defaultValue={item.notes} />
                          </FormGrid>
                          <SubmitButton variant="secondary">Save item</SubmitButton>
                        </div>
                      </ActionForm>
                      {request.status === "draft" && (
                        <div className="mt-3 border-t border-slate-100 pt-3">
                          <ActionForm
                            action={removeRequestItemAction}
                            confirm="Remove this item from the draft request?"
                            showSuccess={false}
                          >
                            <Hidden name="projectId" value={projectId} />
                            <Hidden name="itemId" value={item.id} />
                            <SubmitButton variant="danger">Remove item</SubmitButton>
                          </ActionForm>
                        </div>
                      )}
                    </>
                  )}
                </Expander>
              ))}
            </div>
          </div>
        );
      })}

      {request.status !== "closed" ? (
        <Expander summary="Add item" open={items.length === 0} testId="add-ir-item">
          <ActionForm action={addRequestItemAction} resetOnSuccess testId="add-ir-item-form">
            <Hidden name="projectId" value={projectId} />
            <Hidden name="informationRequestId" value={request.id} />
            <div className="space-y-3">
              <TextArea
                name="description"
                label="Requested information"
                required
                rows={2}
                placeholder="e.g. Baseline effort data per case type, FY25"
              />
              <FormGrid cols={3}>
                <SelectField
                  name="requestedFromPersonId"
                  label="Requested from"
                  placeholder="—"
                  options={stakeholderOptions}
                />
                <DateField name="dueOn" label="Due" />
                <SelectField
                  name="valueDriverId"
                  label="Value Driver"
                  placeholder="— Not driver-specific —"
                  options={driverOptions}
                />
              </FormGrid>
              <SubmitButton>Add item</SubmitButton>
            </div>
          </ActionForm>
        </Expander>
      ) : (
        <Notice tone="locked">This request is closed.</Notice>
      )}
    </Section>
  );
}
