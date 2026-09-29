"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";

import { IDLE, type ActionState } from "@/server/actions/state";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const FormStateContext = createContext<{ state: ActionState; pending: boolean }>({ state: IDLE, pending: false });

/**
 * Submits a server action without React's automatic form reset, so entered
 * values survive a validation failure. Optionally resets after success and asks
 * for confirmation before consequential actions.
 */
export function ActionForm({
  action,
  children,
  confirm,
  resetOnSuccess = false,
  className,
  showSuccess = true,
  testId,
}: {
  action: Action;
  children: ReactNode;
  confirm?: string;
  resetOnSuccess?: boolean;
  className?: string;
  showSuccess?: boolean;
  testId?: string;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "ok" && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <FormStateContext.Provider value={{ state, pending }}>
      <form
        ref={ref}
        className={className}
        data-testid={testId}
        onSubmit={(e) => {
          e.preventDefault();
          if (confirm && !window.confirm(confirm)) return;
          const fd = new FormData(e.currentTarget);
          startTransition(() => formAction(fd));
        }}
      >
        {children}
        <FormMessage showSuccess={showSuccess} />
      </form>
    </FormStateContext.Provider>
  );
}

function FormMessage({ showSuccess }: { showSuccess: boolean }) {
  const { state } = useContext(FormStateContext);
  if (state.status === "error") {
    return (
      <p role="alert" className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        {state.message}
      </p>
    );
  }
  if (state.status === "ok" && showSuccess && state.message) {
    return (
      <p role="status" className="mt-2 text-sm text-emerald-700">
        ✓ {state.message}
      </p>
    );
  }
  return null;
}

export function FieldError({ name }: { name: string }) {
  const { state } = useContext(FormStateContext);
  const message = state.status === "error" ? state.fieldErrors?.[name] : undefined;
  if (!message) return null;
  return <span className="mt-1 block text-xs text-red-700">{message}</span>;
}

export function SubmitButton({
  children,
  variant = "primary",
  disabled,
  title,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "authorise";
  disabled?: boolean;
  title?: string;
}) {
  const { pending } = useContext(FormStateContext);
  const styles = {
    primary: "bg-slate-900 text-white hover:bg-slate-700",
    secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
    danger: "border border-red-300 bg-white text-red-700 hover:bg-red-50",
    authorise: "bg-emerald-700 text-white hover:bg-emerald-600",
  }[variant];
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      title={title}
      className={`inline-flex items-center rounded px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {pending ? "Saving…" : children}
    </button>
  );
}
