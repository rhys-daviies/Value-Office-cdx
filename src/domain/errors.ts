export type InputIssue = { path: string; message: string };

/** A rule violation the consultant can act on (as opposed to a programming error). */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: { constraint?: string; issues?: InputIssue[] } = {},
  ) {
    super(message);
    this.name = "DomainError";
  }
}
