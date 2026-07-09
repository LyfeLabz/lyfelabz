import type { FieldValue, Timestamp } from "firebase-admin/firestore";

export const SCHOOLS_COLLECTION = "schools";

// Canonical school record shape per Data Model §3.2.
//
// Required fields: name, shortName, timezone, createdAt.
// Optional fields: district, gradeLevels, brandingRef.
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
  readonly district?: string;
  readonly gradeLevels?: readonly string[];
  readonly brandingRef?: string;
};

// Write shape for the school-creation callable (schoolsCreate). Conforms
// to Data Model §3.2: name, shortName, and timezone are required on
// creation, createdAt is stamped by the server via
// `FieldValue.serverTimestamp()`, and district, gradeLevels, and
// brandingRef are optional. Every field is a plain scalar or readonly
// array; no FieldValue sentinel other than the createdAt server timestamp
// is permitted.
export type SchoolCreationWrite = {
  readonly name: string;
  readonly shortName: string;
  readonly timezone: string;
  readonly createdAt: FieldValue;
  readonly district?: string;
  readonly gradeLevels?: readonly string[];
  readonly brandingRef?: string;
};
