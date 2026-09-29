import { parseMoneyInput } from "@/domain/money";

// FormData → command input. Commands remain the validation authority; these
// helpers only translate browser form conventions (blank strings, checkboxes,
// "4.8m") into the shapes commands accept.

export class FormInputError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

function raw(fd: FormData, name: string): string | undefined {
  const v = fd.get(name);
  return typeof v === "string" ? v.trim() : undefined;
}

/** For create commands: blank → undefined (field omitted). */
export function opt(fd: FormData, name: string): string | undefined {
  const v = raw(fd, name);
  return v ? v : undefined;
}

/** For update commands: absent → undefined (unchanged); blank → null (cleared). */
export function clear(fd: FormData, name: string): string | null | undefined {
  const v = raw(fd, name);
  if (v === undefined) return undefined;
  return v === "" ? null : v;
}

export function required(fd: FormData, name: string): string {
  return raw(fd, name) ?? "";
}

export function bool(fd: FormData, name: string): boolean {
  const v = fd.get(name);
  return v === "on" || v === "true";
}

/** Money: blank → null/undefined per `mode`; otherwise parsed to a 2dp string. */
export function moneyField(fd: FormData, name: string, mode: "create"): string | undefined;
export function moneyField(fd: FormData, name: string, mode: "update"): string | null | undefined;
export function moneyField(fd: FormData, name: string, mode: "create" | "update") {
  const v = raw(fd, name);
  if (v === undefined) return undefined;
  if (v === "") return mode === "create" ? undefined : null;
  try {
    return parseMoneyInput(v);
  } catch (err) {
    throw new FormInputError(name, err instanceof Error ? err.message : "Invalid amount");
  }
}

/** Metric values: allow thousands separators and a trailing % sign. */
export function metricField(fd: FormData, name: string, mode: "create" | "update") {
  const v = raw(fd, name);
  if (v === undefined) return undefined;
  if (v === "") return mode === "create" ? undefined : null;
  const cleaned = v.replace(/[,\s]/g, "").replace(/%$/, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) throw new FormInputError(name, `"${v}" is not a number`);
  return cleaned;
}
