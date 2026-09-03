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

// F5.2 §7.1 - the server-selected differentiated presentation, mirrored verbatim.
// Present only when the resolver (Op C, Slice 4) minted a `differentiated` grant
// on a launch target. The client routes on `path` alone; it never decodes the
// `variantKey` or derives any field.
export type DeepLinkPresentation = {
  readonly variantKey: string;
  readonly presentationRevisionId: string;
  readonly path: string;
};

// The successfully parsed resolution payload.
export type DeepLinkResolution = {
  readonly assignmentId: string;
  readonly classId: string;
  readonly lessonSlug: string;
  readonly internalTarget: DeepLinkInternalTarget;
  readonly attemptContext: DeepLinkAttemptContext;
  // F5.2 §7.1 additive, optional differentiation fields (Slice 4 server / Slice
  // 5 client), present only for an accommodated launch target:
  //   - `presentation` iff a `differentiated` grant was minted;
  //   - `launchRef` iff any grant was minted (`differentiated`/`canonicalFallback`).
  // Both entirely absent for canonical-expected students. The student never
  // asserts either field (server FORBIDDEN_REQUEST_KEYS); server responses are
  // authoritative and the client only routes/transports.
  readonly presentation?: DeepLinkPresentation;
  readonly launchRef?: string;
};

// Injected callable seam. The arrival surface never imports firebase/*
// directly; the entry point wires the real `lmsDeepLinkResolve` callable and
// tests inject an in-memory fake. Mirrors the pattern established by
// `AssignmentsListForStudentCallable` and `StudentResultsListCallable`.
export type DeepLinkResolveCallable = (input: {
  readonly assignmentId: string;
}) => Promise<DeepLinkResolution>;
