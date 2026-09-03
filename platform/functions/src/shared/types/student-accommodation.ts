import type { FieldValue, Timestamp } from "firebase-admin/firestore";

// F5.2 Implementation Specification §3.1-§3.2 - Persistent Student
// Differentiation, Slice 1 (accommodation record + teacher operations,
// dark). This is the NEW `studentAccommodations/{studentId}` record family
// and its append-only `history/{r{configRevision}}` subcollection.
//
// LyfeLabz is not an IEP/504 case-management system. This record stores
// only platform-specific configuration required to honor a supported
// service that is administered by a teacher on behalf of an authoritative
// plan that exists outside LyfeLabz. No IEP/plan text, diagnosis,
// disability category, service-minutes, goal, or free-text field is ever
// stored here (§3.1 "Excluded fields").

export const STUDENT_ACCOMMODATIONS_COLLECTION = "studentAccommodations";
export const ACCOMMODATION_HISTORY_SUBCOLLECTION = "history";

// §3.2 - the closed V1 reading-accessibility level vocabulary. `"adapted"`
// is the only V1 member. Extending this set to a second level is a
// documented architecture decision, not a per-call choice.
export type ReadingLevel = "adapted";

export const READING_LEVELS: readonly ReadingLevel[] = ["adapted"];

// §3.1 - `readingAccessibility.level` is required if and only if `status`
// is `"active"`. Modeled as a discriminated union so the "required iff
// active" invariant is enforced by the type system rather than by a
// runtime-only check layered on top of an object with an optional field.
export type ReadingAccessibilityConfig =
  | { readonly status: "inactive" }
  | { readonly status: "active"; readonly level: ReadingLevel };

// Canonical record shape for `studentAccommodations/{studentId}` per §3.1.
// Document ID equals `studentId`. Absence of the document means "no
// accommodation = canonical experience" (§3.1, §12).
export type StudentAccommodationRecord = {
  readonly studentId: string;
  // Audit metadata only - the school of the last accepted write's
  // enrollment context. NEVER the live authorization source; every
  // server operation recomputes authorization from `classes` and
  // `enrollments` on every call (§4).
  readonly schoolId: string;
  readonly readingAccessibility: ReadingAccessibilityConfig;
  readonly configRevision: number;
  readonly createdAt: Timestamp;
  readonly createdBy: string;
  readonly updatedAt: Timestamp;
  readonly updatedBy: string;
};

// Creation-write shape for the first accepted state-changing write
// (`configRevision` 0 -> 1), applied via `Transaction.create()` so a
// concurrent first-activation race is resolved by Firestore's `ALREADY_
// EXISTS` precondition and transaction retry rather than an application
// -level check.
export type StudentAccommodationCreationWrite = {
  readonly studentId: string;
  readonly schoolId: string;
  readonly readingAccessibility: ReadingAccessibilityConfig;
  readonly configRevision: 1;
  readonly createdAt: FieldValue;
  readonly createdBy: string;
  readonly updatedAt: FieldValue;
  readonly updatedBy: string;
};

// Update-write shape for every subsequent accepted state-changing write.
// Ownership fields (`studentId`, `createdAt`, `createdBy`) are absent so a
// configuration update can never silently rewrite provenance.
export type StudentAccommodationUpdateWrite = {
  readonly readingAccessibility: ReadingAccessibilityConfig;
  readonly configRevision: number;
  readonly updatedAt: FieldValue;
  readonly updatedBy: string;
};

// §3.1 History (S1) - append-only subcollection at
// `studentAccommodations/{studentId}/history/{r{configRevision}}`. Every
// entry is server-written and immutable; nothing ever updates or deletes
// an existing entry. Deactivation is a normal accepted write and produces
// a normal history entry, never a delete.
export type AccommodationHistoryRecord = {
  readonly revision: number;
  readonly readingAccessibility: ReadingAccessibilityConfig;
  readonly setBy: string;
  readonly setAt: Timestamp;
  readonly classId: string;
  readonly idempotencyKey?: string;
};

export type AccommodationHistoryWrite = {
  readonly revision: number;
  readonly readingAccessibility: ReadingAccessibilityConfig;
  readonly setBy: string;
  readonly setAt: FieldValue;
  readonly classId: string;
  readonly idempotencyKey?: string;
};

// The deterministic history document ID for a given accepted revision,
// per §3.1's `history/{r{configRevision}}` path contract.
export function accommodationHistoryDocId(revision: number): string {
  return `r${revision}`;
}
