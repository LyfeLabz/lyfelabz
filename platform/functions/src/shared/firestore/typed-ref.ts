import type { CollectionReference, DocumentReference } from "firebase-admin/firestore";

import {
  ASSIGNMENTS_COLLECTION,
  type AssignmentArchiveWrite,
  type AssignmentCloseWrite,
  type AssignmentCreationWrite,
  type AssignmentDraftUpdateWrite,
  type AssignmentPublishWrite,
  type AssignmentRecord,
} from "../types/assignment";
import { AUDIT_EVENTS_COLLECTION, type AuditEventWrite } from "../types/audit-event";
import {
  CLASSES_COLLECTION,
  type ClassArchiveWrite,
  type ClassCreationWrite,
  type ClassMetadataUpdateWrite,
  type ClassRecord,
} from "../types/class";
import {
  ENROLLMENTS_COLLECTION,
  type EnrollmentCreationWrite,
  type EnrollmentRecord,
  type EnrollmentStatusChangeWrite,
} from "../types/enrollment";
import {
  SCHOOLS_COLLECTION,
  type SchoolCreationWrite,
  type SchoolRecord,
} from "../types/school";
import {
  SUBMISSIONS_COLLECTION,
  type SubmissionCreationWrite,
  type SubmissionFinalizationWrite,
  type SubmissionRecord,
} from "../types/submission";
import {
  USERS_COLLECTION,
  type UserProvisioningWrite,
  type UserRecord,
} from "../types/user";
import { getAdminFirestore } from "./admin";

export function userDocRef(uid: string): DocumentReference<UserProvisioningWrite> {
  return getAdminFirestore()
    .collection(USERS_COLLECTION)
    .doc(uid) as DocumentReference<UserProvisioningWrite>;
}

// Read + activation-update typed reference for users/{uid}. Reads return a
// DocumentSnapshot<UserRecord> aligned with the amended Data Model §3.1
// read shape, and activation writes (studentsCompleteOnboarding and, later,
// teacher activation) update the same reference. `userDocRef` remains the
// provisioning-write reference used by authOnUserCreate.
export function userRecordDocRef(uid: string): DocumentReference<UserRecord> {
  return getAdminFirestore()
    .collection(USERS_COLLECTION)
    .doc(uid) as DocumentReference<UserRecord>;
}

export function schoolDocRef(schoolId: string): DocumentReference<SchoolRecord> {
  return getAdminFirestore()
    .collection(SCHOOLS_COLLECTION)
    .doc(schoolId) as DocumentReference<SchoolRecord>;
}

// Creation-write typed reference for schools/{schoolId}. The schoolsCreate
// callable uses this reference to `.set()` a canonical `SchoolCreationWrite`
// payload so that `FieldValue.serverTimestamp()` can be used at the write
// boundary while the read-side `schoolDocRef` remains typed as
// `SchoolRecord`.
export function schoolCreationDocRef(
  schoolId: string,
): DocumentReference<SchoolCreationWrite> {
  return getAdminFirestore()
    .collection(SCHOOLS_COLLECTION)
    .doc(schoolId) as DocumentReference<SchoolCreationWrite>;
}

// Collection-level typed reference for classes. Used by the
// enrollmentsJoinByCode callable to resolve a class by its (joinCode,
// schoolId) tuple without reaching through to the raw Firestore instance.
export function classesCollectionRef(): CollectionReference<ClassRecord> {
  return getAdminFirestore()
    .collection(CLASSES_COLLECTION) as CollectionReference<ClassRecord>;
}

// Read typed reference for classes/{classId}. Reads return a
// DocumentSnapshot<ClassRecord> aligned with the canonical Data Model §3.3
// read shape. Callers that need to perform a metadata update or an archive
// transition use `classMetadataUpdateDocRef` or `classArchiveDocRef`
// respectively so that FieldValue-safe write shapes are preserved at the
// write boundary.
export function classDocRef(classId: string): DocumentReference<ClassRecord> {
  return getAdminFirestore()
    .collection(CLASSES_COLLECTION)
    .doc(classId) as DocumentReference<ClassRecord>;
}

// Creation-write typed reference for classes/{classId}. The classesCreate
// callable uses this reference to `.set()` a canonical `ClassCreationWrite`
// payload so that `FieldValue.serverTimestamp()` can be used at the write
// boundary while the read-side `classDocRef` remains typed as
// `ClassRecord`.
export function classCreationDocRef(
  classId: string,
): DocumentReference<ClassCreationWrite> {
  return getAdminFirestore()
    .collection(CLASSES_COLLECTION)
    .doc(classId) as DocumentReference<ClassCreationWrite>;
}

// Metadata-update typed reference for classes/{classId}. The
// classesUpdateMetadata callable uses this reference to `.update()` a
// narrow `ClassMetadataUpdateWrite` payload. Ownership fields, joinCode,
// status, and createdAt are absent from the write shape so no metadata
// update can silently reassign ownership, rotate the join code, or drive
// the lifecycle field.
export function classMetadataUpdateDocRef(
  classId: string,
): DocumentReference<ClassMetadataUpdateWrite> {
  return getAdminFirestore()
    .collection(CLASSES_COLLECTION)
    .doc(classId);
}

