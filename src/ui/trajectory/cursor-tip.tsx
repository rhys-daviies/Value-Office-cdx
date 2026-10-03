import type { CursorTip, TipTag } from "./cursor";

// Monthly crosshair tooltip card (Phase 4D.9N.1A), shared by the primary and alternative trajectory charts. Values AT
// the cursor date are bold with their governed tag; Previous / Next values are muted and always carry their date.

const AT_DATE: TipTag[] = ["Entered", "Formal", "Scenario"];

export function CursorTipCard({ tip, testId }: { tip: CursorTip; testId: string }) {
  return (
    <div
      className="max-w-[340px] rounded border border-slate-200 bg-white px-3 py-2 text-xs shadow-md"
      data-testid={testId}
    >
      <p className="font-semibold text-slate-900" data-testid="tip-heading">
        {tip.heading}
      </p>
      {tip.events.length > 0 && (
        <ul className="mt-1 space-y-0.5" data-testid="tip-events">
          {tip.events.map((e) => (
            <li key={e} className="font-medium text-slate-800">
              ◆ {e}
            </li>
          ))}
        </ul>
      )}
      {tip.blocks.map((b) => (
        <div key={b.series} className="mt-1.5" data-testid="tip-block" data-series-label={b.series}>
          <p className="flex flex-wrap items-center gap-1 font-medium" style={{ color: b.color }}>
            {b.series}
            {b.badges?.map((x) => (
              <span key={x} className="rounded bg-slate-100 px-1 text-[10px] font-medium text-slate-700">
                {x}
              </span>
            ))}
          </p>
          {b.note && <p className="text-slate-500">{b.note}</p>}
          {b.entries.map((e) => (
            <p
              key={`${e.tag}-${e.date ?? ""}-${e.value}`}
              className={AT_DATE.includes(e.tag) ? "text-slate-900" : "text-slate-500"}
              data-testid="tip-entry"
              data-tag={e.tag}
            >
              <span className="mr-1 text-[10px] tracking-wide uppercase">{e.tag}</span>
              {e.date && <span className="mr-1">{e.date} ·</span>}
              <span className={AT_DATE.includes(e.tag) ? "font-semibold tabular-nums" : "tabular-nums"}>{e.value}</span>
              {e.detail && <span className="ml-1 text-slate-500">· {e.detail}</span>}
            </p>
          ))}
        </div>
      ))}
      {tip.footer.length > 0 && (
        <div className="mt-1.5 border-t border-slate-100 pt-1 text-slate-600" data-testid="tip-footer">
          {tip.footer.map((f) => (
            <p key={f}>{f}</p>
          ))}
        </div>
      )}
    </div>
  );
}
