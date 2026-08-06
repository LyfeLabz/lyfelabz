import type { FieldValue, Timestamp } from "firebase-admin/firestore";

import type { ClassEnrollmentSource, LmsProviderId } from "./lms";

export const CLASSES_COLLECTION = "classes";

// Canonical classroom lifecycle field per Data Model §3.3. `status` is the
// only lifecycle field on a class document and never coexists with any
// second lifecycle field, consistent with the platform-wide "status is the
// only lifecycle field" invariant established for users in Sprint 2. Sprint
// 24B Phase 2B extends the enumeration to include `needsSetup`, a
// short-lived pre-instruction lifecycle state written only by the LMS
// creation seam (`classesLmsCreate`, Phase 2B.3) and cleared by the
// activation callable (`classesActivate`, Phase 2B.3). No production code
// path in Phase 2B.1 writes `needsSetup`; readers must nonetheless
// tolerate it so that when the writer lands in Phase 2B.4 the surface is
// already safe. See docs/platform/SPRINT_24B_PHASE_2B_IMPLEMENTATION_SPECIFICATION.md §7.4
// and docs/platform/SPRINT_24B_PHASE_2B_READER_AUDIT.md §3.
export type ClassStatus = "active" | "archived" | "needsSetup";

// Canonical class record shape per Data Model §3.3 and Phase 2B Spec §7.4.
//
// `ClassRecord` is a discriminated union over `status`. Every arm shares
// the ownership triple (`teacherId`, `schoolId`, `title`, `createdAt`)
// and the optional LMS-source and co-teacher fields. Only the `active`
// and `archived` arms carry `grade` and `block`; a `needsSetup` class
// intentionally omits those two fields until the activation callable
// atomically writes them.
//
// joinCode invariant (Sprint 24B Phase 2B.7). `joinCode` is present on
// the `active` and `archived` arms if and only if the class is manually
// created (i.e. `enrollmentSource !== "lms"`). LMS-sourced classes never
// carry a joinCode because enrollment for those classes flows through
// the synchronized upstream roster, not through student self-service
// join-by-code. The biconditional (joinCode present iff enrollmentSource
// !== "lms") is enforced at the two write sites (`classesCreate` and
// `classesActivate`) and defended at the read site
// (`enrollmentsJoinByCode`). The type expresses the field as optional
// rather than as a second discriminant so downstream readers do not need
// a new type discrimination step; a legacy record that carries a
// joinCode despite being LMS-sourced is inert because the read-side
// defense refuses redemption.
//
// This type is the single source of truth for reads of classes/{classId}.
// Write shapes are declared separately so that FieldValue sentinels can be
// used at the write boundary. Immutable ownership per Data Model §1.2:
// teacherId and schoolId are set at creation and never change.

type ClassRecordCommon = {
  readonly teacherId: string;
  readonly schoolId: string;
  readonly title: string;
  readonly createdAt: Timestamp;
  readonly coTeacherIds?: readonly string[];
  readonly academicTerm?: string;
  // Additive optional fields reserved by the ratified LMS integration
  // architecture (Data Model §3.3, Amendment §3.4, PDR-019g, PDR-019i).
  // Absent on every pre-existing class. `enrollmentSource` defaults to
  // `joinCode` when absent; `lmsProviderRef` is present only when the
  // class carries `enrollmentSource: "lms"` and points to the
  // `lmsProviders/{providerId}` document that owns the linked class.
  readonly enrollmentSource?: ClassEnrollmentSource;
  readonly lmsProviderRef?: LmsProviderId;
};

export type ActiveClassRecord = ClassRecordCommon & {
  readonly status: "active";
  readonly grade: string;
  readonly block: string;
  // Optional per the Sprint 24B Phase 2B.7 joinCode invariant documented
  // above: present for manual classes, absent for LMS-sourced classes.
  readonly joinCode?: string;
  readonly joinCodeExpiresAt?: Timestamp;
};

export type ArchivedClassRecord = ClassRecordCommon & {
  readonly status: "archived";
  readonly grade: string;
  readonly block: string;
  // Optional per the Sprint 24B Phase 2B.7 joinCode invariant documented
  // above: carries forward whatever value (if any) the record held when it
  // was last active.
  readonly joinCode?: string;
  readonly joinCodeExpiresAt?: Timestamp;
};

