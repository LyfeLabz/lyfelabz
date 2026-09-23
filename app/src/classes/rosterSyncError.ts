// Client error vocabulary for Google Classroom roster operations
// (`lmsClassesSyncRoster`, `lmsClassesRefreshRoster`). Firebase-free so shell
// surfaces can classify a failure without importing a callable wrapper.
// Each kind maps a stable set of server PlatformError codes to recovery
// guidance; callers must not switch on the raw server code.

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

export function classifyRosterSyncError(err: unknown): SyncRosterError {
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
