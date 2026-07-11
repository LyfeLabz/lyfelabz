// Canonical deterministic document identifiers for the LMS mirror. The
// identifiers are derived from ownership-immutable components so callable
// idempotency is guaranteed without a secondary index (Data Model §12).
//
// Every identifier is URL-safe, opaque to clients, and stable across
// callable replays.

function hashComponent(value: string): string {
  // A small, dependency-free stable hash. Not cryptographic; used only to
  // produce a short deterministic identifier fragment from a value that
  // may contain characters outside the URL-safe alphabet.
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function safeToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

// One document per (teacher, provider) pair per Data Model §2.9.a. The
// pair is order-preserving and immutable per PDR-005, so the document ID
// can be derived without a lookup.
export function lmsConnectionIdFor(
  teacherId: string,
  providerId: string,
): string {
  return `${safeToken(providerId)}__${teacherId}`;
}

// One document per (LyfeLabz class, LMS class) pair per Data Model
// §2.9.a. Both components are immutable at the mirror boundary, so the
// document ID is deterministic.
export function lmsClassLinkIdFor(
  classId: string,
  providerId: string,
  lmsClassId: string,
): string {
  return `${classId}__${safeToken(providerId)}__${hashComponent(lmsClassId)}`;
}

// One document per publication attempt per Data Model §2.9.a. The
// (assignment, provider, attempt) triple is not idempotent because
// re-attempts are recorded as new documents to preserve the audit trail
// per Amendment §3.4 ("mirror records are subordinate to the certified
// records they mirror"). The nonce is supplied by the callable so
// callable replays with the same request payload produce the same
// document ID for a single attempt.
export function lmsAssignmentPublicationIdFor(
  assignmentId: string,
  providerId: string,
  attemptNonce: string,
): string {
  return `${assignmentId}__${safeToken(providerId)}__${hashComponent(attemptNonce)}`;
}
