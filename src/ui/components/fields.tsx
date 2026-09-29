import type { ReactNode } from "react";

import { FieldError } from "./action-form";

// Uncontrolled inputs with labels and per-field errors. Server-renderable.

const inputClass =
  "mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none disabled:bg-slate-100";

function Label({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

type Common = { name: string; label: string; hint?: ReactNode; required?: boolean; disabled?: boolean };

export function TextField({
  name,
  label,
  hint,
  required,
  disabled,
  defaultValue,
  placeholder,
  type = "text",
  inputMode,
}: Common & {
  defaultValue?: string | null;
  placeholder?: string;
  type?: "text" | "email" | "url" | "date" | "number";
  inputMode?: "decimal" | "numeric";
}) {
  return (
    <Label label={label} hint={hint} required={required}>
      <input
        name={name}
        type={type}
        inputMode={inputMode}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        disabled={disabled}
        className={inputClass}
      />
      <FieldError name={name} />
    </Label>
  );
}

export function DateField(props: Common & { defaultValue?: string | null }) {
  return <TextField {...props} type="date" />;
}

/** Money input: accepts 4800000, 4,800,000.00, 4.8m, -250k. */
export function MoneyField(props: Common & { defaultValue?: string | null; currency: string }) {
  return (
    <TextField
      {...props}
      inputMode="decimal"
      placeholder="e.g. 4.8m or 4,800,000"
      hint={props.hint ?? `${props.currency}. Accepts 4,800,000 · 4.8m · -250k`}
    />
  );
}

export function TextArea({
  name,
  label,
  hint,
  required,
  disabled,
  defaultValue,
  rows = 3,
  placeholder,
}: Common & { defaultValue?: string | null; rows?: number; placeholder?: string }) {
  return (
    <Label label={label} hint={hint} required={required}>
      <textarea
        name={name}
        rows={rows}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        disabled={disabled}
        className={inputClass}
      />
      <FieldError name={name} />
    </Label>
  );
}

export function SelectField({
  name,
  label,
  hint,
  required,
  disabled,
  defaultValue,
  options,
  placeholder,
}: Common & {
  defaultValue?: string | null;
  options: readonly { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <Label label={label} hint={hint} required={required}>
      <select name={name} defaultValue={defaultValue ?? ""} disabled={disabled} className={inputClass}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <FieldError name={name} />
    </Label>
  );
}

export function Checkbox({
  name,
  label,
  defaultChecked,
  hint,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5" />
      <span>
        <span className="font-medium text-slate-700">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
        <FieldError name={name} />
      </span>
    </label>
  );
}

export function Hidden({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}

export function FormGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 | 4 }) {
  const c = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4" }[cols];
  return <div className={`grid grid-cols-1 gap-3 ${c}`}>{children}</div>;
}
