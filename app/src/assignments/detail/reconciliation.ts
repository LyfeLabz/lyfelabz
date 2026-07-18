import type { AssignmentSummary } from "../summary/types";

// Sprint 16 Slice 3: pure count-reconciliation helper for the Assignment
// Detail surface. The authoritative aggregate remains
// `assessmentAssignmentSummary`; the roster remains the authoritative
// per-student view. When the two disagree during normal operation the
// surface renders a calm, factual note beneath the roster rather than
// silently rewriting either dataset.
//
// This module has no callable dependency, no DOM dependency, and no
// firebase dependency so it is straightforwardly unit-testable.

export type ReconciliationInput = {
  readonly summary: AssignmentSummary;
  readonly recipientsCount: number;
  readonly submittedCount: number;
  readonly inProgressCount: number;
};

export type ReconciliationResult =
  | { readonly kind: "aligned" }
  | { readonly kind: "empty" }
  | { readonly kind: "recipientTotalMismatch" }
  | { readonly kind: "submittedMismatch" }
  | { readonly kind: "startedMismatch" }
  | { readonly kind: "unavailable" };

// Copy is preserved verbatim in the Sprint 16 plan Slice 3.2. Any
// change must be made intentionally there first.
export const DISCREPANCY_NOTE_COPY =
  "Roster and summary are temporarily out of sync. The latest details will appear after refresh.";

export function reconcileCounts(
  input: ReconciliationInput | null,
): ReconciliationResult {
  if (input === null) return { kind: "unavailable" };
  const { summary, recipientsCount, submittedCount, inProgressCount } = input;
  if (summary.totalStudents === 0 && recipientsCount === 0) {
    return { kind: "empty" };
  }
  if (recipientsCount !== summary.totalStudents) {
    return { kind: "recipientTotalMismatch" };
  }
  if (submittedCount !== summary.completedStudents) {
    return { kind: "submittedMismatch" };
  }
  const startedFromRoster = submittedCount + inProgressCount;
  const startedFromSummary =
    summary.completedStudents + summary.inProgressStudents;
  if (startedFromRoster !== startedFromSummary) {
    return { kind: "startedMismatch" };
  }
  return { kind: "aligned" };
}

export function shouldDisplayDiscrepancyNote(
  result: ReconciliationResult,
): boolean {
  return (
    result.kind === "recipientTotalMismatch" ||
    result.kind === "submittedMismatch" ||
    result.kind === "startedMismatch"
  );
}
