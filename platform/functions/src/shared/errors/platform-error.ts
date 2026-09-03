export class PlatformError extends Error {
  readonly code: string;
  readonly cause?: unknown;
  // Optional structured context surfaced to the client alongside `code`
  // (see `translateThrown` in `https-callable.ts`). Used by the
  // differentiation CAS contract (F5.2 §4.2) so a stale-write refusal can
  // carry the current record state without inventing a second error
  // channel. Never populate this with anything unsafe to disclose to the
  // caller - unlike `cause`, which is server-log-only, `details` crosses
  // the wire.
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: string,
    message: string,
    cause?: unknown,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "PlatformError";
    this.code = code;
    this.cause = cause;
    this.details = details;
  }
}
