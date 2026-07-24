import { getApp, initializeApp } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";

let authInstance: Auth | undefined;

// See getAdminFirestore for the rationale: `getApps().length === 0` is not
// a correct guard for the presence of the `[DEFAULT]` app.
function ensureDefaultApp(): void {
  try {
    getApp();
  } catch {
    initializeApp();
  }
}

export function getAdminAuth(): Auth {
  if (!authInstance) {
    ensureDefaultApp();
    authInstance = getAuth();
  }
  return authInstance;
}