// Archive-write typed reference for classes/{classId}. The classesArchive
// callable uses this reference to `.update()` a narrow `ClassArchiveWrite`
// payload that advances the lifecycle field from `active` to `archived`
// and modifies no other field.
export function classArchiveDocRef(
  classId: string,
): DocumentReference<ClassArchiveWrite> {
  return getAdminFirestore()
    .collection(CLASSES_COLLECTION)
    .doc(classId) as DocumentReference<ClassArchiveWrite>;
}

// Audit-event document IDs are opaque and system-generated per Data Model
// §5.1, so the canonical shared reference is at the collection level.
export function auditEventsCollectionRef(): CollectionReference<AuditEventWrite> {
  return getAdminFirestore()
    .collection(AUDIT_EVENTS_COLLECTION) as CollectionReference<AuditEventWrite>;
}

// Read typed reference for enrollments/{enrollmentId}. Reads return a
// DocumentSnapshot<EnrollmentRecord> aligned with the canonical Data Model
// §3.4 read shape. Callers that need to perform a creation write or a
// status transition use `enrollmentCreationDocRef` or
// `enrollmentStatusChangeDocRef` respectively so that FieldValue-safe write
// shapes are preserved at the write boundary.
export function enrollmentDocRef(
  enrollmentId: string,
): DocumentReference<EnrollmentRecord> {
  return getAdminFirestore()
    .collection(ENROLLMENTS_COLLECTION)
    .doc(enrollmentId) as DocumentReference<EnrollmentRecord>;
}

// Creation-write typed reference for enrollments/{enrollmentId}. The
// enrollmentsJoinByCode and enrollmentsTeacherAdd callables use this
// reference to `.set()` a canonical `EnrollmentCreationWrite` payload so
// that `FieldValue.serverTimestamp()` can be used at the write boundary
// while the read-side `enrollmentDocRef` remains typed as
// `EnrollmentRecord`.
export function enrollmentCreationDocRef(
  enrollmentId: string,
): DocumentReference<EnrollmentCreationWrite> {
  return getAdminFirestore()
    .collection(ENROLLMENTS_COLLECTION)
    .doc(enrollmentId) as DocumentReference<EnrollmentCreationWrite>;
}

// Status-change typed reference for enrollments/{enrollmentId}. The
// enrollmentsSetStatus callable uses this reference to `.update()` a narrow
// `EnrollmentStatusChangeWrite` payload. Ownership fields (studentId,
// classId, schoolId) and enrolledAt are absent from the write shape so no
// status transition can silently reassign ownership or overwrite the
// creation timestamp.
export function enrollmentStatusChangeDocRef(
  enrollmentId: string,
): DocumentReference<EnrollmentStatusChangeWrite> {
  return getAdminFirestore()
    .collection(ENROLLMENTS_COLLECTION)
    .doc(enrollmentId) as DocumentReference<EnrollmentStatusChangeWrite>;
}

// Collection-level typed reference for enrollments. Used by the
// join-by-code and teacher-add callables to look up an existing (studentId,
// classId) enrollment by indexed query for idempotency, and by the
// join-by-code callable to look up a class by joinCode.
export function enrollmentsCollectionRef(): CollectionReference<EnrollmentRecord> {
  return getAdminFirestore()
    .collection(ENROLLMENTS_COLLECTION) as CollectionReference<EnrollmentRecord>;
}

// Collection-level typed reference for assignments. Reserved for future
// Sprint 4D admin scans; not used by the current callable set but exported
// alongside the record-level references for symmetry with the other domains.
export function assignmentsCollectionRef(): CollectionReference<AssignmentRecord> {
  return getAdminFirestore()
    .collection(ASSIGNMENTS_COLLECTION) as CollectionReference<AssignmentRecord>;
}

// Read typed reference for assignments/{assignmentId}. Reads return a
// DocumentSnapshot<AssignmentRecord> aligned with the canonical Data Model
// §3.6 read shape. Callers that need to perform a creation write, a draft
// update, or a lifecycle transition use the narrow write references below
// so that FieldValue-safe write shapes are preserved at the write boundary.
export function assignmentDocRef(
  assignmentId: string,
): DocumentReference<AssignmentRecord> {
  return getAdminFirestore()
    .collection(ASSIGNMENTS_COLLECTION)
    .doc(assignmentId) as DocumentReference<AssignmentRecord>;
}

// Creation-write typed reference for assignments/{assignmentId}. The
// assignmentsCreateDraft callable uses this reference to `.set()` a
// canonical `AssignmentCreationWrite` payload so that
// `FieldValue.serverTimestamp()` can be used at the write boundary while
// the read-side `assignmentDocRef` remains typed as `AssignmentRecord`.
export function assignmentCreationDocRef(
  assignmentId: string,
): DocumentReference<AssignmentCreationWrite> {
  return getAdminFirestore()
    .collection(ASSIGNMENTS_COLLECTION)
    .doc(assignmentId) as DocumentReference<AssignmentCreationWrite>;
}

