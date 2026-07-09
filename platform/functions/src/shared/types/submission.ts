import type { FieldValue, Timestamp } from "firebase-admin/firestore";

import type { AssignmentMode } from "./assignment";

export const SUBMISSIONS_COLLECTION = "submissions";

// Canonical submission lifecycle field per Data Model §3.7. `status` is the
// only lifecycle field on a submission document and never coexists with any
// second lifecycle field, consistent with the platform-wide "status is the
// only lifecycle field" invariant established for users in Sprint 2 and
// preserved through Sprint 4D. The enumeration follows §3.7 exactly:
// `submitted` at creation time (the transient state between the create and
// finalize callables in the Sprint 5A foundation), and `finalized` after
// the server records the immutable final result. No additional lifecycle
// values are introduced without a documented architecture amendment.
export type SubmissionStatus = "submitted" | "finalized";

// Per-question response inline on the submission document per Data Model
// §3.7. The `questionId` names the question the student answered, and
// `response` carries the student's answer as a small structured object.
// Long-form responses that would grow past the Firestore document size
// limit are the documented reason to move responses to the
// `submissions/{submissionId}/responses` subcollection per §2.10. Sprint 5A
// keeps responses inline.
export type SubmissionResponse = {
  readonly questionId: string;
  readonly response: unknown;
};

// Canonical submission record shape per Data Model §3.7.
//
// Required fields: assignmentId, studentId, classId, teacherId, schoolId,
// lessonSlug, lessonVersion, mode, status, startedAt, responses.
// Conditionally required: submittedAt and score are present when status is
// `finalized` and absent when status is `submitted`.
// Optional: durationMs, attemptCount.
//
// Every denormalized field (classId, teacherId, schoolId, lessonSlug,
// lessonVersion, mode) is copied from the referenced assignment record at
// creation and is immutable thereafter per §12.3 and §1.2. Freezing the
// lesson version on the submission preserves scientific accuracy claims
// per §12.4 even if the assignment record is theoretically recreated.
//
// This type is the single source of truth for reads of
// submissions/{submissionId}. Write shapes are declared separately so that
// FieldValue sentinels can be used at the write boundary.
export type SubmissionRecord = {
  readonly assignmentId: string;
  readonly studentId: string;
  readonly classId: string;
  readonly teacherId: string;
  readonly schoolId: string;
  readonly lessonSlug: string;
  readonly lessonVersion: string;
  readonly mode: AssignmentMode;
  readonly status: SubmissionStatus;
  readonly startedAt: Timestamp;
  readonly responses: readonly SubmissionResponse[];
  readonly submittedAt?: Timestamp;
  readonly score?: number;
  readonly durationMs?: number;
  readonly attemptCount?: number;
};

// Write shape for the create callable (submissionsCreate). Conforms to Data
// Model §3.7: every required field is present, `startedAt` is stamped by
// the server via `FieldValue.serverTimestamp()`, and the initial status is
// always `submitted`. Ownership fields are server-derived: `studentId` is
// the caller's uid; `classId`, `teacherId`, `schoolId`, `lessonSlug`,
// `lessonVersion`, and `mode` are denormalized from the referenced
// assignment record; no ownership field is client-supplied.
export type SubmissionCreationWrite = {
  readonly assignmentId: string;
  readonly studentId: string;
  readonly classId: string;
  readonly teacherId: string;
  readonly schoolId: string;
  readonly lessonSlug: string;
  readonly lessonVersion: string;
  readonly mode: AssignmentMode;
  readonly status: "submitted";
  readonly startedAt: FieldValue;
  readonly responses: readonly SubmissionResponse[];
};

// Write shape for the finalize callable (submissionsFinalize). Advances
// the `status` field from `submitted` to `finalized` and stamps
// `submittedAt` via `FieldValue.serverTimestamp()`. Ownership fields,
// `startedAt`, `assignmentId`, `studentId`, `lessonSlug`, and
// `lessonVersion` are intentionally absent from the write shape so no
// finalization can silently reassign ownership, backdate the start
// moment, or edit the frozen lesson version. `responses` and the
// analytics fields `score`, `durationMs`, and `attemptCount` may be
// supplied by the finalizer.
export type SubmissionFinalizationWrite = {
  readonly status: "finalized";
  readonly submittedAt: FieldValue;
  readonly responses?: readonly SubmissionResponse[];
  readonly score?: number;
  readonly durationMs?: number;
  readonly attemptCount?: number;
};
