import type { DocumentReference } from "firebase-admin/firestore";

import { USERS_COLLECTION, type UserProvisioningWrite } from "../types/user";
import { getAdminFirestore } from "./admin";

export function userDocRef(uid: string): DocumentReference<UserProvisioningWrite> {
  return getAdminFirestore()
    .collection(USERS_COLLECTION)
    .doc(uid) as DocumentReference<UserProvisioningWrite>;
}