// Draft-update typed reference for assignments/{assignmentId}. The
// assignmentsUpdateDraft callable uses this reference to `.update()` a
// narrow `AssignmentDraftUpdateWrite` payload. Ownership fields
// (classId, teacherId, schoolId), `status`, and `createdAt` are absent
// from the write shape so no draft update can silently reassign ownership
// or drive the lifecycle field.
export function assignmentDraftUpdateDocRef(
  assignmentId: string,
): DocumentReference<AssignmentDraftUpdateWrite> {
  return getAdminFirestore()
    .collection(ASSIGNMENTS_COLLECTION)
    .doc(assignmentId);
}

// Publish-write typed reference for assignments/{assignmentId}. The
// assignmentsPublish callable uses this reference to `.update()` a narrow
// `AssignmentPublishWrite` payload that advances the lifecycle field from
// `draft` to `published` and modifies no other field.
export function assignmentPublishDocRef(
  assignmentId: string,
): DocumentReference<AssignmentPublishWrite> {
  return getAdminFirestore()
    .collection(ASSIGNMENTS_COLLECTION)
    .doc(assignmentId) as DocumentReference<AssignmentPublishWrite>;
}

// Close-write typed reference for assignments/{assignmentId}. The
// assignmentsClose callable uses this reference to `.update()` a narrow
// `AssignmentCloseWrite` payload that advances the lifecycle field from
// `published` to `closed` and modifies no other field.
export function assignmentCloseDocRef(
  assignmentId: string,
): DocumentReference<AssignmentCloseWrite> {
  return getAdminFirestore()
    .collection(ASSIGNMENTS_COLLECTION)
    .doc(assignmentId) as DocumentReference<AssignmentCloseWrite>;
}

// Archive-write typed reference for assignments/{assignmentId}. The
// assignmentsArchive callable uses this reference to `.update()` a narrow
// `AssignmentArchiveWrite` payload that advances the lifecycle field to
// the terminal `archived` state and modifies no other field.
export function assignmentArchiveDocRef(
  assignmentId: string,
): DocumentReference<AssignmentArchiveWrite> {
  return getAdminFirestore()
    .collection(ASSIGNMENTS_COLLECTION)
    .doc(assignmentId) as DocumentReference<AssignmentArchiveWrite>;
}

// Collection-level typed reference for submissions. Reserved for future
// admin scans and rollup jobs; not used by the current callable set but
// exported alongside the record-level references for symmetry with the
// other domains.
export function submissionsCollectionRef(): CollectionReference<SubmissionRecord> {
  return getAdminFirestore()
    .collection(SUBMISSIONS_COLLECTION) as CollectionReference<SubmissionRecord>;
}

// Read typed reference for submissions/{submissionId}. Reads return a
// DocumentSnapshot<SubmissionRecord> aligned with the canonical Data Model
// §3.7 read shape. Callers that need to perform a creation write or a
// finalization transition use the narrow write references below so that
// FieldValue-safe write shapes are preserved at the write boundary.
export function submissionDocRef(
  submissionId: string,
): DocumentReference<SubmissionRecord> {
  return getAdminFirestore()
    .collection(SUBMISSIONS_COLLECTION)
    .doc(submissionId) as DocumentReference<SubmissionRecord>;
}

// Creation-write typed reference for submissions/{submissionId}. The
// submissionsCreate callable uses this reference to `.set()` a canonical
// `SubmissionCreationWrite` payload so that `FieldValue.serverTimestamp()`
// can be used at the write boundary while the read-side `submissionDocRef`
// remains typed as `SubmissionRecord`.
export function submissionCreationDocRef(
  submissionId: string,
): DocumentReference<SubmissionCreationWrite> {
  return getAdminFirestore()
    .collection(SUBMISSIONS_COLLECTION)
    .doc(submissionId) as DocumentReference<SubmissionCreationWrite>;
}

// Finalization-write typed reference for submissions/{submissionId}. The
// submissionsFinalize callable uses this reference to `.update()` a narrow
// `SubmissionFinalizationWrite` payload that advances the lifecycle field
// from `submitted` to `finalized` and stamps `submittedAt`. Ownership
// fields, `startedAt`, `assignmentId`, `studentId`, `lessonSlug`, and
// `lessonVersion` are absent from the write shape so no finalization can
// silently reassign ownership, backdate the start moment, or edit the
// frozen lesson version.
export function submissionFinalizationDocRef(
  submissionId: string,
): DocumentReference<SubmissionFinalizationWrite> {
  return getAdminFirestore()
    .collection(SUBMISSIONS_COLLECTION)
    .doc(submissionId) as DocumentReference<SubmissionFinalizationWrite>;
}
