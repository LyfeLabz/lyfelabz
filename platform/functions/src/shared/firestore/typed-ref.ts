import type { CollectionReference, DocumentReference } from "firebase-admin/firestore";

import { AUDIT_EVENTS_COLLECTION, type AuditEventWrite } from "../types/audit-event";
import { SCHOOLS_COLLECTION, type SchoolRecord } from "../types/school";
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

// Audit-event document IDs are opaque and system-generated per Data Model
// §5.1, so the canonical shared reference is at the collection level.
export function auditEventsCollectionRef(): CollectionReference<AuditEventWrite> {
  return getAdminFirestore()
    .collection(AUDIT_EVENTS_COLLECTION) as CollectionReference<AuditEventWrite>;
}
