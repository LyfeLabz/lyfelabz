// enrollments/ domain entry point.

export {
  enrollmentsJoinByCode,
  type EnrollmentsJoinByCodeRequest,
  type EnrollmentsJoinByCodeResponse,
} from "./enrollments-join-by-code";
export {
  enrollmentsSetStatus,
  type EnrollmentsSetStatusRequest,
  type EnrollmentsSetStatusResponse,
} from "./enrollments-set-status";
export {
  enrollmentsTeacherAdd,
  type EnrollmentsTeacherAddRequest,
  type EnrollmentsTeacherAddResponse,
} from "./enrollments-teacher-add";
export {
  createRosterDisplayNameResolver,
  FALLBACK_ROSTER_DISPLAY_NAME,
  normalizeDisplayName,
  resolveRosterDisplayName,
  type ResolvedRosterDisplayName,
  type RosterDisplayNameScope,
} from "./resolve-roster-display-name";
