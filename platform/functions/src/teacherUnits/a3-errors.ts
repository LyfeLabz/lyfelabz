/** Stable definitions only; not connected to existing error mappings. */
export const A3_ERRORS = Object.freeze({
  "teacherUnits.availabilityClosed": "failed-precondition",
  "teacherUnits.policyMissing": "failed-precondition",
  "teacherUnits.policyInvalid": "failed-precondition",
  "teacherUnits.policyUnavailable": "unavailable",
  "teacherUnits.deploymentIneligible": "failed-precondition",
  "teacherUnits.runtimeIdentityUnavailable": "unavailable",
  "teacherUnits.compatibilityRequired": "failed-precondition",
  "teacherUnits.invalidCompatibility": "invalid-argument",
  "teacherUnits.contractUnsupported": "failed-precondition",
  "teacherUnits.policyChanged": "failed-precondition",
  "teacherUnits.placementMismatch": "failed-precondition",
  "teacherUnits.responseUnavailable": "unavailable",
} as const);
export type A3ErrorCode = keyof typeof A3_ERRORS;
