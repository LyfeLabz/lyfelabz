// Grade domain shared across the client bundle.
//
// History: Sprint 24B Phase 2B.2 introduced a global teacher
// `defaultGrade` convenience preference (stored at
// `users/{uid}/preferences/teacher`) used to prefill class creation.
// Sprint 28.6F removed that preference from the v1 product (Blueprint
// §14): grade/block belongs to the CLASS, not the teacher, and every
// class now derives its grade from its own create/setup flow. The
// preference read/write seams and their client wiring were removed; the
// backend `teacherPreferencesUpdate` callable is left deployed but
// dormant, and any historical `defaultGrade` documents remain inert (no
// migration).
//
// What survives here is only the closed grade set itself, which is the
// per-class grade domain. It is reused by the class create form, the
// imported-class setup form, and the `classesActivate` client seam
// (`activateClass.ts`). The name is retained to avoid a wide,
// out-of-scope rename across those certified call sites; it names the
// grade union `"6" | "7" | "8"`, not a teacher-level default.

export type TeacherDefaultGrade = "6" | "7" | "8";

export const TEACHER_DEFAULT_GRADE_VALUES: readonly TeacherDefaultGrade[] =
  Object.freeze(["6", "7", "8"]);

export const isTeacherDefaultGrade = (
  value: unknown,
): value is TeacherDefaultGrade =>
  typeof value === "string" &&
  (TEACHER_DEFAULT_GRADE_VALUES as readonly string[]).includes(value);
