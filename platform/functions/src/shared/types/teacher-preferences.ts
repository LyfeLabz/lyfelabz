import type { FieldValue, Timestamp } from "firebase-admin/firestore";

// Sprint 24B Phase 2B.2 - Teacher Preferences.
//
// Canonical storage path: `users/{uid}/preferences/teacher` (subdoc).
// The subdoc carries narrow, independent, per-teacher convenience
// preferences, each optional-absent and each written by its own callable:
//
//   - `defaultGrade` (Phase 2B.2): a value from the closed set
//     { "6", "7", "8" }. Explicit `null` is never persisted; absence is
//     represented by an absent document or an omitted field. Removed from
//     the client in Sprint 28.6F (Blueprint §14) - the write path
//     (`teacherPreferencesUpdate`) remains deployed but dormant; any
//     historical value is inert.
//   - `classOrder` (Sprint 30A.1 UX correction): the teacher's own
//     canonical display order for their classes, as an ordered array of
//     class ids. See the field comment below for the full contract.
//     Written by the dedicated `teacherClassOrderUpdate` callable, kept
//     separate from `teacherPreferencesUpdate` so class-id ownership
//     validation does not bloat the narrow grade-enum validator.
//   - `classColors` (Sprint 30A.1 Class Settings V1): the teacher's own
//     presentation-only color accent per class, keyed by class id. This
//     is deliberately NOT a field on the canonical `classes/{classId}`
//     record: a class may be co-taught (`coTeacherIds`), and a color
//     choice is one teacher's personal presentation preference, not a
//     fact about the class itself - exactly the same reasoning that
//     already keeps `classOrder` off the class record. Written by the
//     dedicated `teacherClassColorUpdate` callable for the same
//     validator-isolation reason as `classOrder`.
//
// Neither preference is a statement of teacher identity, and neither
// restricts or duplicates data owned by an individual class record. See
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

// Sprint 30A.1 Class Settings V1 - closed class-color token vocabulary.
// A curated LyfeLabz palette, not a free-form hex picker: only these
// tokens are ever accepted at the write boundary, so the client can never
// persist an arbitrary CSS string. Mirrored (not imported) on the client
// at app/src/classes/classColor.ts, the same pattern already used for
// `TeacherDefaultGrade`.
export type ClassColorToken =
  | "blue"
  | "teal"
  | "green"
  | "purple"
  | "orange"
  | "rose"
  | "slate";

export const CLASS_COLOR_TOKENS: readonly ClassColorToken[] = Object.freeze([
  "blue",
  "teal",
  "green",
  "purple",
  "orange",
  "rose",
  "slate",
]);

export function isClassColorToken(value: unknown): value is ClassColorToken {
  return (
    typeof value === "string" &&
    (CLASS_COLOR_TOKENS as readonly string[]).includes(value)
  );
}

// Read shape of `users/{uid}/preferences/teacher`. Every field is optional
// to keep the reader tolerant of an absent doc, an absent field, or a
// partially-populated legacy record. `updatedAt` is stamped by whichever
// callable last wrote the document.
export type TeacherPreferencesDoc = {
  readonly defaultGrade?: TeacherDefaultGrade;
  // Sprint 30A.1 UX correction. The teacher's own canonical display order
  // for their classes, as an ordered array of class ids (most-preferred
  // first). Absent means the teacher has never saved a custom order - a
  // reader falls back to its own deterministic ordering algorithm in that
  // case; this record never stores a computed fallback. A class id
  // present in this array that no longer corresponds to an existing
  // teacher-owned class (deleted/archived-and-filtered/reassigned) is
  // simply ignored by every reader; a class id absent from this array
  // (never ordered, or created after the teacher last saved an order) is
  // appended after the ordered ids, in the same deterministic fallback
  // order, by every reader - never inserted into the middle of the saved
  // order. This array is the single source of truth for BOTH the Classes
  // workspace and the Assign dialog's class list; neither surface keeps
  // an independent ordering preference.
  readonly classOrder?: readonly string[];
  // Sprint 30A.1 Class Settings V1. Presentation-only per-class color
  // accent, keyed by class id. Absent means "no explicit color" - readers
  // must render the neutral default, never invent a color. A class id
  // present here that no longer corresponds to an existing teacher-owned
  // class is simply inert (ignored by every reader), mirroring
  // `classOrder`'s own tolerance for stale ids.
  readonly classColors?: Readonly<Record<string, ClassColorToken>>;
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

// Write shape for the canonical class-order callable
// (`teacherClassOrderUpdate`, Sprint 30A.1 UX correction). Narrow by
// design: only `classOrder` and `updatedAt` are writable through this
// path, so this write can never touch `defaultGrade`.
export type TeacherClassOrderSetWrite = {
  readonly classOrder: readonly string[];
  readonly updatedAt: FieldValue;
};

// Write shape for the class-color callable (`teacherClassColorUpdate`,
// Sprint 30A.1 Class Settings V1). Narrow by design: only `classColors`
// and `updatedAt` are writable through this path, mirroring
// `TeacherClassOrderSetWrite`. Unlike `classOrder` (an array, which
// Firestore treats as an atomic value under `{merge: true}`),
// `classColors` is a nested map, so this write always names exactly ONE
// class id key - Firestore's documented nested-object merge behavior
// under `{merge: true}` adds/overwrites that one key (a `ClassColorToken`
// value) or removes it (a `FieldValue.delete()` sentinel, to clear a
// color back to "none") while leaving every other class id's stored
// color untouched. The callable never reads the existing map first; it
// relies on this per-key merge semantics rather than a read-modify-write
// round trip, so two concurrent color updates for two different classes
// can never clobber each other.
export type TeacherClassColorSetWrite = {
  readonly classColors: Readonly<Record<string, ClassColorToken | FieldValue>>;
  readonly updatedAt: FieldValue;
};

export type TeacherPreferencesUpdateWrite =
  | TeacherPreferencesSetWrite
  | TeacherPreferencesClearWrite
  | TeacherClassOrderSetWrite
  | TeacherClassColorSetWrite;
