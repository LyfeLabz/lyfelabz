import type { FieldValue, Timestamp } from "firebase-admin/firestore";

// Historical Assignment Resolution, Implementation Slice 1 (data model only).
//
// This is the dedicated Current-assignment pointer record family, per the
// governing invariant "one instructional occurrence remains one LyfeLabz
// assignment" and the locked product decision that Current is a narrow,
// server-authoritative pointer document - never a mutable field on
// `assignments/{assignmentId}` itself (Decision 1 of the architecture).
//
// Storage: `classes/{classId}/assignmentsCurrent/{lessonSlug}`, a
// subcollection of the owning class, not a top-level collection. The
// document identifier is the canonical `lessonSlug` and the parent path
// segment is the canonical `classId`, so exactly one pointer exists per
// (classId, lessonSlug) pair by construction - two Firestore path segments,
// never a concatenated composite string. This is a deliberate reversal of an
// earlier `${classId}__${lessonSlug}` flat-id draft: both `classId` (client-
// supplied at `classesCreate`) and `lessonSlug` are validated only by the
// same broad URL-safe-token grammar used for `assignmentId`
// (`/^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,N}[A-Za-z0-9])?$/`), which permits
// underscores - including consecutive underscores - in both components. A
// flat `__`-delimited id is therefore genuinely ambiguous (for example,
// `(classId="x", lessonSlug="y__z")` and `(classId="x__y", lessonSlug="z")`
// both concatenate to `"x__y__z"`), which is a real cross-class/cross-lesson
// collision hazard, not a hypothetical one. Hierarchical storage removes the
// hazard structurally: there is no delimiter to parse or collide on.
//
// This record is NEVER, by itself, authority for anything. Every caller that
// reads it (the lifecycle read path and the Current-aware recipient
// reconciliation path alike) independently re-validates the referenced
// assignment - ownership, class, lesson, and `published` status - before
// treating the pointer as authoritative. A malformed, stale, or cross-scope
// pointer is always treated identically to "no pointer" (fail closed). See
// `resolveValidCurrentAssignmentId` (a later slice) for the single shared
// implementation of that validation.
//
// Deliberately minimal per the architecture's "no complexity without a
// concrete invariant it protects" instruction: no `configRevision`/CAS
// counter is persisted on the document (the comparable value of interest is
// already `assignmentId` itself; the write callable's compare-and-swap
// compares against that directly), and no pointer-history subcollection
// exists (the audit trail plus `setAt`/`setBy`/`source` on the single
// current document are sufficient; nothing in the locked product decisions
// requires reconstructing every prior value of Current).
//
// No `districtId` field, consistent with `AssignmentRecord` and
// `ClassRecord`: district is never stored on this family of record, only
// ever re-derived from the caller's resolved district context and cross-
// checked against the owning class's `schoolId`.
//
// Zero direct client access is planned for this collection (Implementation
// Slice 2 adds a deny-all Firestore Rules block, mirroring the
// `presentationVariants` index-record posture - the closer precedent, since
// both are mutable, server-owned "current state" indexes rather than
// history-of-an-event records). Every piece of Current-aware UI state is
// served through server callables, so no client ever needs to compute this
// document's path itself.

export const ASSIGNMENTS_CURRENT_SUBCOLLECTION = "assignmentsCurrent";

// Distinguishes how a given value of the pointer came to be written, for
// audit and debugging purposes only - it confers no authority and gates no
// authorization decision by itself.
//
// `"publish"` is stamped by `assignmentsPublish` (a later slice) as an
// inherent, atomic part of a successful `draft -> published` transition:
// the assignment that was just published unconditionally becomes Current
// for its (classId, lessonSlug) pair. This is what makes both the ordinary
// first-time Assign flow and the explicit "Assign as new" flow correctly
// advance Current with no separate teacher click and no window in which a
// successfully published assignment could be left disconnected from
// Current.
//
// `"teacherResolution"` is stamped by the explicit `assignmentsCurrentSet`
// callable (a later slice) on every compare-and-swap-guarded write: the
// one-time resolution of a legacy `multiplePublished` class with no pointer
// yet, and every subsequent deliberate "Change current assignment" action.
// Both are the same category of explicit, teacher-initiated intent, so both
// share this one source value rather than two near-duplicate values.
export type AssignmentCurrentSource = "publish" | "teacherResolution";

// Canonical read shape for
// `classes/{classId}/assignmentsCurrent/{lessonSlug}`.
//
// `classId` and `lessonSlug` are redundant with the document's own address
// (the parent path segment and the document id, respectively) but are
// stored as plain fields anyway and must be cross-checked by every reader -
// `doc.id === data.lessonSlug` and the parent path's `classId ===
// data.classId` - exactly mirroring the "document id must equal its own
// field" defense-in-depth already required of `AssignmentRecipientRecord`.
//
// `teacherId` and `schoolId` are denormalized ownership, matching
// `AssignmentRecord.teacherId`/`ClassRecord.teacherId` naming (not
// `ownerUid`, which is an LMS-domain naming choice used elsewhere in this
// codebase for a different record family).
export type AssignmentCurrentRecord = {
  readonly classId: string;
  readonly lessonSlug: string;
  readonly assignmentId: string;
  readonly teacherId: string;
  readonly schoolId: string;
  readonly setAt: Timestamp;
  readonly setBy: string;
  readonly source: AssignmentCurrentSource;
};

// Write shape for setting (creating or overwriting) the pointer. Identical
// to the record shape except `setAt` is a `FieldValue` so the server
// timestamp sentinel can be used at the write boundary. Every field is
// required so the pointer can never be written with a partial ownership
// snapshot. Used with `.set()` by both planned writers: the atomic,
// unconditional write inside `assignmentsPublish`'s existing batch, and the
// compare-and-swap-guarded write inside the `assignmentsCurrentSet`
// callable. There is exactly one write shape because both writers produce
// the same shape of document; only the `source` field's value and the
// concurrency discipline around the write differ, and that discipline lives
// in the callables, not in the type.
export type AssignmentCurrentWrite = {
  readonly classId: string;
  readonly lessonSlug: string;
  readonly assignmentId: string;
  readonly teacherId: string;
  readonly schoolId: string;
  readonly setAt: FieldValue;
  readonly setBy: string;
  readonly source: AssignmentCurrentSource;
};
