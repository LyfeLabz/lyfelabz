import type { FieldValue, Timestamp } from "firebase-admin/firestore";

export const ASSIGNMENTS_COLLECTION = "assignments";

// Canonical assignment lifecycle field per Data Model §3.6. `status` is the
// only lifecycle field on an assignment document and never coexists with any
// second lifecycle field, consistent with the platform-wide "status is the
// only lifecycle field" invariant established for users in Sprint 2 and
// preserved through Sprint 4C. The enumeration follows §3.6 exactly:
// `draft` on creation, `published` after the teacher publishes the
// assignment to enrolled students, `closed` after the window closes or the
// teacher closes the assignment, and `archived` as the terminal state that
// removes the record from active teacher views while preserving history so
// past submissions remain resolvable. No additional lifecycle values are
// introduced without a documented architecture amendment.
export type AssignmentStatus = "draft" | "published" | "closed" | "archived";

// Canonical assignment mode per Data Model §3.6 and Cloud Function Charter
// §2.5. LyfeLabz has two runtime modes: Practice Mode (client-only, no
// persistence) and Classroom Mode (server-finalized, persisted). The word
// "graded" is deliberately not used at any layer per PDR-010; a
// `classroom`-mode assignment is not a "graded assignment," it is a
// Classroom Mode surface.
export type AssignmentMode = "practice" | "classroom";

// Canonical assignment record shape per Data Model §3.6.
//
// Required fields: classId, teacherId, schoolId, lessonSlug, lessonVersion,
// mode, status, createdAt.
// Optional fields: title, instructions, windowClosesAt, availableAt.
//
// `teacherId` and `schoolId` are denormalized from the referenced class per
// §3.6 and §4.6, justified because every security rule and administrative
// query for assignments must resolve ownership on the document itself
// without a second read. Immutable ownership per §1.2: classId, teacherId,
// schoolId, and createdAt are set at creation and never change. `lessonSlug`
// and `lessonVersion` are frozen at creation per §12.4 to protect students
// from mid-window content changes.
//
// This type is the single source of truth for reads of
// assignments/{assignmentId}. Write shapes are declared separately so that
// FieldValue sentinels can be used at the write boundary.
export type AssignmentRecord = {
  readonly classId: string;
  readonly teacherId: string;
  readonly schoolId: string;
  readonly lessonSlug: string;
  readonly lessonVersion: string;
  readonly mode: AssignmentMode;
  readonly status: AssignmentStatus;
  readonly createdAt: Timestamp;
  readonly title?: string;
  readonly instructions?: string;
  readonly windowClosesAt?: Timestamp;
  readonly availableAt?: Timestamp;
};

// Write shape for the draft-creation callable (assignmentsCreateDraft).
// Conforms to Data Model §3.6: classId, teacherId, schoolId, lessonSlug,
// lessonVersion, mode, and status are required on creation; createdAt is
// stamped by the server via `FieldValue.serverTimestamp()`. The initial
// status is always `draft` at creation per §3.6; other lifecycle values are
// reached only through `assignmentsPublish`, `assignmentsClose`, or
// `assignmentsArchive`. `windowClosesAt` and `availableAt` are written as
// Timestamps if supplied by the caller; the shared writer path preserves
// them exactly.
export type AssignmentCreationWrite = {
  readonly classId: string;
  readonly teacherId: string;
  readonly schoolId: string;
  readonly lessonSlug: string;
  readonly lessonVersion: string;
  readonly mode: AssignmentMode;
  readonly status: "draft";
  readonly createdAt: FieldValue;
  readonly title?: string;
  readonly instructions?: string;
  readonly windowClosesAt?: Timestamp;
  readonly availableAt?: Timestamp;
};

// Write shape for the draft-update callable (assignmentsUpdateDraft).
// Only the teacher-editable metadata fields (`title`, `instructions`,
// `lessonSlug`, `lessonVersion`, `mode`, `windowClosesAt`, `availableAt`)
// are writable through this path per Data Model §3.6 and §7.6. Ownership
// fields (`classId`, `teacherId`, `schoolId`), `status`, and `createdAt`
// are intentionally absent so that no draft update can silently reassign
// ownership or drive the lifecycle field. Every field is optional so a
// caller may update only the subset that changed.
export type AssignmentDraftUpdateWrite = {
  readonly title?: string;
  readonly instructions?: string;
  readonly lessonSlug?: string;
  readonly lessonVersion?: string;
  readonly mode?: AssignmentMode;
  readonly windowClosesAt?: Timestamp;
  readonly availableAt?: Timestamp;
};

// Write shape for the publish callable (assignmentsPublish). Conforms to
// Data Model §3.6 lifecycle: `status` advances from `draft` to `published`
// and no other field is modified. The write is intentionally narrow so the
// publish path cannot be laundered into a metadata edit or an ownership
// change.
export type AssignmentPublishWrite = {
  readonly status: "published";
};

// Write shape for the close callable (assignmentsClose). Conforms to Data
// Model §3.6 lifecycle: `status` advances from `published` to `closed` and
// no other field is modified.
export type AssignmentCloseWrite = {
  readonly status: "closed";
};

// Write shape for the archive callable (assignmentsArchive). Conforms to
// Data Model §3.6 lifecycle: `status` advances to the terminal `archived`
// state and no other field is modified.
export type AssignmentArchiveWrite = {
  readonly status: "archived";
};
