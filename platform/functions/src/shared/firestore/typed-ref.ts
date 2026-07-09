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
