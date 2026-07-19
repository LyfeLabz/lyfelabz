import { getApps, initializeApp } from "firebase/app";
import type { Auth, User } from "firebase/auth";
import {
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  signOut as firebaseSignOut,
} from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
} from "firebase/firestore";

import { getFirebaseClientConfig, isEmulatorHost as detectEmulatorHost } from "./firebase-config";
import type {
  BootstrapAuthInput,
  BootstrapAuthUser,
  BootstrapFirestoreInput,
} from "./session/types";

// Sprint 17 Slice 6: configuration selection is delegated to the shared
// firebase-config module. Emulator hosts continue to receive the
// emulator-friendly placeholder; production hosts receive the injected
// certified project configuration. Neither the API key nor any other
// secret is embedded here.

const isEmulatorHost = (): boolean => detectEmulatorHost();

let cachedAuth: Auth | null = null;
let cachedDb: Firestore | null = null;

export function getFirebaseAuth(): Auth {
  if (cachedAuth) return cachedAuth;
  const app = getApps()[0] ?? initializeApp(getFirebaseClientConfig());
  const auth = getAuth(app);
  if (isEmulatorHost()) {
    // Auth emulator port matches platform/firebase/firebase.json.
    connectAuthEmulator(auth, "http://127.0.0.1:9099", {
      disableWarnings: true,
    });
  }
  cachedAuth = auth;
  return auth;
}

export function getFirebaseFirestore(): Firestore {
  if (cachedDb) return cachedDb;
  const app = getApps()[0] ?? initializeApp(getFirebaseClientConfig());
  const db = getFirestore(app);
  if (isEmulatorHost()) {
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
  cachedDb = db;
  return db;
}

// Adapter that bridges the modular Firebase Auth SDK to the narrow
// BootstrapAuthInput interface the bootstrap depends on. Isolating the
// adapter here keeps the bootstrap SDK-free.
export function createAuthInput(auth: Auth): BootstrapAuthInput {
  return {
    waitForAuthState: () =>
      new Promise<BootstrapAuthUser | null>((resolve, reject) => {
        const unsubscribe = onAuthStateChanged(
          auth,
          (user: User | null) => {
            unsubscribe();
            if (user === null) {
              resolve(null);
              return;
            }
            resolve({
              uid: user.uid,
              email: user.email,
              getIdTokenResult: async (forceRefresh?: boolean) => {
                const result = await user.getIdTokenResult(forceRefresh);
                return { claims: result.claims as Readonly<Record<string, unknown>> };
              },
            });
          },
          (err) => {
            unsubscribe();
            reject(err);
          },
        );
      }),
  };
}

export function createFirestoreInput(db: Firestore): BootstrapFirestoreInput {
  return {
    getUser: async (uid) => {
      const ref = doc(db, "users", uid);
      const snap = await getDoc(ref);
      return {
        exists: snap.exists(),
        data: () => snap.data(),
      };
    },
  };
}

export async function signOut(auth: Auth): Promise<void> {
  await firebaseSignOut(auth);
}
