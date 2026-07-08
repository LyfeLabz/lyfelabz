import { PlatformError } from "../errors/platform-error";
import type { Role, UserStatus } from "../types/user";
import { getAdminAuth } from "./admin";

// Canonical custom claims shape per Cloud Function Charter §2.
//
// Claims carry authorization data only. Lifecycle state remains on the
// users/{uid} document (see PLATFORM_STATE_MACHINE.md §1). Claims are
// written only when the user's status has transitioned to `active`; the
// absence of claims is the canonical signal that the user has no active
// authorization.
//
// `districtId` is a documented reserved slot in the charter for the
// PDR-015 district expansion path and is intentionally not part of this
// type. When it is added, it will be added here first and then wired
// through every writer in a single sprint.
export type CanonicalCustomClaims = {
  readonly role: Role;
  readonly schoolId: string;
};

export type WriteCustomClaimsInput = {
  readonly uid: string;
  readonly status: UserStatus;
  readonly role: Role;
  readonly schoolId: string;
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
//   setCustomUserClaims contains exactly `role` and `schoolId`, so any
//   prior claim fields (including the reserved `districtId` slot before
//   it is implemented) are erased on write.
// - input validation: uid, role, and schoolId are non-empty; role is a
//   value from the canonical Role union.
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

  const claims: CanonicalCustomClaims = {
    role: input.role,
    schoolId: input.schoolId,
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
