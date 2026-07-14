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
// Sessions in this slice never carry a response array, a score, a
// correctness marker, or an explanation payload. Autosave (Slice 2) will
// introduce a `responses` array on this record; scoring artifacts never
// touch this collection.
//
// This type is the single source of truth for reads of
// assessmentSessions/{sessionId}. Writes use `AssessmentSessionCreationWrite`
// so that `FieldValue.serverTimestamp()` can be used at the write boundary.
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
