import type { CallableRequest } from "firebase-functions/v2/https";

import { PlatformError, schoolDocRef, userRecordDocRef } from "../../shared";

export type LmsAuthenticatedTeacher = {
  readonly uid: string;
  // Phase 8G.3: `schoolId` and `districtId` are the AUTHORITATIVE tenant
  // context resolved from canonical Firestore records (the caller's
  // `users/{uid}` record and its `schools/{schoolId}` document), never from
  // the caller's ID-token claims. Both are always present on a successful
  // return; a caller whose canonical tenant context cannot be resolved is
  // refused. LMS callables use these values for ownership checks and audit
  // attribution, so a stale token claim cannot redirect a teacher into an
  // obsolete school/district context.
  readonly schoolId: string;
  readonly districtId: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Canonical caller check for every LMS callable per PDR-019 (§3.1 of the
// architecture).
//
// Phase 8G.1 established authoritative active-status enforcement; Phase 8G.3
// extends it to authoritative TENANT context. The signed token is used only
// as a cheap early gate (a caller must at least claim the `teacher` role);
// every authorization-bearing value is then resolved from canonical records:
//
//   - active status and teacher role come from the caller's `users/{uid}`
//     record (a suspended/demoted teacher with a stale token fails closed);
//   - `schoolId` comes from that same record;
//   - `districtId` comes from the canonical `schools/{schoolId}` document.
//
// Token `schoolId`/`districtId` claims are never trusted as the source of
// truth, so a teacher carrying stale tenant claims cannot be redirected into
// an obsolete school/district context. This mirrors the authoritative
// derivation used by `requireDistrictContext` while preserving the `lms.*`
// error surface the LMS callables already expose. This remains the single
// canonical LMS actor gate; no LMS callable re-derives authorization itself.
export async function assertAuthenticatedTeacherForLms(
  request: CallableRequest<unknown>,
): Promise<LmsAuthenticatedTeacher> {
  const auth = request.auth;
  if (!auth || !isNonEmptyString(auth.uid)) {
    throw new PlatformError(
      "lms.unauthenticated",
      "An authenticated caller is required.",
    );
  }
  const token = auth.token as { readonly role?: unknown } | undefined;
  // Cheap early gate only: the token must at least claim the teacher role.
  // Authoritative role/status/tenant are resolved from canonical records
  // below and override the token in every case.
  if (!token || token.role !== "teacher") {
    throw new PlatformError(
      "lms.unauthorized",
      "Caller must be an active teacher.",
    );
  }

  // Authoritative status/role/school from the caller's canonical record. A
  // missing, unreadable, structurally malformed (authUid mismatch),
  // non-active, or non-teacher record fails closed regardless of token
  // claims.
  const userSnapshot = await userRecordDocRef(auth.uid).get();
  const record = userSnapshot.exists ? userSnapshot.data() : undefined;
  if (
    !record ||
    record.authUid !== auth.uid ||
    record.status !== "active" ||
    record.role !== "teacher" ||
    !isNonEmptyString(record.schoolId)
  ) {
    throw new PlatformError(
      "lms.unauthorized",
      "Caller must be an active teacher.",
    );
  }
  const schoolId = record.schoolId;

  // Authoritative district from the canonical school document. A missing
  // school or a school without a district is an unresolvable tenant context
  // and fails closed.
  const schoolSnapshot = await schoolDocRef(schoolId).get();
  const school = schoolSnapshot.exists
    ? (schoolSnapshot.data() as
        | (Record<string, unknown> & { districtId?: unknown })
        | undefined)
    : undefined;
  if (!school || !isNonEmptyString(school.districtId)) {
    throw new PlatformError(
      "lms.unauthorized",
      "Caller's canonical school/district context could not be resolved.",
    );
  }

  return { uid: auth.uid, schoolId, districtId: school.districtId };
}

export function requireNonEmptyString(
  value: unknown,
  code: string,
  message: string,
): string {
  if (!isNonEmptyString(value)) {
    throw new PlatformError(code, message);
  }
  return value.trim();
}
