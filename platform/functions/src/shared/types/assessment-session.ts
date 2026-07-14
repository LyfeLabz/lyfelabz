import type { FieldValue, Timestamp } from "firebase-admin/firestore";

export const ASSESSMENT_SESSIONS_COLLECTION = "assessmentSessions";

// Canonical assessment-session lifecycle field per
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §6 (PDR-026). This slice implements
// only the `live` state. The transient `submitted` state exists exclusively
// inside the future `assessmentAttemptsFinalize` transaction and is never
// persisted on the readable collection. The `archived` state and the
// scheduled sweep that produces it are deferred to a later Sprint 11C
// slice; the enumeration is declared here so downstream slices extend
// this union in one place rather than reintroducing a competing name.
export type AssessmentSessionStatus = "live" | "archived";

// Per-item autosave response inline on the session document per
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §6. `itemId` names the assessment
// item the student answered and `response` carries the student's current
// answer as an opaque structured value the scorer will interpret at
// finalize time against the paired answer key (§8, §15). Sessions never
// carry a score, correctness marker, points-earned value, or explanation
// payload on any response element; the scorer produces all such artifacts
// and writes them only to `attempts/{attemptId}` (§7).
export type AssessmentSessionResponse = {
  readonly itemId: string;
  readonly response: unknown;
};

// Canonical assessment-session record shape per
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §6, §11, and §13.
//
// Ownership fields (`studentId`, `assignmentId`, `classId`, `teacherId`,
// `schoolId`, `districtId`, `activityId`, `assessmentId`,
// `assessmentRevisionId`) are frozen at session creation per §6 invariants
// and are never rewritten by autosave, sweep, recover, or finalize.
// `activityId`, `assessmentId`, and `assessmentRevisionId` are denormalized
// from the referenced assignment record at session creation so the scorer
// in a future slice can resolve the paired answer key without a second
// assignment read.
//
// `responses` and `lastActivityAt` are the only mutable fields on a Live
// session per §14 and are introduced by the Slice 2 autosave callable
// (`assessmentSessionsAutosave`). They are absent from a session that has
// been created but never autosaved (Slice 1 wrote only the creation
// document). Scoring artifacts (score, item-level correctness, points
// earned, explanations) never touch this collection.
//
// This type is the single source of truth for reads of
// assessmentSessions/{sessionId}. Writes use `AssessmentSessionCreationWrite`
// (creation) or `AssessmentSessionAutosaveWrite` (autosave) so that
// `FieldValue.serverTimestamp()` can be used at the write boundary.
export type AssessmentSessionRecord = {
  readonly studentId: string;
  readonly assignmentId: string;
  readonly classId: string;
  readonly teacherId: string;
  readonly schoolId: string;
  readonly districtId: string;
  readonly activityId: string;
  readonly assessmentId: string;
  readonly assessmentRevisionId: string;
  readonly sessionOrdinal: number;
  readonly status: AssessmentSessionStatus;
  readonly startedAt: Timestamp;
  readonly responses?: readonly AssessmentSessionResponse[];
  readonly lastActivityAt?: Timestamp;
};

// Write shape for the assessment-session creation callable
// (assessmentSessionsBegin). Conforms to
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §6, §11, §12: all ownership fields
// are set at creation; `status` is always `live` at creation; `startedAt`
// is stamped by the server via `FieldValue.serverTimestamp()`; no other
// lifecycle value is reachable through this write path.
export type AssessmentSessionCreationWrite = {
  readonly studentId: string;
  readonly assignmentId: string;
  readonly classId: string;
  readonly teacherId: string;
  readonly schoolId: string;
  readonly districtId: string;
  readonly activityId: string;
  readonly assessmentId: string;
  readonly assessmentRevisionId: string;
  readonly sessionOrdinal: number;
  readonly status: "live";
  readonly startedAt: FieldValue;
};

// Autosave-write shape for the assessment-session update callable
// (assessmentSessionsAutosave). Conforms to
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §6 and §14: only the
// student-authored `responses` array and the server-stamped
// `lastActivityAt` timing marker are ever mutated by autosave. Ownership
// fields, `sessionOrdinal`, `status`, and `startedAt` are intentionally
// absent from the write shape so no autosave can silently reassign
// ownership, advance the lifecycle, backdate the start moment, or promote
// a session that has been archived by the scheduled sweep (§10).
// Scoring artifacts (score, item-level correctness, points earned,
// explanations) are structurally impossible to write through this shape;
// the scorer produces those artifacts and writes them only to
// `attempts/{attemptId}` per §7.
export type AssessmentSessionAutosaveWrite = {
  readonly responses: readonly AssessmentSessionResponse[];
  readonly lastActivityAt: FieldValue;
};
