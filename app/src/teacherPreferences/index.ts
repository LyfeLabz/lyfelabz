// Grade domain re-exports. The Sprint 24B `defaultGrade` preference
// read/write seams (`createFirestoreReadTeacherDefaultGrade`,
// `createFirebaseUpdateTeacherDefaultGrade`, `ReadTeacherDefaultGrade`,
// `UpdateTeacherDefaultGrade`, `TeacherPreferencesDeps`) were removed in
// Sprint 28.6F (Blueprint §14). Only the per-class grade union remains.
export {
  isTeacherDefaultGrade,
  TEACHER_DEFAULT_GRADE_VALUES,
  type TeacherDefaultGrade,
} from "./types";