// `needsSetup` documents intentionally omit `grade`, `block`, `joinCode`,
// and `joinCodeExpiresAt`. Callers must never assume those fields exist
// on a needsSetup arm. Phase 2B.3's activation callable is the sole
// writer that supplies them.
export type NeedsSetupClassRecord = ClassRecordCommon & {
  readonly status: "needsSetup";
};

export type ClassRecord =
  | ActiveClassRecord
  | ArchivedClassRecord
  | NeedsSetupClassRecord;

// Write shape for the class-creation callable (classesCreate). Conforms to
// Data Model §3.3: teacherId, schoolId, title, grade, block, joinCode, and
// status are required on creation, createdAt is stamped by the server via
// `FieldValue.serverTimestamp()`, and academicTerm is optional. joinCode is
// server-generated at creation time to satisfy the §3.3 required-field
// contract; the join-code lookup, rotation, and enrollment flows are out of
// scope for Sprint 4B and are not implemented anywhere in this write path.
export type ClassCreationWrite = {
  readonly teacherId: string;
  readonly schoolId: string;
  readonly title: string;
  readonly grade: string;
  readonly block: string;
  readonly joinCode: string;
  readonly status: "active";
  readonly createdAt: FieldValue;
  readonly academicTerm?: string;
};

// Write shape reserved for the Phase 2B.3 LMS-authored creation callable
// (`classesLmsCreate`). Deliberately narrow: no grade, no block, no
// joinCode. `status` is fixed to `needsSetup`. Declared in Phase 2B.1 so
// the type surface is available to Phase 2B.3 without a second type
// migration; no callable writes this shape in Phase 2B.1.
export type ClassLmsCreationWrite = {
  readonly teacherId: string;
  readonly schoolId: string;
  readonly title: string;
  readonly status: "needsSetup";
  readonly createdAt: FieldValue;
  readonly academicTerm?: string;
  readonly enrollmentSource?: ClassEnrollmentSource;
  readonly lmsProviderRef?: LmsProviderId;
};

// Write shape reserved for the Phase 2B.3 activation callable
// (`classesActivate`). Applied atomically in a single transaction that
// also transitions `status` from `needsSetup` to `active`. Declared in
// Phase 2B.1 for the same reason as `ClassLmsCreationWrite`.
//
// Phase 2B.7 joinCode invariant: `joinCode` is present for manual
// activations and absent for LMS activations. The activation handler is
// the sole writer that constructs this shape; it branches on the
// pre-transaction record's `enrollmentSource` and includes the field
// only for the manual case.
export type ClassActivationWrite = {
  readonly status: "active";
  readonly grade: string;
  readonly block: string;
  readonly joinCode?: string;
};

// Write shape for the metadata-update callable (classesUpdateMetadata).
// Only the teacher-editable metadata fields are writable through this
// path per Data Model §7.3. Ownership fields (teacherId, schoolId,
// joinCode, status, createdAt) are intentionally absent so that no
// metadata update can silently reassign ownership, rotate the join code,
// or drive the lifecycle field. Every field is optional so a caller may
// update only the subset of metadata that changed.
export type ClassMetadataUpdateWrite = {
  readonly title?: string;
  readonly grade?: string;
  readonly block?: string;
  readonly academicTerm?: string;
};

// Write shape for the LMS class-import callable. Narrow by design: only
// the additive enrollment-source fields are writable through this path.
// Ownership fields (teacherId, schoolId), lifecycle field (status), title,
// grade, block, joinCode, and createdAt are intentionally absent so an
// LMS import can never launder into an ownership change, a metadata edit,
// or a lifecycle transition per PDR-019i and PDR-019j.
export type ClassLmsLinkWrite = {
  readonly enrollmentSource: "lms";
  readonly lmsProviderRef: LmsProviderId;
};

// Write shape for the archive callable (classesArchive). Conforms to Data
// Model §3.3 lifecycle: `status` advances to `archived` from either
// `active` or `needsSetup` and no other field is modified. The write is
// intentionally narrow so the archive path cannot be laundered into a
// metadata edit or an ownership change.
export type ClassArchiveWrite = {
  readonly status: "archived";
};
