import type { FieldValue, Timestamp } from "firebase-admin/firestore";

// Sprint 24B Phase 2B.2 - Teacher Preferences.
//
// Canonical storage path: `users/{uid}/preferences/teacher` (subdoc).
// The subdoc carries a single narrow convenience preference in Phase 2B.2:
// `defaultGrade`, an optional-absent value from the closed set
// { "6", "7", "8" }. Explicit `null` is never persisted; absence of the
// preference is represented by either an absent document or a document
// with `defaultGrade` omitted.
//
// This preference is a per-teacher convenience value, not a statement of
// teacher identity and not a restriction on individual classes. See
// docs/platform/ADR_TEACHER_DEFAULT_CLASS_METADATA.md and
// docs/platform/SPRINT_24B_PHASE_2B_IMPLEMENTATION_SPECIFICATION.md §9.

export const USERS_COLLECTION_FOR_PREFS = "users";
export const TEACHER_PREFERENCES_SUBCOLLECTION = "preferences";
export const TEACHER_PREFERENCES_DOC_ID = "teacher";

// Closed set of grade tokens Phase 2B.2 accepts. If future phases widen
// the platform's supported grade band, add the new arm here and in the
// callable's validator table together.
export type TeacherDefaultGrade = "6" | "7" | "8";

export const TEACHER_DEFAULT_GRADE_VALUES: readonly TeacherDefaultGrade[] =
  Object.freeze(["6", "7", "8"]);

export function isTeacherDefaultGrade(
  value: unknown,
): value is TeacherDefaultGrade {
  return (
    typeof value === "string" &&
    (TEACHER_DEFAULT_GRADE_VALUES as readonly string[]).includes(value)
  );
}

// Read shape of `users/{uid}/preferences/teacher`. Both fields are
// optional to keep the reader tolerant of an absent doc, an absent
// `defaultGrade`, or a partially-populated legacy record. `updatedAt` is
// stamped by the callable on every successful write.
export type TeacherPreferencesDoc = {
  readonly defaultGrade?: TeacherDefaultGrade;
  readonly updatedAt?: Timestamp;
};

// Write shape when `defaultGrade` is being set to a concrete value. The
// callable stamps `updatedAt` with `FieldValue.serverTimestamp()`.
export type TeacherPreferencesSetWrite = {
  readonly defaultGrade: TeacherDefaultGrade;
  readonly updatedAt: FieldValue;
};

// Write shape when `defaultGrade` is being cleared. The callable uses
// `FieldValue.delete()` so no `null` value is ever persisted.
export type TeacherPreferencesClearWrite = {
  readonly defaultGrade: FieldValue;
  readonly updatedAt: FieldValue;
};

export type TeacherPreferencesUpdateWrite =
  | TeacherPreferencesSetWrite
  | TeacherPreferencesClearWrite;
