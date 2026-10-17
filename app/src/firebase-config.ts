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

// Isolated local emulator override.
//
// An emulator host may opt into a different emulator project and ports by
// defining `window.__lyfelabzEmulatorOverride` before any app bundle loads
// (for example from a locally served replacement of
// assets/lyfelabz-firebase-config.js kept outside the repository). The
// override is honored only on an emulator host; every other host ignores it,
// so production and staging behavior cannot change. When present it must be
// complete and valid: a `demo-*` project id plus loopback host and port for
// Auth, Firestore, and Functions. Anything else throws, so the page never
// initializes Firebase at all rather than mixing emulator and production
// services. No override keeps the historical emulator defaults.

export type EmulatorEndpoint = { readonly host: string; readonly port: number };

export type EmulatorEndpoints = {
  readonly projectId: string;
  readonly auth: EmulatorEndpoint;
  readonly firestore: EmulatorEndpoint;
  readonly functions: EmulatorEndpoint;
};

// Matches platform/firebase/firebase.json.
export const DEFAULT_EMULATOR_ENDPOINTS: EmulatorEndpoints = {
  projectId: PROJECT_ID,
  auth: { host: "127.0.0.1", port: 9099 },
  firestore: { host: "127.0.0.1", port: 8080 },
  functions: { host: "127.0.0.1", port: 5001 },
};

const DEMO_PROJECT_ID = /^demo-[a-z0-9][a-z0-9-]{0,24}[a-z0-9]$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);
const SERVICES = ["auth", "firestore", "functions"] as const;

type WindowWithOverride = Window & { __lyfelabzEmulatorOverride?: unknown };

function invalidOverride(reason: string): never {
  throw new Error(`Invalid __lyfelabzEmulatorOverride: ${reason}`);
}

export function parseEmulatorOverride(raw: unknown): EmulatorEndpoints {
  if (raw === null || typeof raw !== "object") invalidOverride("must be an object");
  const value = raw as Record<string, unknown>;
  const projectId = value.projectId;
  if (typeof projectId !== "string" || !DEMO_PROJECT_ID.test(projectId)) {
    invalidOverride("projectId must be a demo-* project id");
  }
  const endpoints: Record<string, EmulatorEndpoint> = {};
  const ports = new Set<number>();
  for (const service of SERVICES) {
    const entry = value[service];
    if (entry === null || typeof entry !== "object") invalidOverride(`${service} is required`);
    const { host, port } = entry as Record<string, unknown>;
    if (typeof host !== "string" || !LOOPBACK_HOSTS.has(host)) {
      invalidOverride(`${service}.host must be 127.0.0.1 or localhost`);
    }
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1024 || port > 65535) {
      invalidOverride(`${service}.port must be an integer from 1024 to 65535`);
    }
    if (ports.has(port)) invalidOverride(`${service}.port duplicates another service`);
    ports.add(port);
    endpoints[service] = { host, port };
  }
  return {
    projectId,
    auth: endpoints.auth,
    firestore: endpoints.firestore,
    functions: endpoints.functions,
  };
}

// The single source for every emulator connection. Returns null on a
// non-emulator host (production config applies, override ignored).
export function getEmulatorEndpoints(
  win: Window | undefined = typeof window === "undefined" ? undefined : window,
): EmulatorEndpoints | null {
  if (!win || !isEmulatorHost(win)) return null;
  const raw = (win as WindowWithOverride).__lyfelabzEmulatorOverride;
  if (raw === undefined) return DEFAULT_EMULATOR_ENDPOINTS;
  return parseEmulatorOverride(raw);
}

export function getFirebaseClientConfig(
  win: Window | undefined = typeof window === "undefined" ? undefined : window,
): FirebaseClientConfig {
  if (!win) return EMULATOR_CONFIG;
  const endpoints = getEmulatorEndpoints(win);
  if (endpoints !== null) {
    return endpoints === DEFAULT_EMULATOR_ENDPOINTS
      ? EMULATOR_CONFIG
      : { ...EMULATOR_CONFIG, projectId: endpoints.projectId };
  }
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
