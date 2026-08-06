// Client-side read shape for classes/{classId}. Mirrors, but does not
// import from, the canonical ClassRecord defined in
// platform/functions/src/shared/types/class.ts. Only fields the Sprint
// 6B Classroom Workspace consumes are named here; every other field on
// the canonical record is intentionally omitted so the client cannot
// silently grow a dependency on server-managed data. See
// SPRINT_6B_SPECIFICATION.md §4.
//
// The lifecycle vocabulary matches the certified Data Model §3.3 as
// extended by Sprint 24B Phase 2B: the only lifecycle field on a class
// document is `status`, and its enumeration is `active`, `archived`, or
// `needsSetup`. The `needsSetup` arm is a short-lived pre-instruction
// state; it intentionally omits `grade`, `block`, and `joinCode` until
// the Phase 2B.3 activation callable atomically sets them. Phase 2B.1
// tolerates `needsSetup` at the parser boundary but does not render a
// setup form; see docs/platform/SPRINT_24B_PHASE_2B_READER_AUDIT.md §5.

export type ClassStatus = "active" | "archived" | "needsSetup";

type ClassSummaryCommon = {
  readonly id: string;
  readonly title: string;
  // Sprint 24B Phase 2B.8. `true` when the underlying class document
  // carries `enrollmentSource: "lms"`; `false` otherwise (including
  // when the field is absent, which the Data Model treats as manual).
  // Optional at the type level so pre-existing test fixtures compile;
  // production reads from `listClasses.toSummary` always set the field.
  // Consumer sites must treat `undefined` as `false` (not LMS-linked).
  readonly isLmsLinked?: boolean;
};

// Active and archived classes always carry grade, block, and joinCode
// on the server (see canonical `ClassRecord`); the client filter in
// `listClasses.toSummary` still guards against a malformed document and
// defensively treats block / joinCode as optional even on the ready
// arms so that a legacy pre-Sprint-4B record without those fields does
// not crash the workspace. The active and archived arms are declared
// separately so that `Extract<ClassSummary, { status: "active" }>` yields
// the active arm rather than `never` (a shared arm with
// `status: "active" | "archived"` would collapse the extract).
export type ActiveClassSummary = ClassSummaryCommon & {
  readonly status: "active";
  readonly grade: string;
  readonly joinCode?: string;
  readonly block?: string;
};

export type ArchivedClassSummary = ClassSummaryCommon & {
  readonly status: "archived";
  readonly grade: string;
  readonly joinCode?: string;
  readonly block?: string;
};

// NeedsSetup summaries intentionally omit `grade`, `block`, and
// `joinCode`. Any surface that displays a class must narrow on
// `status` before reading those fields.
export type NeedsSetupClassSummary = ClassSummaryCommon & {
  readonly status: "needsSetup";
};

export type ClassSummary =
  | ActiveClassSummary
  | ArchivedClassSummary
  | NeedsSetupClassSummary;
