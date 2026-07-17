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
// assignment.
//
// `lmsImport` is enumerated in PDR-029h but is intentionally not accepted by
// any Cloud Function in Sprint 12E Slice 2A. It is reserved for a future
// slice that authorizes an LMS-side recipient writer with its own audit
// event; adding it to the union today would allow no writer to stamp it.
export type AssignmentRecipientSource = "classPublication" | "manualAddition";

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
