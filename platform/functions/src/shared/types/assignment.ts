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
// persistence) and Classroom Mode (server-finalized, persisted).
//
// PDR-010 amendment (Sprint 30A.1): PDR-010's original blanket prohibition
// on the word "graded" is narrowed, not repealed. Sprint 30A authorizes
// "Graded"/"Ungraded" strictly as teacher-facing Classroom grading
// terminology, carried exclusively by `ClassroomGradingConfig` below. The
// invariant PDR-010 actually protects remains fully intact: `mode` itself
// never takes a "graded" value, and `mode: "classroom"` still means only
// "this assignment is a server-finalized, persisted Classroom Mode
// surface" - it does not mean, and must never be read to mean, "this
// assignment is graded." A `classroom`-mode assignment may be Graded or
// Ungraded; a `practice`-mode assignment carries no grading configuration
// at all (Practice Mode never publishes to Classroom).
export type AssignmentMode = "practice" | "classroom";

// Sprint 30A.1 - Classroom grading configuration. Orthogonal to `mode`:
// `mode: "classroom"` describes the delivery/surface (server-finalized,
// persisted) and never implies grading by itself. This type is the sole
// carrier of the teacher's Graded/Ungraded choice and, when graded, the
// Classroom maximum point value. The discriminated union makes an invalid
// combination ("ungraded" carrying `maxPoints`, or "graded" missing/with a
// non-positive-integer `maxPoints`) unrepresentable in the type system; the
// callable boundary additionally rejects a malformed payload shape at
// runtime (JS/Firestore do not enforce TS types), so no invalid state can
// reach either layer.
export type ClassroomGradingConfig =
  | {
      readonly mode: "graded";
      readonly maxPoints: number;
    }
  | {
      readonly mode: "ungraded";
    };

// Canonical assignment record shape per Data Model §3.6.
//
// Required fields: classId, teacherId, schoolId, lessonSlug, mode, status,
// createdAt.
// Conditionally required: assessmentRevisionId is stamped on the first
// draft -> published transition and is present on every non-draft record.
// Optional fields: title, instructions, windowClosesAt, availableAt.
//
// `teacherId` and `schoolId` are denormalized from the referenced class per
// §3.6 and §4.6, justified because every security rule and administrative
// query for assignments must resolve ownership on the document itself
// without a second read. Immutable ownership per §1.2: classId, teacherId,
// schoolId, and createdAt are set at creation and never change. `lessonSlug`
// is frozen at creation per §12.4 to protect students from mid-window
// content changes. `assessmentRevisionId` is the immutable grading contract
// per ASSESSMENT_SCORING_CONTRACT.md §12.1 and is stamped once at
// publication from the currently deployed revision of the referenced
// assessment; every downstream session and attempt scores against that
// exact revision.
//
// This type is the single source of truth for reads of
// assignments/{assignmentId}. Write shapes are declared separately so that
// FieldValue sentinels can be used at the write boundary.
export type AssignmentRecord = {
  readonly classId: string;
  readonly teacherId: string;
  readonly schoolId: string;
  readonly lessonSlug: string;
  readonly mode: AssignmentMode;
  readonly status: AssignmentStatus;
  readonly createdAt: Timestamp;
  readonly assessmentRevisionId?: string;
  readonly title?: string;
  readonly instructions?: string;
  readonly windowClosesAt?: Timestamp;
  readonly availableAt?: Timestamp;
  // Additive optional field reserved by the ratified LMS integration
  // architecture (Amendment §3.4). Set by the assignment-publish callable
  // to the identifier of the most recent successful publication record in
  // `lmsAssignmentPublications`; absent when no publication has ever
  // succeeded for the assignment. The field is a mirror pointer only and
  // does not confer authority on the LMS-side record (PDR-019d).
  readonly lmsPublicationRef?: string;
  // Sprint 15 Slice 2: additive optional publication timestamp. Written
  // exactly once by `assignmentsPublish` on the first `draft` ->
  // `published` transition and preserved across `close` and `reopen`
  // transitions (both narrow lifecycle writes intentionally exclude
  // `publishedAt`). Absent on assignments never published (drafts).
  readonly publishedAt?: Timestamp;
  // Sprint 30A.1 - additive optional Classroom grading configuration.
  // Absent means: legacy assignment predating this field, or an assignment
  // created by a client that never supplied a choice. Absence MUST behave
  // as ungraded for every Classroom publication/passback purpose - no
  // inferred maxPoints, no migration, no backfill. Writable only through
  // `assignmentsCreateDraft` (at creation) and `assignmentsUpdateDraft`
  // (while still `draft`); both callables already refuse to write to a
  // non-draft record, so this field is structurally frozen from the moment
  // the assignment leaves `draft` - before any Classroom coursework can
  // exist for it (LMS publication is a later, separate step). No new
  // freeze mechanism is required beyond that existing status gate.
  readonly classroomGrading?: ClassroomGradingConfig;
  // Sprint 30A.3 - additive optional teacher-selected Classroom due date,
  // stored in the SAME canonical form the Classroom path has always used:
  // an ISO calendar date "YYYY-MM-DD" (the value of the Assign dialog's
  // date input), never a Timestamp, so no timezone interpretation is added
  // (the Google Classroom adapter converts it directly to Classroom's
  // {year, month, day}). Absent means no due date: legacy assignments need
  // no migration or backfill, and none is ever inferred. Written only by
  // `assignmentsCreateDraft`; `lmsAssignmentsPublish` reads it from this
  // record for every publication attempt (initial and retry), so it is
  // durable assignment configuration rather than request state.
  readonly dueDate?: string;
};

