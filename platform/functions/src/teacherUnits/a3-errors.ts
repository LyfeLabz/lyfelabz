/** Stable A3 error definitions. Since A3-3, the shared HTTPS translator
 * (`shared/errors/https-callable.ts`) maps each code exactly as declared here;
 * a parity test in `https-callable.test.ts` guards drift. */
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
