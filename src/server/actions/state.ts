/** Result of a server action, consumed by <ActionForm> via useActionState. */
export type ActionState = {
  status: "idle" | "ok" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Changes on every response so forms can react (e.g. reset after success). */
  nonce: number;
};

export const IDLE: ActionState = { status: "idle", nonce: 0 };
