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

// F5.2 §7.1 - the server-selected differentiated presentation for one launch.
// The server (Op C, Slice 4) is the sole authority for whether a presentation
// applies, which pair, and the exact opaque revision `path`. The client mirrors
// the field names verbatim and never derives, decodes, or reconstructs any of
// them. `variantKey`/`presentationRevisionId` are transported only so the shape
// matches the server response; the client routes on `path` alone and never
// renders or decodes the `variantKey` (§7.3, Opaque path requirement).
export type LaunchPresentation = {
  readonly variantKey: string;
  readonly presentationRevisionId: string;
  readonly path: string;
};

export type AssignmentsListForStudentItem = {
  readonly assignmentId: string;
  readonly lessonSlug: string;
  readonly title: string;
  readonly status: "published";
  readonly publishedAt: number | null;
  // F5.2 §7.1 additive, optional differentiation fields (Slice 4 server / Slice
  // 5 client). Present ONLY for an accommodated student:
  //   - `presentation` iff the server minted a `differentiated` grant for this
  //     item; the client routes to `presentation.path` (§7.3).
  //   - `launchRef` iff any grant was minted (`differentiated` or
  //     `canonicalFallback`); the client transports it opaquely to
  //     `assessmentSessionsBegin` and never decodes or derives it.
  // Both are entirely absent for canonical-expected students, so a canonical
  // launch is byte-shape-identical to pre-feature behavior. The student never
  // asserts either field; server responses are authoritative.
  readonly presentation?: LaunchPresentation;
  readonly launchRef?: string;
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
