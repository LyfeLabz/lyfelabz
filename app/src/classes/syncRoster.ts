import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

// Sprint 24B Phase 2B.8: client wrapper for the certified
// `lmsClassesSyncRoster` callable. This module lives outside
// `src/shell/**` so the shell "no firebase imports" invariant is
// preserved. See
// platform/functions/src/lms/classes-sync-roster.ts for the canonical
// server contract:
//
//   - Request: `{ classId }` only. The provider identifier, upstream
//     `lmsClassId`, connection identifier, and every OAuth credential
//     are derived server-side. A client can never inject them.
//   - Response: deterministic reconciliation counters only. No student
//     identifier, email, provider account id, or token ever appears.
//   - Server writes exactly one `lms.rosterSynchronized` audit event per
//     completed reconciliation.
//
// The wrapper is intentionally thin. It preserves the server error code
// so the shell can map platform error codes to teacher-facing UX copy
// (reconnect vs retry vs unavailable).

export type SyncRosterInput = {
  readonly classId: string;
};

// Canonical roster-sync counters returned by the server. Every value is
// a non-negative integer. `upstreamRosterEmpty` is a defensive signal
// the server sets when the upstream provider returned zero students so
// the client can distinguish "no students in the upstream course" from
// "no local enrollment changes."
export type SyncRosterCounters = {
  readonly added: number;
  readonly reactivated: number;
  readonly unchanged: number;
  readonly withdrawn: number;
  readonly unresolved: number;
  readonly skipped: number;
  readonly upstreamRosterEmpty: boolean;
};

export type SyncRosterResult = SyncRosterCounters & {
  readonly classId: string;
};

// Client-facing error kinds. Each maps to a stable set of server
// PlatformError codes. The shell uses the kind to pick recovery copy;
// callers must not switch on the raw server code.
export type SyncRosterErrorKind =
  | "reconnectRequired" // OAuth expired, revoked, or connection inactive
  | "linkBroken"        // upstream course no longer exists or link is missing
  | "classNotActive"    // race with archive or activation drift
  | "transient"         // upstream 5xx / network / retryable
  | "unknown";

export class SyncRosterError extends Error {
  readonly kind: SyncRosterErrorKind;
  readonly serverCode: string | null;
  constructor(kind: SyncRosterErrorKind, serverCode: string | null, message: string) {
    super(message);
    this.name = "SyncRosterError";
    this.kind = kind;
    this.serverCode = serverCode;
  }
}

export type SyncRoster = (input: SyncRosterInput) => Promise<SyncRosterResult>;

// Server response shape as received on the wire. Every field is typed
// `unknown` at the boundary so the wrapper can validate the shape
// defensively without trusting the server's TS declaration.
type LmsClassesSyncRosterResponse = {
  readonly classId?: unknown;
  readonly added?: unknown;
  readonly reactivated?: unknown;
  readonly unchanged?: unknown;
  readonly withdrawn?: unknown;
  readonly unresolved?: unknown;
  readonly skipped?: unknown;
  readonly upstreamRosterEmpty?: unknown;
};

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

// Extract the server's platform code from the callable error. Firebase
// Functions wraps the throw as `HttpsError` with `details: { code }`;
// the shell's `extractErrorCode` follows the same pattern for
// `classesActivate` (see app/src/shell/surfaces/classes.ts).
function extractServerCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const details = (err as { details?: unknown }).details;
  if (details && typeof details === "object" && "code" in details) {
    const dc = (details as { code?: unknown }).code;
    if (typeof dc === "string") return dc;
  }
  const c = (err as { code?: unknown }).code;
  return typeof c === "string" ? c : null;
}

function classifyError(err: unknown): SyncRosterError {
  const serverCode = extractServerCode(err);
  // Reconnect required: OAuth expired, revoked, or connection is not
  // active in Firestore.
  if (
    serverCode === "lms.upstreamAuthorizationFailed" ||
    serverCode === "lms.connectionNotActive" ||
    serverCode === "lms.connectionMismatch"
  ) {
    return new SyncRosterError(
      "reconnectRequired",
      serverCode,
      "Google Classroom authorization has expired or been revoked.",
    );
  }
  // Broken link: upstream course was deleted or the LyfeLabz link
  // record is missing / broken.
  if (
    serverCode === "lms.upstreamResourceNotFound" ||
    serverCode === "lms.classNotLinked" ||
    serverCode === "lms.linkBroken"
  ) {
    return new SyncRosterError(
      "linkBroken",
      serverCode,
      "The Google Classroom course for this class could not be reached.",
    );
  }
  // Class not active (race with archive or an unexpected lifecycle
  // state). Rare but distinct from a transient failure.
  if (serverCode === "lms.classNotActive") {
    return new SyncRosterError(
      "classNotActive",
      serverCode,
      "This class is no longer active.",
    );
  }
  // Firebase callable network-layer code, when the transport layer
  // produced the failure rather than a server-thrown PlatformError.
  const fbCode =
    err && typeof err === "object" && "code" in err && typeof (err as { code?: unknown }).code === "string"
      ? (err as { code: string }).code
      : null;
  // Transient / retryable.
  if (
    serverCode === "lms.upstreamCallFailed" ||
    serverCode === "lms.upstreamTemporarilyUnavailable" ||
    serverCode === "lms.upstreamMalformedResponse" ||
    fbCode === "unavailable" ||
    fbCode === "deadline-exceeded"
  ) {
    return new SyncRosterError(
      "transient",
      serverCode,
      "We could not reach Google Classroom just now.",
    );
  }
  // Fallthrough: unknown.
  return new SyncRosterError(
    "unknown",
    serverCode,
    "Roster synchronization failed.",
  );
}

function validateCounters(
  data: LmsClassesSyncRosterResponse,
): SyncRosterCounters {
  const counters = {
    added: isNonNegativeInt(data.added) ? data.added : 0,
    reactivated: isNonNegativeInt(data.reactivated) ? data.reactivated : 0,
    unchanged: isNonNegativeInt(data.unchanged) ? data.unchanged : 0,
    withdrawn: isNonNegativeInt(data.withdrawn) ? data.withdrawn : 0,
    unresolved: isNonNegativeInt(data.unresolved) ? data.unresolved : 0,
    skipped: isNonNegativeInt(data.skipped) ? data.skipped : 0,
    upstreamRosterEmpty: data.upstreamRosterEmpty === true,
  };
  return Object.freeze(counters);
}

export function createFirebaseSyncRoster(functions: Functions): SyncRoster {
  const callable = httpsCallable<
    { classId: string },
    LmsClassesSyncRosterResponse
  >(functions, "lmsClassesSyncRoster");
  return async (input) => {
    let data: LmsClassesSyncRosterResponse;
    try {
      const res = await callable({ classId: input.classId });
      data = res.data;
    } catch (err) {
      throw classifyError(err);
    }
    const returnedId =
      typeof data?.classId === "string" && data.classId.length > 0
        ? data.classId
        : input.classId;
    const counters = validateCounters(data);
    return Object.freeze({
      classId: returnedId,
      ...counters,
    });
  };
}
