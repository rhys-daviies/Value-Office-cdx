import type { MobilisationItem, MobilisationStatus } from "@/domain/mobilisation";
import { PlainBadge } from "@/ui/components/badges";
import { TextLink } from "@/ui/components/layout";

// Mobilisation status (4D.10C), shared by the Mobilisation page and the pre-V1 Overview. Guidance only: it lists what
// is established and outstanding and recommends one next action. It never scores and never blocks — the consultant can
// go anywhere, and the existing domain gates stay authoritative.

function Item({ item, base, showAction }: { item: MobilisationItem; base: string; showAction: boolean }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1" data-testid={`mobilisation-item-${item.key}`}>
      <span aria-hidden className={item.done ? "text-emerald-600" : "text-slate-400"}>
        {item.done ? "✓" : "○"}
      </span>
      <span className="font-medium text-slate-800">{item.title}</span>
      <span className="text-slate-600">{item.detail}</span>
      {showAction && item.action && (
        <span className="text-sm">
          · <TextLink href={`${base}/${item.action.href}`}>{item.action.label}</TextLink>
        </span>
      )}
    </li>
  );
}

export function MobilisationStatusPanel({ status, base }: { status: MobilisationStatus; base: string }) {
  if (status.stage === "authorised") {
    return (
      <section
        className="mb-6 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm"
        data-testid="mobilisation-status"
        data-stage="authorised"
      >
        <h2 className="text-base font-semibold text-emerald-900">Mobilisation complete</h2>
        <p className="mt-1 text-emerald-900">
          The Value Case has been authorised
          {status.inForceVersionNumber !== null ? ` — Authorised V${status.inForceVersionNumber} is in force` : ""}.
          Ongoing work continues in <TextLink href={`${base}/assurance`}>Assurance</TextLink>; the record below remains
          editable where the domain allows.
        </p>
      </section>
    );
  }
  const required = status.outstanding.filter((i) => i.requirement === "required");
  const recommended = status.outstanding.filter((i) => i.requirement === "recommended");
  return (
    <section
      className="mb-6 rounded-lg border border-sky-300 bg-white p-4 text-sm shadow-sm"
      data-testid="mobilisation-status"
      data-stage="mobilising"
      aria-labelledby="mobilisation-status-heading"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="mobilisation-status-heading" className="text-base font-semibold text-slate-900">
          Mobilisation status
        </h2>
        <span className="text-xs text-slate-500">Value Case Definition in progress · guidance, not a gate</span>
      </div>

      {status.next && (
        <div className="mt-3 rounded border border-sky-200 bg-sky-50 px-3 py-2" data-testid="mobilisation-next">
          <p className="text-xs font-semibold tracking-wide text-sky-800 uppercase">Recommended next action</p>
          <p className="mt-0.5 font-medium">
            <TextLink href={`${base}/${status.next.href}`}>{status.next.label}</TextLink>
          </p>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div data-testid="mobilisation-outstanding">
          <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Outstanding ({status.outstanding.length})
          </h3>
          {status.outstanding.length === 0 ? (
            <p className="py-1 text-slate-600">Nothing outstanding.</p>
          ) : (
            <>
              {required.length > 0 && (
                <>
                  <p className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                    <PlainBadge tone="amber">Required for V1</PlainBadge> what the domain needs to propose and authorise
                    V1
                  </p>
                  <ul>
                    {required.map((i) => (
                      <Item key={i.key} item={i} base={base} showAction />
                    ))}
                  </ul>
                </>
              )}
              {recommended.length > 0 && (
                <>
                  <p className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                    <PlainBadge tone="slate">Recommended</PlainBadge> useful information, never blocking
                  </p>
                  <ul>
                    {recommended.map((i) => (
                      <Item key={i.key} item={i} base={base} showAction />
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
        <div data-testid="mobilisation-completed">
          <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Completed ({status.completed.length})
          </h3>
          <ul>
            {status.completed.map((i) => (
              <Item key={i.key} item={i} base={base} showAction={false} />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
