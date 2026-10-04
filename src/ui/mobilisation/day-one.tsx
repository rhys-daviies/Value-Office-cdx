import { DAY_ONE_SUGGESTIONS, remainingSuggestions } from "@/domain/day-one-requests";
import { addDayOneItemsAction, createDayOneRequestAction } from "@/server/actions/mobilisation";
import { ActionForm, SubmitButton } from "@/ui/components/action-form";
import { PlainBadge } from "@/ui/components/badges";
import { Hidden, TextArea, TextField } from "@/ui/components/fields";
import { Section, TextLink } from "@/ui/components/layout";
import { IR_STATUS_LABELS } from "@/ui/labels";

// Day-1 Information Request on Mobilisation (4D.10C): create the Mobilisation request with optional starter items,
// then add, edit and issue it through the existing Information Request workflow. An existing request is shown and
// linked — never duplicated.

type DayOneRequest = {
  id: string;
  reference: string;
  title: string;
  status: "draft" | "issued" | "closed";
  items: number;
  outstanding: number;
  descriptions: string[];
};

function Suggestions({ options }: { options: readonly { key: string; description: string }[] }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-slate-700">Suggested Day-1 items (optional)</legend>
      <p className="text-xs text-slate-500">Starter suggestions only — each becomes an ordinary, editable item.</p>
      <ul className="mt-2 space-y-1">
        {options.map((s) => (
          <li key={s.key}>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="suggestion" value={s.key} data-testid={`day-one-${s.key}`} />
              {s.description}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

export function DayOneRequest({ projectId, request }: { projectId: string; request: DayOneRequest | null }) {
  const base = `/projects/${projectId}`;
  if (!request) {
    return (
      <Section
        id="day-one-request"
        title="Day-1 Information Request"
        description="What Cardaxia needs from the client to define the Value Case. Select any suggested items, add your own, then edit and issue the request on the Information Requests page."
      >
        <ActionForm action={createDayOneRequestAction} testId="day-one-create-form">
          <Hidden name="projectId" value={projectId} />
          <div className="space-y-3">
            <TextField name="title" label="Title" required defaultValue="Day-1 Information Request" />
            <Suggestions options={DAY_ONE_SUGGESTIONS} />
            <TextArea
              name="additionalItems"
              label="Additional items"
              rows={3}
              hint="Optional — one item per line"
              placeholder="e.g. Baseline effort data per case type, FY25"
            />
            <SubmitButton>Create Information Request</SubmitButton>
          </div>
        </ActionForm>
      </Section>
    );
  }
  const remaining = remainingSuggestions(request.descriptions);
  return (
    <Section
      id="day-one-request"
      title="Day-1 Information Request"
      description="The Mobilisation request already exists. Edit, issue and track it on the Information Requests page."
    >
      <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="day-one-existing">
        <TextLink href={`${base}/information-request#ir-${request.id}`}>
          {request.reference} · {request.title}
        </TextLink>
        <PlainBadge tone={request.status === "draft" ? "amber" : request.status === "issued" ? "sky" : "slate"}>
          {IR_STATUS_LABELS[request.status]}
        </PlainBadge>
        <span className="text-slate-600">
          {request.items} {request.items === 1 ? "item" : "items"}
          {request.status !== "draft" && ` · ${request.outstanding} outstanding`}
        </span>
      </div>
      {request.status !== "closed" && (remaining.length > 0 || request.status === "draft") && (
        <ActionForm action={addDayOneItemsAction} resetOnSuccess className="mt-4" testId="day-one-add-form">
          <Hidden name="projectId" value={projectId} />
          <Hidden name="informationRequestId" value={request.id} />
          <div className="space-y-3">
            {remaining.length > 0 && <Suggestions options={remaining} />}
            <TextArea name="additionalItems" label="Additional items" rows={2} hint="Optional — one item per line" />
            <SubmitButton variant="secondary">Add to {request.reference}</SubmitButton>
          </div>
        </ActionForm>
      )}
    </Section>
  );
}
