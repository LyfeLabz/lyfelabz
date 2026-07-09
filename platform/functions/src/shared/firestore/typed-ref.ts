import type { CollectionReference, DocumentReference } from "firebase-admin/firestore";

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
