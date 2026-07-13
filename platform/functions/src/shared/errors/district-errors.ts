// Closed-set district-boundary error identifiers per PDR-025 §17
// (DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md §17).
//
// The identifiers below are canonical. Callables MUST use these exact names
// when refusing a district-relevant operation. No downstream callable MAY
// introduce a variant, alias, or additional identifier without a new PDR.
export const DISTRICT_ERROR_IDS = [
  "unauthenticated",
  "account-inactive",
  "role-forbidden",
  "district-unassigned",
  "district-mismatch",
  "school-district-mismatch",
  "cross-district-reference",
  "claim-stale",
  "claim-state-mismatch",
  "server-only-field",
  "transfer-not-supported",
] as const;

export type DistrictErrorId = (typeof DISTRICT_ERROR_IDS)[number];

export function isDistrictErrorId(value: unknown): value is DistrictErrorId {
  return (
    typeof value === "string" &&
    (DISTRICT_ERROR_IDS as readonly string[]).includes(value)
  );
}
