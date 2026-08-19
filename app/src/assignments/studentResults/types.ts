// Sprint 27 Phase 2 (Workstream A, Decision 1): client-side shapes for the
// caller-scoped `assessmentAttemptsList` read that backs the student
// My Results surface.
//
// The backend callable contract is defined at
// `platform/functions/src/assessments/assessment-attempts-list.ts`. It is
// scoped entirely by the verified caller (`where("studentId", "==", uid)`)
// and never accepts a `studentId` (or any equivalent identifier) on the
// request. This module names only the allowlisted per-attempt fields the
// My Results surface derives its summary from.
//
// Confidentiality: the callable response is the caller's own completed
// attempt history. The projection already excludes every field the
// certified data model classifies as answer-key material (`itemResults`,
// `responses`), scoring internal, teacher-only metadata, or district
// internal. This client type deliberately mirrors only the approved
// student-visible summary so the client cannot silently grow a dependency
// on data the callable does not authorize.
//
// Security seam: the student surface never imports from firebase/*
// directly. The entry point wires the real callable and tests inject an
// in-memory fake, mirroring the pattern established by
// `AssignmentsListForStudentCallable`. The class-scoped teacher read
// `assessmentAttemptsListForClass` is never reachable from this seam;
// wiring it here would expose other students' attempts and is prohibited
// (blueprint §5.4, §5.5).

export type StudentAttemptSummary = {
  readonly attemptId: string;
  readonly assignmentId: string;
  readonly attemptNumber: number;
  readonly score: number;
  readonly maxScore: number;
  readonly percentage: number;
  readonly submittedAt: number;
};

export type StudentResultsListResponse = {
  readonly attempts: ReadonlyArray<StudentAttemptSummary>;
};

// Injected callable seam. Returns the caller-scoped completed-attempt
// history. The wire sends the empty payload; caller identity is the sole
// authorization source and no identifier is sent from the browser.
export type StudentResultsListCallable =
  () => Promise<StudentResultsListResponse>;

// Canonical PDR-024l status indicators. The four keys are exhaustive.
// Labels are the accessible text the surface renders so status is never
// conveyed by color alone (PDR-024l,
// PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md §6.4).
export type StudentStatusKey =
  | "ready"
  | "improving"
  | "wellDone"
  | "perfect";

// Per-assignment aggregate derived client-side from the caller's own
// attempt list, grouped by `assignmentId`. Best score and status are pure
// functions of the caller's completed attempts (single-student
// self-aggregation; no cross-student computation, blueprint §5.2).
export type StudentResultAggregate = {
  readonly assignmentId: string;
  readonly bestScore: number;
  readonly bestMaxScore: number;
  readonly bestPercentage: number;
  readonly attemptCount: number;
  readonly status: StudentStatusKey;
  // Improve My Score is offered on every less-than-perfect best score
  // (PDR-024k). A perfect best (score === maxScore) offers no improve
  // action. The surface additionally requires a launchable target before
  // it renders the control (fail closed, blueprint §5.4).
  readonly canImprove: boolean;
};
