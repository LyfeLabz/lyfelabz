import type { CallableRequest } from "firebase-functions/v2/https";

import type { DistrictErrorId } from "../errors/district-errors";
import { PlatformError } from "../errors/platform-error";
import { schoolDocRef, userRecordDocRef } from "../firestore/typed-ref";
import type { Role } from "../types/user";

// The verified district context returned to callables that require the
// caller to be an active member of a specific district. Every field is a
// non-empty string derived from the canonical Firestore records and cross
// checked against the caller's signed claims per PDR-025 §5-§6 and §15.
export type DistrictContext = {
  readonly uid: string;
  readonly role: Role;
  readonly schoolId: string;
  readonly districtId: string;
};

// The claim slice this helper trusts on the request. The shape reflects
// exactly the fields PDR-025 §6 permits on a canonical claim.
export type DistrictClaimToken = {
  readonly role?: unknown;
  readonly schoolId?: unknown;
  readonly districtId?: unknown;
};

function throwDistrictError(
  code: DistrictErrorId,
  message: string,
): never {
  throw new PlatformError(code, message);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const VALID_ROLES: readonly Role[] = [
  "teacher",
  "student",
  "platformAdministrator",
];

function isValidRole(value: unknown): value is Role {
  return (
    typeof value === "string" && (VALID_ROLES as readonly string[]).includes(value)
  );
}

// Shared authorization helper per PDR-025 §11-§12, §15 and the Sprint 11A
// implementation inventory (Slice 1).
//
// Responsibilities are narrowly scoped:
//   1. Verify the caller is authenticated.
//   2. Read `users/{uid}` and refuse a non-`active` account with
//      `account-inactive`.
//   3. Determine the caller's active school from the canonical record.
//   4. Read `schools/{schoolId}` and resolve `districtId`, refusing an
//      unassigned school with `district-unassigned`.
//   5. Compare the resolved district and role against the caller's signed
//      claim and refuse a mismatch with the identifiers required by
//      PDR-025 §15 (`claim-stale`, `claim-state-mismatch`,
//      `district-mismatch`).
//   6. Return the verified `{ uid, role, schoolId, districtId }` context.
//
// The helper never mutates state, never emits audit events, and never
// re-issues claims. Callables that need claim reissuance MUST perform
// that step through the canonical `writeCustomClaims` helper after
// obtaining this context.
export async function requireDistrictContext(
  request: CallableRequest<unknown>,
): Promise<DistrictContext> {
  const auth = request.auth;
  if (!auth || !isNonEmptyString(auth.uid)) {
    throwDistrictError(
      "unauthenticated",
      "An authenticated caller is required.",
    );
  }

  const uid = auth.uid;
  const token = (auth.token ?? {}) as DistrictClaimToken;

  const userSnapshot = await userRecordDocRef(uid).get();
  if (!userSnapshot.exists) {
    throwDistrictError(
      "account-inactive",
      "The authenticated caller has no canonical user record.",
    );
  }
  const user = userSnapshot.data();
  if (!user) {
    throwDistrictError(
      "account-inactive",
      "The authenticated caller has no readable user record.",
    );
  }

  if (user.status !== "active") {
    throwDistrictError(
      "account-inactive",
      "The authenticated caller is not in the active status required for district-scoped operations.",
    );
  }
  if (!isValidRole(user.role)) {
    throwDistrictError(
      "claim-state-mismatch",
      "The canonical user record has no valid role for district-scoped operations.",
    );
  }
  if (!isNonEmptyString(user.schoolId)) {
    throwDistrictError(
      "claim-state-mismatch",
      "The canonical user record has no active school for district-scoped operations.",
    );
  }

  const recordRole: Role = user.role;
  const recordSchoolId: string = user.schoolId;

  const schoolSnapshot = await schoolDocRef(recordSchoolId).get();
  if (!schoolSnapshot.exists) {
    throwDistrictError(
      "school-district-mismatch",
      "The caller's active school could not be resolved.",
    );
  }
  const school = schoolSnapshot.data() as
    | (Record<string, unknown> & { districtId?: unknown })
    | undefined;
  if (!school) {
    throwDistrictError(
      "school-district-mismatch",
      "The caller's active school record was unreadable.",
    );
  }
  const resolvedDistrictId = school.districtId;
  if (!isNonEmptyString(resolvedDistrictId)) {
    throwDistrictError(
      "district-unassigned",
      "The caller's active school is not assigned to a district.",
    );
  }

  if (!isNonEmptyString(token.districtId)) {
    throwDistrictError(
      "claim-stale",
      "The caller's token is missing a districtId claim.",
    );
  }
  if (!isValidRole(token.role)) {
    throwDistrictError(
      "claim-stale",
      "The caller's token is missing a role claim.",
    );
  }
  if (!isNonEmptyString(token.schoolId)) {
    throwDistrictError(
      "claim-stale",
      "The caller's token is missing a schoolId claim.",
    );
  }

  if (token.role !== recordRole) {
    throwDistrictError(
      "claim-state-mismatch",
      "The caller's token role disagrees with the canonical user record.",
    );
  }
  if (token.schoolId !== recordSchoolId) {
    throwDistrictError(
      "claim-state-mismatch",
      "The caller's token schoolId disagrees with the canonical user record.",
    );
  }
  if (token.districtId !== resolvedDistrictId) {
    throwDistrictError(
      "district-mismatch",
      "The caller's token districtId disagrees with the resolved school district.",
    );
  }

  return {
    uid,
    role: recordRole,
    schoolId: recordSchoolId,
    districtId: resolvedDistrictId,
  };
}
