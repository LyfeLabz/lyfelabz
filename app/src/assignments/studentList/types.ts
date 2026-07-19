// Sprint 17 Slice 4: client-side shapes for the certified
// `assignmentsListForStudent` callable.
//
// The callable contract is established by Slice 2 and lives at
// `platform/functions/src/assignments/assignments-list-for-student.ts`.
// This module names only the allowlisted per-item fields the active
// student surface and the launcher require. Every other field on the
// persisted record is intentionally excluded so the client cannot
// silently grow a dependency on data the callable does not authorize.
//
// Confidentiality: the callable response is student-owned, published-
// only assignment metadata. It never carries teacher-only fields,
// recipient documents, sessions, attempts, answers, scores, or any
// identifier that is not the assignmentId of an assignment the caller
// is authorized to work on.

export type AssignmentsListForStudentItem = {
  readonly assignmentId: string;
  readonly lessonSlug: string;
  readonly title: string;
  readonly status: "published";
  readonly publishedAt: number | null;
};

export type AssignmentsListForStudentResponse = {
  readonly items: ReadonlyArray<AssignmentsListForStudentItem>;
};

// Injected callable seam. The reusable active-student surface never
// imports from firebase/* directly; the entry point wires the real
// callable and tests inject an in-memory fake. Mirrors the pattern
// established by AssignmentSummaryCallable and AssignmentsCallables.
export type AssignmentsListForStudentCallable =
  () => Promise<AssignmentsListForStudentResponse>;
