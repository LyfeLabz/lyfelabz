// Client-side shapes for the Sprint 13A Teacher Assignment Summary
// card. These mirror the certified `assessmentAssignmentSummary`
// callable response allowlist recorded in
// docs/platform/SPRINT_12E_SLICE_1_COMPLETION_REPORT.md section 15 and
// preserved through Sprint 12E Slice 2C. Only the fields the summary
// card renders are named; every other server-managed field is
// intentionally omitted so the client cannot silently grow a dependency
// on data the callable does not authorize.
//
// The confidentiality boundary certified by Sprint 12E is aggregate
// only. The callable never returns student ids, student names, attempt
// ids, session ids, raw scores, item results, answers, ownership
// fields, or audit metadata; this module names none of those either
// (see SPRINT_12E_SLICE_1_COMPLETION_REPORT.md section 16 and the card
// confidentiality test in card.test.ts).

export type AssignmentSummary = {
  readonly assignmentId: string;
  readonly classId: string;
  readonly totalStudents: number;
  readonly completedStudents: number;
  readonly inProgressStudents: number;
  readonly notStartedStudents: number;
  readonly completionPercentage: number;
  readonly averagePercentage: number | null;
  readonly highestPercentage: number | null;
  readonly lowestPercentage: number | null;
  readonly perfectScoreStudents: number;
};

// Injected callable seam. The reusable summary card never imports from
// firebase/* directly; the entry point wires the real callable and
// tests inject an in-memory fake. Mirrors the pattern established by
// AssignmentsCallables in src/settings/integrations/types.ts.
export type AssignmentSummaryCallable = (input: {
  readonly assignmentId: string;
}) => Promise<AssignmentSummary>;