// Write shape for the draft-creation callable (assignmentsCreateDraft).
// Conforms to Data Model §3.6: classId, teacherId, schoolId, lessonSlug,
// mode and status are required on creation; createdAt is stamped by the
// server via `FieldValue.serverTimestamp()`. The initial status is always
// `draft` at creation per §3.6; other lifecycle values are reached only
// through `assignmentsPublish`, `assignmentsClose`, or
// `assignmentsArchive`. `assessmentRevisionId` is not written at draft
// creation; it is stamped later by `assignmentsPublish` from the currently
// deployed revision of the referenced assessment.  `windowClosesAt` and
// `availableAt` are written as Timestamps if supplied by the caller; the
// shared writer path preserves them exactly.
export type AssignmentCreationWrite = {
  readonly classId: string;
  readonly teacherId: string;
  readonly schoolId: string;
  readonly lessonSlug: string;
  readonly mode: AssignmentMode;
  readonly status: "draft";
  readonly createdAt: FieldValue;
  readonly title?: string;
  readonly instructions?: string;
  readonly windowClosesAt?: Timestamp;
  readonly availableAt?: Timestamp;
  // Sprint 30A.1 - see the field comment on `AssignmentRecord.classroomGrading`.
  readonly classroomGrading?: ClassroomGradingConfig;
  // See the field comment on `AssignmentRecord.dueDate`.
  readonly dueDate?: string;
};

// Write shape for the draft-update callable (assignmentsUpdateDraft).
// Only the teacher-editable metadata fields (`title`, `instructions`,
// `lessonSlug`, `mode`, `windowClosesAt`, `availableAt`) are writable
// through this path per Data Model §3.6 and §7.6. Ownership fields
// (`classId`, `teacherId`, `schoolId`), `status`, `createdAt`, and the
// grading contract (`assessmentRevisionId`) are intentionally absent so
// that no draft update can silently reassign ownership or drive the
// lifecycle field. Every field is optional so a caller may update only the
// subset that changed.
export type AssignmentDraftUpdateWrite = {
  readonly title?: string;
  readonly instructions?: string;
  readonly lessonSlug?: string;
  readonly mode?: AssignmentMode;
  readonly windowClosesAt?: Timestamp;
  readonly availableAt?: Timestamp;
  // Sprint 30A.1 - see the field comment on `AssignmentRecord.classroomGrading`.
  // Writable here only while the record is still `draft` (the callable
  // itself enforces this per §7.6, the same gate every other field on this
  // write shape already relies on), which is what freezes the configuration
  // before any Classroom publication can occur.
  readonly classroomGrading?: ClassroomGradingConfig;
};

// Write shape for the publish callable (assignmentsPublish). Conforms to
// Data Model §3.6 lifecycle: `status` advances from `draft` to `published`
// and no other field is modified. The write is intentionally narrow so the
// publish path cannot be laundered into a metadata edit or an ownership
// change.
export type AssignmentPublishWrite = {
  readonly status: "published";
  // Sprint 15 Slice 2: additive server timestamp stamped on the first
  // `draft` -> `published` transition. Preserved through subsequent
  // close/reopen cycles because those writes intentionally exclude this
  // field. Never rewritten by the idempotent already-published path.
  readonly publishedAt: FieldValue;
  // Immutable grading contract per ASSESSMENT_SCORING_CONTRACT.md §12.1.
  // Stamped exactly once at the first `draft` -> `published` transition
  // from the currently deployed revision of the referenced assessment.
  // Every downstream session and attempt scores against this exact
  // revision. Never rewritten by close/reopen cycles or by the idempotent
  // already-published path.
  readonly assessmentRevisionId: string;
};

// Write shape for the close callable (assignmentsClose). Conforms to Data
// Model §3.6 lifecycle: `status` advances from `published` to `closed` and
// no other field is modified.
export type AssignmentCloseWrite = {
  readonly status: "closed";
};

// Write shape for the reopen callable (assignmentsReopen). Conforms to
// Data Model 3.6 lifecycle: `status` moves from `closed` back to
// `published` and no other field is modified. This is the inverse of
// AssignmentCloseWrite and preserves the same field-narrowness posture,
// so the reopen path cannot be laundered into a metadata edit or an
// ownership change.
export type AssignmentReopenWrite = {
  readonly status: "published";
};

// Write shape for the archive callable (assignmentsArchive). Conforms to
// Data Model §3.6 lifecycle: `status` advances to the terminal `archived`
// state and no other field is modified.
export type AssignmentArchiveWrite = {
  readonly status: "archived";
};

// Write shape for the assignment-publication callable
// (lmsAssignmentsPublish). Narrow by design: only the additive
// `lmsPublicationRef` mirror pointer is writable through this path.
// Ownership fields (classId, teacherId, schoolId), lifecycle field
// (`status`), lesson fields (`lessonSlug`), timing
// fields, and title/instructions are intentionally absent so an LMS
// publication cannot launder into an ownership reassignment or a
// content edit per PDR-019d.
export type AssignmentLmsPublicationWrite = {
  readonly lmsPublicationRef: string;
};
