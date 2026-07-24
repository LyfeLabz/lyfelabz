// Sprint 17 Slice 6 - Canonical Firebase client configuration.
//
// This module is the single source of truth for the Firebase client
// configuration used by every browser surface that touches the certified
// backend: the authenticated app shell (app/src/firebase.ts) and the
// lesson assessment runtime (app/src/runtime/entry.ts). Duplicating the
// EMULATOR_CONFIG object across those two entry points would have drifted
// silently the first time production diverged from the emulator; a shared
// module is the only correct home.
//
// Environment detection is purely host-based:
//
//   - "localhost", "127.0.0.1", "0.0.0.0" -> emulator config.
//     Matches the emulator ports declared in platform/firebase/firebase.json
//     and the connectAuthEmulator / connectFirestoreEmulator /
//     connectFunctionsEmulator calls in the two entry points.
//
//   - Every other host -> production config.
//     Production values are injected at page load through
//     `window.__lyfelabzFirebaseConfig`. Firebase Hosting is configured
//     to serve a small snippet (public/__/firebase/init.js analogue, or
//     an inline <script> emitted alongside the app shell) that populates
//     that global with the certified production project's public web
//     config. When the global is absent - for example on a preview host
//     that forgot to inject it - we fall back to a public identifier
//     shape derived from the certified project id so the SDK fails loud
//     against a real project instead of silently pointing at localhost.
//
// The Firebase Web SDK config is not a secret: Google publishes the
// values on the console and enforces access through Firebase Auth
// allowlists, App Check, and the Firestore / Storage security rules
// certified in earlier sprints. Even so, no production API key is
// embedded in this file; the runtime pulls it from the hosting-injected
// global at load time. That keeps the repository free of committed
// production credentials and preserves the emulator-only local workflow.

export type FirebaseClientConfig = {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly appId?: string;
  readonly messagingSenderId?: string;
  readonly storageBucket?: string;
};

// Certified project id shared by emulator and production. See
// platform/firebase/.firebaserc.
export const PROJECT_ID = "lyfelabz-prod";

// Emulator-friendly config. The Firebase Auth emulator does not validate
// the API key, so a placeholder is safe. authDomain is "localhost" so
// the SDK constructs auth URLs against the local host.
export const EMULATOR_CONFIG: FirebaseClientConfig = {
  apiKey: "emulator-placeholder-api-key",
  authDomain: "localhost",
  projectId: PROJECT_ID,
};

// Fallback production config used only when the hosting-injected global
// is missing. Provides the canonical authDomain shape so an unconfigured
// preview surface fails against the real Firebase project rather than
// silently succeeding against the emulator config.
const PRODUCTION_FALLBACK: FirebaseClientConfig = {
  apiKey: "unconfigured",
  authDomain: `${PROJECT_ID}.firebaseapp.com`,
  projectId: PROJECT_ID,
};

type WindowWithConfig = Window & {
  __lyfelabzFirebaseConfig?: Partial<FirebaseClientConfig> & {
    readonly projectId?: string;
  };
};

export function isEmulatorHost(win: Window | undefined = typeof window === "undefined" ? undefined : window): boolean {
  if (!win) return false;
  const host = win.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
}

export function getFirebaseClientConfig(
  win: Window | undefined = typeof window === "undefined" ? undefined : window,
): FirebaseClientConfig {
  if (!win || isEmulatorHost(win)) return EMULATOR_CONFIG;
  const injected = (win as WindowWithConfig).__lyfelabzFirebaseConfig;
  if (injected && typeof injected === "object") {
    return {
      apiKey: typeof injected.apiKey === "string" && injected.apiKey.length > 0
        ? injected.apiKey
        : PRODUCTION_FALLBACK.apiKey,
      authDomain: typeof injected.authDomain === "string" && injected.authDomain.length > 0
        ? injected.authDomain
        : PRODUCTION_FALLBACK.authDomain,
      projectId: typeof injected.projectId === "string" && injected.projectId.length > 0
        ? injected.projectId
        : PRODUCTION_FALLBACK.projectId,
      appId: typeof injected.appId === "string" ? injected.appId : undefined,
      messagingSenderId: typeof injected.messagingSenderId === "string"
        ? injected.messagingSenderId
        : undefined,
      storageBucket: typeof injected.storageBucket === "string"
        ? injected.storageBucket
        : undefined,
    };
  }
  return PRODUCTION_FALLBACK;
}
