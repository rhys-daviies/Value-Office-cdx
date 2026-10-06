import {
  addRequestItemAction,
  closeInformationRequestAction,
  createInformationRequestAction,
  issueInformationRequestAction,
  removeRequestItemAction,
  updateRequestItemAction,
} from "@/server/actions/information-request";
import { getInformationRequestWorkspace, type InformationRequestWorkspace } from "@/server/queries/information-request";
import { formatRequestReference } from "@/server/commands/information-request";
import { ATTENTION_WINDOW_DAYS, todayIso } from "@/domain/attention";
import { outstandingQueue, type DueState } from "@/domain/request-queue";
import { INFORMATION_REQUEST_ITEM_STATUSES, INFORMATION_REQUEST_PURPOSES } from "@/domain/statuses";
import { ActionForm, SubmitButton } from "@/ui/components/action-form";
import { PlainBadge, RequestItemBadge } from "@/ui/components/badges";
import { DateField, FormGrid, Hidden, SelectField, TextArea, TextField } from "@/ui/components/fields";
import { ButtonLink, Empty, Expander, Notice, Section, Table, TextLink } from "@/ui/components/layout";
import { reportPreviewHref } from "@/ui/reports/routes";
import { formatDate } from "@/ui/format";
import { IR_ITEM_STATUS_LABELS, IR_PURPOSE_LABELS, IR_STATUS_LABELS, irPurposeLabel } from "@/ui/labels";
import { ownerOptions, personWithRole } from "@/ui/people";
import { requireProject } from "@/ui/require";

export const metadata = { title: "Information Requests" };

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
        What Cardaxia needs from the client — to define the Value Case at Mobilisation, and as evidence for Assurance
        matters throughout the engagement. Track each item until it is received, and link what arrives to the evidence
        register.
      </p>
      {ws.requests.length === 0 ? (
        <Section title="Create the Information Request">
          <ActionForm action={createInformationRequestAction} testId="create-ir-form">
            <Hidden name="projectId" value={projectId} />
            <Hidden name="purpose" value="mobilisation" />
            <FormGrid>
              <TextField name="reference" label="Reference" required defaultValue="IR-01" />
              <TextField
                name="title"
                label="Title"
                required
                defaultValue="Information Request — Value Case Definition"
              />
            </FormGrid>
            <div className="mt-3">
              <SubmitButton>Create Information Request</SubmitButton>
            </div>
          </ActionForm>
        </Section>
      ) : (
        <>
          <OutstandingItems projectId={projectId} ws={ws} today={todayIso()} />
          <RequestIndex ws={ws} />
          {ws.requests.map((entry) => (
            <RequestPanel key={entry.request.id} projectId={projectId} entry={entry} ws={ws} />
          ))}
          <Section title="New Information Request" tone="muted">
            <Expander summary="Raise another Information Request" testId="new-ir">
              <ActionForm action={createInformationRequestAction} testId="new-ir-form">
                <Hidden name="projectId" value={projectId} />
                <FormGrid cols={3}>
                  <TextField
                    name="reference"
                    label="Reference"
                    required
                    defaultValue={formatRequestReference(ws.requests.map((r) => r.request.reference))}
                  />
                  <TextField name="title" label="Title" required defaultValue="Assurance evidence request" />
                  <SelectField
                    name="purpose"
                    label="Purpose"
                    required
                    defaultValue="assurance"
                    options={INFORMATION_REQUEST_PURPOSES.map((p) => ({ value: p, label: IR_PURPOSE_LABELS[p] }))}
                  />
                </FormGrid>
                <div className="mt-3">
                  <SubmitButton>Create Information Request</SubmitButton>
                </div>
              </ActionForm>
            </Expander>
          </Section>
        </>
      )}
    </>
  );
}

const DUE_BADGE: Record<DueState, { label: string; tone: "red" | "amber" | "slate" }> = {
  overdue: { label: "Overdue", tone: "red" },
  due_soon: { label: "Due soon", tone: "amber" },
  outstanding: { label: "Outstanding", tone: "slate" },
};

