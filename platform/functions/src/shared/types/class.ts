import type { FieldValue, Timestamp } from "firebase-admin/firestore";

import type { ClassEnrollmentSource, LmsProviderId } from "./lms";

export const CLASSES_COLLECTION = "classes";

// Canonical classroom lifecycle field per Data Model §3.3. `status` is the
// only lifecycle field on a class document and never coexists with any
// second lifecycle field, consistent with the platform-wide "status is the
// only lifecycle field" invariant established for users in Sprint 2. The
// enumeration is intentionally small in Sprint 4B: `active` on creation and
// `archived` after a terminal archive transition. Additional transitions
// (for example, suspension or template) are out of scope until a documented
// architecture amendment adds them.
export type ClassStatus = "active" | "archived";

// Canonical class record shape per Data Model §3.3.
//
// Required fields: teacherId, schoolId, title, grade, block, joinCode,
// status, createdAt.
// Optional fields: coTeacherIds, academicTerm, joinCodeExpiresAt.
//
// This type is the single source of truth for reads of classes/{classId}.
// Write shapes are declared separately so that FieldValue sentinels can be
// used at the write boundary. Immutable ownership per Data Model §1.2:
// teacherId and schoolId are set at creation and never change.
export type ClassRecord = {
  readonly teacherId: string;
  readonly schoolId: string;
  readonly title: string;
  readonly grade: string;
  readonly block: string;
  readonly joinCode: string;
  readonly status: ClassStatus;
  readonly createdAt: Timestamp;
  readonly coTeacherIds?: readonly string[];
  readonly academicTerm?: string;
  readonly joinCodeExpiresAt?: Timestamp;
  // Additive optional fields reserved by the ratified LMS integration
  // architecture (Data Model §3.3, Amendment §3.4, PDR-019g, PDR-019i).
  // Absent on every pre-existing class. `enrollmentSource` defaults to
  // `joinCode` when absent; `lmsProviderRef` is present only when the
  // class carries `enrollmentSource: "lms"` and points to the
  // `lmsProviders/{providerId}` document that owns the linked class.
  readonly enrollmentSource?: ClassEnrollmentSource;
  readonly lmsProviderRef?: LmsProviderId;
};

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
// Model §3.3 lifecycle: `status` advances from `active` to `archived` and
// no other field is modified. The write is intentionally narrow so the
// archive path cannot be laundered into a metadata edit or an ownership
// change.
export type ClassArchiveWrite = {
  readonly status: "archived";
};
