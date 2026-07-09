// Client-side read shape for classes/{classId}. Mirrors, but does not
// import from, the canonical ClassRecord defined in
// platform/functions/src/shared/types/class.ts. Only fields the Sprint
// 6B Classroom Workspace consumes are named here; every other field on
// the canonical record is intentionally omitted so the client cannot
// silently grow a dependency on server-managed data. See
// SPRINT_6B_SPECIFICATION.md §4.
//
// The lifecycle vocabulary matches the certified Data Model §3.3: the
// only lifecycle field on a class document is `status`, and its
// enumeration in Sprint 4B remains `active` and `archived`.

export type ClassStatus = "active" | "archived";

export type ClassSummary = {
  readonly id: string;
  readonly title: string;
  readonly grade: string;
  readonly status: ClassStatus;
};