/** Phase 4D.13: the consultant's working queue — every outstanding item on an issued request, earliest due first. */
function OutstandingItems({ projectId, ws, today }: { projectId: string; ws: Workspace; today: string }) {
  const driverName = new Map(ws.drivers.map((d) => [d.driverId, d.name]));
  const queue = outstandingQueue(
    ws.requests.flatMap(({ request, items }) =>
      items.map((i) => ({
        ...i,
        request,
        requestStatus: request.status,
        itemStatus: i.item.status,
        dueOn: i.item.dueOn,
        reference: request.reference,
        sequence: i.item.sequence,
      })),
    ),
    today,
  );
  const overdue = queue.filter((q) => q.due === "overdue").length;
  const soon = queue.filter((q) => q.due === "due_soon").length;
  return (
    <Section
      title={`Outstanding items (${queue.length})`}
      description={
        queue.length === 0
          ? undefined
          : `${overdue} overdue · ${soon} due within ${ATTENTION_WINDOW_DAYS} days · open or partially received items on issued requests, earliest due first.`
      }
      testId="ir-outstanding"
    >
      {queue.length === 0 ? (
        <Empty>Nothing outstanding — no open items on issued requests.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Due</th>
              <th>Request / item</th>
              <th>Requested from</th>
              <th>Status</th>
              <th>Value Driver</th>
              <th>Assurance matter</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((q) => (
              <tr key={q.item.id} data-testid="ir-outstanding-row" data-due={q.due}>
                <td className="whitespace-nowrap">
                  <PlainBadge tone={DUE_BADGE[q.due].tone}>{DUE_BADGE[q.due].label}</PlainBadge>{" "}
                  {q.dueOn ? formatDate(q.dueOn) : <span className="text-slate-500">No due date</span>}
                </td>
                <td>
                  <TextLink href={`#ir-${q.request.id}`}>
                    {q.reference} item {q.sequence}
                  </TextLink>
                  <span className="block text-slate-600">{q.item.description}</span>
                </td>
                <td>
                  {q.requestedFromName ? (
                    personWithRole(q.requestedFromName, q.requestedFromRole)
                  ) : (
                    <span className="text-amber-700">Not assigned</span>
                  )}
                </td>
                <td>
                  <RequestItemBadge status={q.itemStatus} />
                </td>
                <td>
                  {q.driverCode
                    ? `${q.driverCode} ${q.item.valueDriverId ? (driverName.get(q.item.valueDriverId) ?? "") : ""}`.trim()
                    : "—"}
                </td>
                <td>
                  {q.matter?.id ? (
                    <TextLink href={`/projects/${projectId}/assurance/matters/${q.matter.id}`}>
                      {q.matter.code} {q.matter.title}
                    </TextLink>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Section>
  );
}

function RequestIndex({ ws }: { ws: Workspace }) {
  return (
    <Section title={`Information Requests (${ws.requests.length})`}>
      <Table>
        <thead>
          <tr>
            <th>Request</th>
            <th>Purpose</th>
            <th>Status</th>
            <th>Outstanding</th>
            <th>Items</th>
          </tr>
        </thead>
        <tbody>
          {ws.requests.map(({ request, items }) => (
            <tr key={request.id} data-testid="ir-index-row">
              <td>
                <TextLink href={`#ir-${request.id}`}>
                  {request.reference} · {request.title}
                </TextLink>
              </td>
              <td>{irPurposeLabel(request.purpose)}</td>
              <td>{IR_STATUS_LABELS[request.status]}</td>
              <td>{items.filter((i) => i.item.status === "open" || i.item.status === "partially_received").length}</td>
              <td>{items.length}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}

function RequestPanel({ projectId, entry, ws }: { projectId: string; entry: RequestEntry; ws: Workspace }) {
  const { request, items } = entry;
  const stakeholderOptions = ownerOptions(ws.stakeholders);
  const driverOptions = ws.drivers.map((d) => ({ value: d.driverId, label: `${d.code} ${d.name}` }));
  const evidenceOptions = ws.evidence.map((e) => ({ value: e.id, label: `${e.code} ${e.title}` }));

  const matterOptions = ws.openMatters.map((m) => ({ value: m.id, label: `${m.code} ${m.title}` }));

  return (
    <Section
      id={`ir-${request.id}`}
      title={
        <span className="inline-flex items-center gap-2">
          {request.reference} · {request.title}
          <PlainBadge tone={request.status === "draft" ? "amber" : request.status === "issued" ? "sky" : "slate"}>
            {IR_STATUS_LABELS[request.status]}
          </PlainBadge>
          <PlainBadge tone={request.purpose === "assurance" ? "violet" : "slate"}>
            {irPurposeLabel(request.purpose)}
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
              {group.map(
                ({ item, requestedFromName, requestedFromRole, driverCode, evidenceCode, evidenceTitle, matter }) => (
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
                            matter && `matter ${matter.code}`,
                            requestedFromName && `from ${personWithRole(requestedFromName, requestedFromRole)}`,
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
                    {matter && (
                      <p className="mb-2 text-sm">
                        Evidence for Assurance matter{" "}
                        <TextLink href={`/projects/${projectId}/assurance/matters/${matter.id}`}>
                          {matter.code} {matter.title}
                        </TextLink>
                      </p>
                    )}
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
                ),
              )}
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
                {request.purpose === "assurance" && (
                  <SelectField
                    name="valueLeakageId"
                    label="Assurance matter"
                    placeholder="— Not matter-specific —"
                    options={matterOptions}
                  />
                )}
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
