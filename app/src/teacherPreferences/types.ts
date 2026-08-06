// Sprint 24B Phase 2B.2 - Teacher preference types shared across the
// client bundle.
//
// The preference storage path is `users/{uid}/preferences/teacher`. The
// only preference introduced in Phase 2B.2 is `defaultGrade`, a
// convenience value used to prefill the Manual Create form. It is not a
// statement of teacher identity and never restricts individual classes.

export type TeacherDefaultGrade = "6" | "7" | "8";

export const TEACHER_DEFAULT_GRADE_VALUES: readonly TeacherDefaultGrade[] =
  Object.freeze(["6", "7", "8"]);

export const isTeacherDefaultGrade = (
  value: unknown,
): value is TeacherDefaultGrade =>
  typeof value === "string" &&
  (TEACHER_DEFAULT_GRADE_VALUES as readonly string[]).includes(value);

// Read seam consumed by Manual Create and by Settings. Returns the
// current preference value, or `null` when no preference is present or
// the persisted value is malformed. Never throws to callers.
export type ReadTeacherDefaultGrade = () => Promise<TeacherDefaultGrade | null>;

// Write seam consumed by Manual Create (best-effort update after class
// creation) and by Settings (explicit set / clear). Rejects the promise
// if the callable itself rejects; callers catch and decide whether the
// failure is surfacable.
export type UpdateTeacherDefaultGrade = (
  next: TeacherDefaultGrade | null,
) => Promise<void>;

export type TeacherPreferencesDeps = {
  readonly read: ReadTeacherDefaultGrade;
  readonly update: UpdateTeacherDefaultGrade;
};
