import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let firestoreInstance: Firestore | undefined;

export function getAdminFirestore(): Firestore {
  if (!firestoreInstance) {
    if (getApps().length === 0) {
      initializeApp();
    }
    firestoreInstance = getFirestore();
  }
  return firestoreInstance;
}
