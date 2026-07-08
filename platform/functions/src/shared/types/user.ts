import type { FieldValue } from "firebase-admin/firestore";

export const USERS_COLLECTION = "users";

export type UserProvisioningWrite = {
  readonly uid: string;
  readonly email?: string;
  readonly displayName?: string;
  readonly photoURL?: string;
  readonly provider: string;
  readonly createdAt: FieldValue;
};
