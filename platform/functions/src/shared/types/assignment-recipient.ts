import type { FieldValue, Timestamp } from "firebase-admin/firestore";

export const ASSIGNMENT_RECIPIENTS_SUBCOLLECTION = "recipients";

// Canonical assignment-recipient status per PDR-029h. Recipient records are
// append-only membership records; the only defined status in Sprint 12E
// Slice 2A is `assigned`. Additional values would only be introduced by a
// documented recipient-invalidation or recipient-restoration architecture
// decision.
export type AssignmentRecipientStatus = "assigned";

// Canonical assignment-recipient source per PDR-029h.
//
// `classPublication` is stamped on every recipient created by the initial
// snapshot written during first assignment publication.
// `manualAddition` is stamped on every recipient created explicitly by an
// owning teacher through `assignmentsRecipientAdd` on an already-published
// assignment, naming exactly one student.
// `teacherReconcile` (Student Progress & Assignment Membership, Phase B
// Core Slice 2) is stamped on every recipient created through
// `assignmentsRecipientsReconcile` - the intent-based "bring this
// assignment's recipients up to date with the class's current active
// enrollment" callable. It is deliberately distinct from
// `manualAddition`: a reconcile call names no student at all (the server
// derives the eligible population from active enrollment), so a recipient
// stamped `teacherReconcile` must never be described to a teacher, in an
// audit event, or in a log line as "the teacher selected this specific
// student" - that claim is only ever true of `manualAddition`.
//
// `lateJoinReconciliation` (Student Progress & Assignment Membership,
// Phase B Core, Automatic Enrollment Reconciliation slice) is stamped on
// every recipient created automatically by
// `reconcileRecipientsForNewEnrollment` immediately after one of the
// enrollment-creation pathways (`enrollmentsJoinByCode`,
// `enrollmentsTeacherAdd`, `materializeLmsEnrollmentsFromMembership`)
// establishes a genuinely new active enrollment. Like `teacherReconcile`,
// it names no single student-selection gesture; unlike `teacherReconcile`,
// no teacher action triggered it at all - the triggering actor is the
// enrollment event itself, not a teacher click. This is Layer 1
// (enrollment-time promptness) only; the later Layer 2 convergence
// guarantee inside `assessmentSessionsBegin` is a separate, not-yet-built
// slice and may or may not introduce its own distinct source value when
// it lands - that decision is deferred to that slice.
//
// `lmsImport` is enumerated in PDR-029h but is intentionally not accepted by
// any Cloud Function in Sprint 12E Slice 2A. It is reserved for a future
// slice that authorizes an LMS-side recipient writer with its own audit
// event; adding it to the union today would allow no writer to stamp it.
export type AssignmentRecipientSource =
  | "classPublication"
  | "manualAddition"
  | "teacherReconcile"
  | "lateJoinReconciliation";

// Canonical assignment-recipient record shape per PDR-029h.
//
// The document identifier is the canonical `studentId`, which guarantees
// exactly one recipient record per (assignmentId, studentId) pair without a
// query. Ownership fields are frozen at write time from the trusted parent
// assignment and its trusted parent class. No display name, email, LMS
// profile field, assessment content, or answer-key material is ever stored
// on a recipient record.
//
// This type is the single source of truth for reads of
// `assignments/{assignmentId}/recipients/{studentId}`. Write shapes are
// declared separately so `FieldValue.serverTimestamp()` can be used at the
// write boundary.
export type AssignmentRecipientRecord = {
  readonly assignmentId: string;
  readonly studentId: string;
  readonly classId: string;
  readonly teacherId: string;
  readonly schoolId: string;
  readonly districtId: string;
  readonly assignedAt: Timestamp;
  readonly assignedBy: string;
  readonly source: AssignmentRecipientSource;
  readonly status: AssignmentRecipientStatus;
};

// Write shape for assignment-recipient creation. Identical to the record
// shape except `assignedAt` is a `FieldValue` so the server timestamp
// sentinel can be used at the write boundary. Every field is required so
// that no recipient can be written with a partial ownership snapshot.
export type AssignmentRecipientCreationWrite = {
  readonly assignmentId: string;
  readonly studentId: string;
  readonly classId: string;
  readonly teacherId: string;
  readonly schoolId: string;
  readonly districtId: string;
  readonly assignedAt: FieldValue;
  readonly assignedBy: string;
  readonly source: AssignmentRecipientSource;
  readonly status: AssignmentRecipientStatus;
};
