import { PlatformError } from "../errors/platform-error";
import type { Role, UserStatus } from "../types/user";
import { getAdminAuth } from "./admin";

// Canonical custom claims shape per PDR-025 §6 and Cloud Function Charter §2.
//
// Claims carry authorization data only. Lifecycle state remains on the
// users/{uid} document (see PLATFORM_STATE_MACHINE.md §1). Claims are
// written only when the user's status has transitioned to `active`; the
// absence of claims is the canonical signal that the user has no active
// authorization.
//
// PDR-025 §6 ratifies the three-field canonical shape
// `{ role, schoolId, districtId }` with every value a non-empty string.
// The writer input surface mirrors the canonical shape exactly: the
// TypeScript contract and the runtime contract agree.
export type CanonicalCustomClaims = {
  readonly role: Role;
  readonly schoolId: string;
  readonly districtId: string;
};

export type WriteCustomClaimsInput = {
  readonly uid: string;
  readonly status: UserStatus;
  readonly role: Role;
  readonly schoolId: string;
  readonly districtId: string;
};

const VALID_ROLES: readonly Role[] = [
  "teacher",
  "student",
  "platformAdministrator",
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidRole(value: unknown): value is Role {
  return (
    typeof value === "string" && (VALID_ROLES as readonly string[]).includes(value)
  );
}

// The single canonical path for writing custom claims in the platform.
//
// Every callable and trigger that grants authorization to a user routes
// through this helper. No second write path exists. The helper enforces:
//
// - the active-only invariant: claims are written only when status is
//   `active`. Any other status is rejected as `claims.notActive`.
// - the canonical shape invariant: the object passed to
//   setCustomUserClaims contains exactly `role`, `schoolId`, and
//   `districtId`, per PDR-025 §6. Any prior extraneous claim fields are
//   erased on write because the admin SDK replaces the claim payload
//   atomically.
// - input validation: uid, role, schoolId, and districtId are non-empty;
//   role is a value from the canonical Role union.
//
// The helper returns the exact object written, so callers can log it
// deterministically without re-deriving the shape.
export async function writeCustomClaims(
  input: WriteCustomClaimsInput,
): Promise<CanonicalCustomClaims> {
  if (!isNonEmptyString(input.uid)) {
    throw new PlatformError("claims.invalidUid", "uid must be a non-empty string.");
  }
  if (input.status !== "active") {
    throw new PlatformError(
      "claims.notActive",
      `Custom claims are only written when status is "active" (received "${input.status}").`,
    );
  }
  if (!isValidRole(input.role)) {
    throw new PlatformError(
      "claims.invalidRole",
      `role must be one of: ${VALID_ROLES.join(", ")}.`,
    );
  }
  if (!isNonEmptyString(input.schoolId)) {
    throw new PlatformError(
      "claims.invalidSchoolId",
      "schoolId must be a non-empty string.",
    );
  }
  if (!isNonEmptyString(input.districtId)) {
    throw new PlatformError(
      "claims.invalidDistrictId",
      "districtId must be a non-empty string.",
    );
  }

  const claims: CanonicalCustomClaims = {
    role: input.role,
    schoolId: input.schoolId,
    districtId: input.districtId,
  };

  try {
    await getAdminAuth().setCustomUserClaims(input.uid, claims);
  } catch (err) {
    throw new PlatformError(
      "claims.writeFailed",
      "Failed to write custom claims.",
      err,
    );
  }

  return claims;
}
