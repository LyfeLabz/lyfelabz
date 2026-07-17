import { enrollmentDocRef, userRecordDocRef } from "../shared";

// The canonical enrollment document id is derived from (classId, studentId)
// per `enrollments-join-by-code.ts`. The pattern is duplicated here as a
// two-line pure function so this module does not transitively import the
// join-by-code callable module (which registers a Cloud Function at import
// time). The two callsites MUST stay in sync; the derivation is a stable
// internal convention.
function enrollmentIdFor(classId: string, studentId: string): string {
  return `${classId}__${studentId}`;
}

// Canonical fallback string returned by the resolver when no approved name
// source is available. PDR-028 section 9.4 requires the teacher-facing
// surface to render a plain-language "Name unavailable" affordance when the
// resolver cannot find an authorized name. This module returns the same
// literal at the API boundary so callers do not need to convert `null` into
// a client-visible label, and so no callable in the retrieval layer
// invents a second fallback policy.
export const FALLBACK_ROSTER_DISPLAY_NAME = "Name unavailable";

// Shared display-name normalizer aligned with PDR-028 section 13.1.
// Trims leading and trailing whitespace and collapses internal runs of
// whitespace to a single space. Returns null when the input is not a
// non-empty string after normalization; legitimate punctuation, diacritics,
// capitalization, and internal single spaces are preserved.
export function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length === 0 ? null : normalized;
}

// Trusted scope required to resolve a teacher-facing roster display name.
// Every caller MUST verify class ownership and district agreement BEFORE
// invoking the resolver. This module never authorizes access; it only
// consumes an already-verified scope to look up the two authorized name
// sources per PDR-028 section 9.
export type RosterDisplayNameScope = {
  readonly classId: string;
  readonly schoolId: string;
  readonly districtId: string;
};

export type ResolvedRosterDisplayName = {
  readonly studentId: string;
  readonly displayName: string;
  readonly source: "enrollmentOverride" | "userProfile" | "fallback";
};

// Load and validate the enrollment override for (classId, studentId) in
// the trusted scope. The enrollment document id is deterministic per
// `enrollmentIdFor`, so the lookup is a single point read. The read is
// scope-validated defensively: an enrollment whose ownership fields
// disagree with the trusted scope, or whose studentId or classId disagree
// with the caller-verified pair, is ignored per PDR-028 section 12.6 and
// the district-boundary contract.
async function loadEnrollmentOverride(
  scope: RosterDisplayNameScope,
  studentId: string,
): Promise<string | null> {
  const id = enrollmentIdFor(scope.classId, studentId);
  const snap = await enrollmentDocRef(id).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;
  if (data.studentId !== studentId) return null;
  if (data.classId !== scope.classId) return null;
  if (data.schoolId !== scope.schoolId) return null;
  return normalizeDisplayName(data.displayNameOverride);
}

// Load and validate the canonical user profile display name for the
// student. The user document is looked up by uid (which equals authUid per
// data model section 3.1). Cross-school user records are ignored so a
// mismatched or stale user record cannot leak a name into the teacher's
// class view. The user status field is intentionally NOT gated here: PDR-028
// section 12.5 requires historical consistency, so a withdrawn or archived
// student MUST still render under their current canonical display name.
async function loadUserProfileDisplayName(
  scope: RosterDisplayNameScope,
  studentId: string,
): Promise<string | null> {
  const snap = await userRecordDocRef(studentId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;
  if (data.authUid !== studentId) return null;
  if (data.schoolId !== undefined && data.schoolId !== scope.schoolId) {
    return null;
  }
  return normalizeDisplayName(data.displayName);
}

// Canonical roster display-name resolver per PDR-028.
//
// Precedence:
//   1. Non-blank enrollment override on the (classId, studentId)
//      enrollment that also belongs to the trusted schoolId.
//   2. Non-blank users/{studentId}.displayName, provided the user record's
//      schoolId (when present) matches the trusted schoolId.
//   3. Fixed non-empty fallback string (`FALLBACK_ROSTER_DISPLAY_NAME`).
//
// The resolver never reads:
//   - the Google profile display name,
//   - the LMS-reported name,
//   - an email address (as a fallback or otherwise),
//   - a name stored on an attempt, session, or submission document,
//   - a user record whose schoolId disagrees with the trusted schoolId.
//
// It never returns null, undefined, or the empty string. Callers get a
// stable, non-sensitive string suitable for direct render.
export async function resolveRosterDisplayName(
  scope: RosterDisplayNameScope,
  studentId: string,
): Promise<ResolvedRosterDisplayName> {
  if (
    typeof studentId !== "string" ||
    studentId.trim().length === 0 ||
    studentId !== studentId.trim()
  ) {
    return {
      studentId: typeof studentId === "string" ? studentId : "",
      displayName: FALLBACK_ROSTER_DISPLAY_NAME,
      source: "fallback",
    };
  }
  if (
    typeof scope.classId !== "string" ||
    scope.classId.length === 0 ||
    typeof scope.schoolId !== "string" ||
    scope.schoolId.length === 0 ||
    typeof scope.districtId !== "string" ||
    scope.districtId.length === 0
  ) {
    return {
      studentId,
      displayName: FALLBACK_ROSTER_DISPLAY_NAME,
      source: "fallback",
    };
  }

  const [override, profile] = await Promise.all([
    loadEnrollmentOverride(scope, studentId),
    loadUserProfileDisplayName(scope, studentId),
  ]);

  if (override !== null) {
    return { studentId, displayName: override, source: "enrollmentOverride" };
  }
  if (profile !== null) {
    return { studentId, displayName: profile, source: "userProfile" };
  }
  return {
    studentId,
    displayName: FALLBACK_ROSTER_DISPLAY_NAME,
    source: "fallback",
  };
}

// Request-local memoizing resolver factory. Every teacher retrieval callable
// that projects display names for multiple attempts by the same student
// MUST use this factory so a student's name is resolved exactly once per
// request. The factory closes over the trusted scope and a per-request
// cache keyed by studentId. Two concurrent resolutions of the same
// studentId share the same in-flight promise so no duplicate reads occur
// even when the caller does not sequence its requests.
export function createRosterDisplayNameResolver(
  scope: RosterDisplayNameScope,
): (studentId: string) => Promise<ResolvedRosterDisplayName> {
  const inflight = new Map<string, Promise<ResolvedRosterDisplayName>>();
  return (studentId: string): Promise<ResolvedRosterDisplayName> => {
    const key = typeof studentId === "string" ? studentId : "";
    const cached = inflight.get(key);
    if (cached) return cached;
    const pending = resolveRosterDisplayName(scope, studentId);
    inflight.set(key, pending);
    return pending;
  };
}
