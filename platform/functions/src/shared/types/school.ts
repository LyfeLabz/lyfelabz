import type { FieldValue, Timestamp } from "firebase-admin/firestore";

export const SCHOOLS_COLLECTION = "schools";

// Canonical school record shape per Data Model §3.2.
//
// Required fields: name, shortName, timezone, createdAt.
// Optional fields: districtId, gradeLevels, brandingRef.
//
// Sprint 29G.5C: `districtId` is the canonical district field read by
// `requireDistrictContext`, `teachersApproveVerification`, and the
// onboarding activation paths. The pre-29G.5C `schoolsCreate` writer used
// the legacy `district` field name; `district` is retained here as an
// optional read-compat field so documents that predate the fix-forward
// still type against `SchoolRecord`, but new schools are written with
// `districtId`. No migration of existing documents is performed.
//
// This type is the single source of truth for reads of schools/{schoolId}.
// Write shapes are declared separately so that FieldValue sentinels can be
// used at the write boundary. No schoolDomains collection or related type
// is introduced.
export type SchoolRecord = {
  readonly name: string;
  readonly shortName: string;
  readonly timezone: string;
  readonly createdAt: Timestamp;
  readonly districtId?: string;
  // Legacy pre-29G.5C district field, retained for read-compat only.
  readonly district?: string;
  readonly gradeLevels?: readonly string[];
  readonly brandingRef?: string;
};

// Write shape for the school-creation callable (schoolsCreate). Conforms
// to Data Model §3.2: name, shortName, and timezone are required on
// creation, createdAt is stamped by the server via
// `FieldValue.serverTimestamp()`, and districtId, gradeLevels, and
// brandingRef are optional. Every field is a plain scalar or readonly
// array; no FieldValue sentinel other than the createdAt server timestamp
// is permitted.
export type SchoolCreationWrite = {
  readonly name: string;
  readonly shortName: string;
  readonly timezone: string;
  readonly createdAt: FieldValue;
  // Sprint 29G.5C fix-forward: newly created schools persist the canonical
  // `districtId` (read by the shared district-context helper and the
  // onboarding/approval paths), replacing the legacy `district` field the
  // pre-29G.5C writer used.
  readonly districtId?: string;
  readonly gradeLevels?: readonly string[];
  readonly brandingRef?: string;
};
