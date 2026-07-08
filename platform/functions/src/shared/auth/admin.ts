import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";

let authInstance: Auth | undefined;

export function getAdminAuth(): Auth {
  if (!authInstance) {
    if (getApps().length === 0) {
      initializeApp();
    }
    authInstance = getAuth();
  }
  return authInstance;
}
