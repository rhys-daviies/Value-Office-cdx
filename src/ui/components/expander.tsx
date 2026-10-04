"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Collapsible panel. `open` is the initial state only: after a server action
 * re-renders the page, the panel keeps whatever state the consultant left it in.
 * With an `id`, a link to `#id` (e.g. from Continuous Assurance) opens the panel.
 */
export function Expander({
  summary,
  children,
  open = false,
  testId,
  id,
}: {
  summary: ReactNode;
  children: ReactNode;
  open?: boolean;
  testId?: string;
  id?: string;
}) {
  const [initialOpen] = useState(open);
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (id && ref.current && window.location.hash === `#${id}`) {
      ref.current.open = true;
      ref.current.scrollIntoView({ block: "start" });
    }
  }, [id]);
  return (
    <details
      ref={ref}
      id={id}
      className="group scroll-mt-4 rounded border border-slate-200 bg-white"
      open={initialOpen}
      data-testid={testId}
    >
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-800 select-none hover:bg-slate-50">
        {summary}
      </summary>
      <div className="border-t border-slate-200 p-3">{children}</div>
    </details>
  );
}
