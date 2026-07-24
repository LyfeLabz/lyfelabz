import { getApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let firestoreInstance: Firestore | undefined;

// Ensure the DEFAULT firebase-admin app exists. `getApps().length === 0`
// is not a correct guard: `firebase-functions` (and any other library that
// registers a named-only admin app) can leave `getApps()` non-empty even
// when there is no `[DEFAULT]` app, which causes `getFirestore()` to throw
// "The default Firebase app does not exist." The idiomatic check is to
// call `getApp()` and initialize on the resulting throw.
function ensureDefaultApp(): void {
  try {
    getApp();
  } catch {
    initializeApp();
  }
}

export function getAdminFirestore(): Firestore {
  if (!firestoreInstance) {
    ensureDefaultApp();
    firestoreInstance = getFirestore();
  }
  return firestoreInstance;
}
