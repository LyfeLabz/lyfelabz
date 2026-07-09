import type { CanonicalClaims, Role, UserRecordRead } from "./types";

const ROLE_VALUES: readonly Role[] = [
  "teacher",
  "student",
  "platformAdministrator",
];

// Reads only role and schoolId from raw claims. Non-canonical role values
// are treated as absent (Step 3 spec §16 "Unsupported role in claims").
// Non-string schoolId values are treated as absent.
export function extractCanonicalClaims(
  claims: Readonly<Record<string, unknown>>,
): CanonicalClaims {
  const result: { role?: Role; schoolId?: string } = {};
  const role = claims.role;
  if (typeof role === "string" && ROLE_VALUES.includes(role as Role)) {
    result.role = role as Role;
  }
  const schoolId = claims.schoolId;
  if (typeof schoolId === "string" && schoolId.length > 0) {
    result.schoolId = schoolId;
  }
  return result;
}

// Consistency verdict for a caller whose Firestore record is `active`.
// The bootstrap uses this to decide whether to render the active shell
// or refuse it. See Step 3 spec §8.
export type ActiveConsistencyVerdict = "match" | "mismatch";

export function checkActiveConsistency(
  record: UserRecordRead,
  claims: CanonicalClaims,
): ActiveConsistencyVerdict {
  if (record.status !== "active") return "mismatch";
  if (!record.role || !record.schoolId) return "mismatch";
  if (claims.role !== record.role) return "mismatch";
  if (claims.schoolId !== record.schoolId) return "mismatch";
  return "match";
}

// "Token ahead of record" refusal condition (Step 3 spec §8). When the
// record still says pendingVerification but claims already assert a
// teacher role, the record wins and the shell is refused.
export function isTokenAheadOfRecord(
  record: UserRecordRead,
  claims: CanonicalClaims,
): boolean {
  return record.status === "pendingVerification" && claims.role === "teacher";
}
