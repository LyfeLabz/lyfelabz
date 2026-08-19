// Sprint 27 Phase 4 (blueprint Decision 4): client-side shapes for the
// Google Classroom assignment-aware deep link `/app/a/{assignmentId}`.
//
// Confidentiality: the resolution payload is caller-scoped and minimal
// (PDR-027 §10.2). It never carries a classmate identifier, a Classroom
// coursework identifier, a Google account, a teacher identity, a session or
// attempt id, a score, or answer-key material. The client uses it only to
// route the arriving student into the existing assignment-aware runtime.

// Where the client routes after a successful server resolution. The value is
// computed server-side by `lmsDeepLinkResolve`; the client only dispatches.
export type DeepLinkInternalTarget =
  | "assignmentLaunch"
  | "lessonPractice"
  | "informational";

export type DeepLinkAttemptContext = "authorized" | "informational";

// The successfully parsed resolution payload.
export type DeepLinkResolution = {
  readonly assignmentId: string;
  readonly classId: string;
  readonly lessonSlug: string;
  readonly internalTarget: DeepLinkInternalTarget;
  readonly attemptContext: DeepLinkAttemptContext;
};

// Injected callable seam. The arrival surface never imports firebase/*
// directly; the entry point wires the real `lmsDeepLinkResolve` callable and
// tests inject an in-memory fake. Mirrors the pattern established by
// `AssignmentsListForStudentCallable` and `StudentResultsListCallable`.
export type DeepLinkResolveCallable = (input: {
  readonly assignmentId: string;
}) => Promise<DeepLinkResolution>;
