import type { Timestamp } from "firebase-admin/firestore";

export const SCHOOLS_COLLECTION = "schools";

// Canonical school record shape per Data Model §3.2.
//
// Required fields: name, shortName, timezone, createdAt.
// Optional fields: district, gradeLevels, brandingRef.
//
// This type is the single source of truth for reads of schools/{schoolId}.
// Sprint 2 introduces no writer for this collection; write shapes will be
// declared alongside the school administration architecture in a future
// sprint. No schoolDomains collection or related type is introduced.
export type SchoolRecord = {
  readonly name: string;
  readonly shortName: string;
  readonly timezone: string;
  readonly createdAt: Timestamp;
  readonly district?: string;
  readonly gradeLevels?: readonly string[];
  readonly brandingRef?: string;
};
