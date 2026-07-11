import type { CallableRequest } from "firebase-functions/v2/https";

import { PlatformError } from "../../shared";

export type LmsAuthenticatedTeacher = {
  readonly uid: string;
  readonly schoolId: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Canonical caller check for every LMS callable per PDR-019 (§3.1 of the
// architecture). Every LMS callable operates only for a teacher whose
// canonical custom claims (`{ role: "teacher", schoolId }`) are present;
// account-lifecycle state (`active`) is enforced upstream by the claims
// writer per the certified PLATFORM_STATE_MACHINE.md. This helper is the
// single canonical gate. No LMS callable ever re-derives claims itself.
export function assertAuthenticatedTeacherForLms(
  request: CallableRequest<unknown>,
): LmsAuthenticatedTeacher {
  const auth = request.auth;
  if (!auth || !isNonEmptyString(auth.uid)) {
    throw new PlatformError(
      "lms.unauthenticated",
      "An authenticated caller is required.",
    );
  }
  const token = auth.token as
    | { readonly role?: unknown; readonly schoolId?: unknown }
    | undefined;
  if (!token || token.role !== "teacher") {
    throw new PlatformError(
      "lms.unauthorized",
      "Caller must be an active teacher.",
    );
  }
  if (!isNonEmptyString(token.schoolId)) {
    throw new PlatformError(
      "lms.unauthorized",
      "Caller is missing a canonical schoolId claim.",
    );
  }
  return { uid: auth.uid, schoolId: token.schoolId };
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
