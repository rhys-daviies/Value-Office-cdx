// Minimal escaping HTML builder for report rendering. Every interpolated value is
// escaped unless it is already SafeHtml (the output of `html`). Arrays are joined.
// Reports are rendered to strings (not React) so the browser preview, the issued
// view and the PDF share one deterministic renderer: Next.js forbids
// react-dom/server in server code.

export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

type Part = SafeHtml | string | number | boolean | null | undefined | readonly Part[];

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

function render(part: Part): string {
  if (part === null || part === undefined || part === false || part === true) return "";
  if (part instanceof SafeHtml) return part.value;
  if (Array.isArray(part)) return part.map(render).join("");
  return escapeHtml(String(part));
}

export function html(strings: TemplateStringsArray, ...parts: Part[]): SafeHtml {
  let out = strings[0]!;
  parts.forEach((p, i) => {
    out += render(p) + strings[i + 1]!;
  });
  return new SafeHtml(out);
}

/** Only for trusted constants (e.g. the report stylesheet). */
export function trusted(value: string): SafeHtml {
  return new SafeHtml(value);
}
