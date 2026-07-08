import type { DocumentReference } from "firebase-admin/firestore";

import { SCHOOLS_COLLECTION, type SchoolRecord } from "../types/school";
import { USERS_COLLECTION, type UserProvisioningWrite } from "../types/user";
import { getAdminFirestore } from "./admin";

export function userDocRef(uid: string): DocumentReference<UserProvisioningWrite> {
  return getAdminFirestore()
    .collection(USERS_COLLECTION)
    .doc(uid) as DocumentReference<UserProvisioningWrite>;
}

export function schoolDocRef(schoolId: string): DocumentReference<SchoolRecord> {
  return getAdminFirestore()
    .collection(SCHOOLS_COLLECTION)
    .doc(schoolId) as DocumentReference<SchoolRecord>;
}
