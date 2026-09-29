"use client";

import { useState, type ReactNode } from "react";

/**
 * Collapsible panel. `open` is the initial state only: after a server action
 * re-renders the page, the panel keeps whatever state the consultant left it in.
 */
export function Expander({
  summary,
  children,
  open = false,
  testId,
}: {
  summary: ReactNode;
  children: ReactNode;
  open?: boolean;
  testId?: string;
}) {
  const [initialOpen] = useState(open);
  return (
    <details className="group rounded border border-slate-200 bg-white" open={initialOpen} data-testid={testId}>
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-800 select-none hover:bg-slate-50">
        {summary}
      </summary>
      <div className="border-t border-slate-200 p-3">{children}</div>
    </details>
  );
}
