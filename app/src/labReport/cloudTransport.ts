// Lab Report Assistant cloud transport.
//
// Bundled (esbuild IIFE) to assets/lyfelabz-lab-report-cloud.js and loaded by
// tool_lab-report-assistant.html only on hosts where cloud saving is enabled.
// It exposes a narrow transport on `window.lyfelabz.labReportCloud` that the
// page's sync engine (assets/lab-report-cloud-sync.js) consumes.
//
// It reuses the platform's existing identity path: the same Firebase project
// and client config as the app shell and assessment runtime
// (firebase-config.ts), the same Google sign-in provider settings
// (googleSignInProvider.ts), and the persisted Firebase Auth session of the
// app origin. It requests no OAuth scope beyond basic Google sign-in. It never
// reads Firestore: the `labReportsGet` / `labReportsSave` callables identify
// the student from the verified ID token and enforce ownership server-side.
//
// It never logs report content or tokens.

import type { FirebaseApp } from "firebase/app";
import type { Auth, User } from "firebase/auth";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "firebase/auth";
import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

import { configureGoogleSignInProvider } from "../session/googleSignInProvider";

export const LAB_REPORT_CLOUD_VERSION = "1.0.0";
export const LAB_REPORT_CLOUD_READY_EVENT = "lyfelabz:lab-report-cloud-ready";

export type CloudUser = { readonly uid: string; readonly label: string };

export type CloudErrorKind =
  | "conflict"
  | "blankRefused"
  | "tooLarge"
  | "unsupported"
  | "invalid"
  | "auth"
  | "notStudent"
  | "notActive"
  | "network";

export type CloudError = { readonly kind: CloudErrorKind; readonly code: string };

export type CloudGetResult =
  | { readonly exists: false; readonly revision: 0 }
  | {
      readonly exists: true;
      readonly revision: number;
      readonly report: unknown;
      readonly updatedAtMillis: number | null;
    };

export type CloudSaveInput = {
  readonly expectedRevision: number;
  readonly saveId: string;
  readonly report: unknown;
  readonly allowBlank: boolean;
};

export type CloudSaveResult = {
  readonly revision: number;
  readonly persisted: boolean;
  readonly updatedAtMillis: number;
};

export type LabReportCloudTransport = {
  readonly version: string;
  onAuthChange(callback: (user: CloudUser | null) => void): () => void;
  // Resolves with the signed-in account after a popup sign-in, or null when
  // the browser navigates away for a redirect sign-in.
  signIn(): Promise<CloudUser | null>;
  signOut(): Promise<void>;
  get(): Promise<CloudGetResult>;
  save(input: CloudSaveInput): Promise<CloudSaveResult>;
};

const PERMISSION_NOT_ACTIVE = new Set([
  "account-inactive",
  "claim-state-mismatch",
  "district-mismatch",
  "district-unassigned",
  "school-district-mismatch",
]);

// Maps a Firebase callable error to the small vocabulary the sync engine
// acts on. Unknown and transport-level failures are "network" (retryable
// within the engine's bounded budget); only explicit server refusals are
// terminal.
export function classifyCallableError(err: unknown): CloudError {
  const raw = err && typeof err === "object" ? (err as { code?: unknown; details?: unknown }) : {};
  const code = typeof raw.code === "string" ? raw.code.replace(/^functions\//, "") : "";
  const details = raw.details && typeof raw.details === "object" ? (raw.details as { code?: unknown }) : {};
  const platformCode = typeof details.code === "string" ? details.code : "";
  const kind = ((): CloudErrorKind => {
    if (platformCode === "labReports.writeConflict") return "conflict";
    if (platformCode === "labReports.blankOverwriteRefused") return "blankRefused";
    if (platformCode === "labReports.reportTooLarge") return "tooLarge";
    if (platformCode === "labReports.unsupportedVersion") return "unsupported";
    if (platformCode === "labReports.invalidReport" || platformCode === "labReports.invalidRequest") return "invalid";
    if (platformCode === "role-forbidden") return "notStudent";
    if (PERMISSION_NOT_ACTIVE.has(platformCode)) return "notActive";
    if (code === "unauthenticated" || platformCode === "unauthenticated" || platformCode === "claim-stale") return "auth";
    if (code === "permission-denied") return "notActive";
    if (code === "invalid-argument") return "invalid";
    return "network";
  })();
  return { kind, code: platformCode || code || "unknown" };
}

// Errors from fetching the ID token that mean the session itself is no longer
// valid. Firebase signs the user out on these, so they are sign-in problems.
const TOKEN_SESSION_INVALID = new Set([
  "auth/user-token-expired",
  "auth/invalid-user-token",
  "auth/user-disabled",
  "auth/user-not-found",
]);

// Maps a failure to obtain the caller's ID token. Anything other than an
// invalidated session (a refresh that could not reach Google, a timeout, a
// school network or a Chromebook waking from sleep) is retryable.
export function classifyTokenError(err: unknown): CloudError {
  const code = err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
    ? (err as { code: string }).code
    : "";
  if (TOKEN_SESSION_INVALID.has(code)) return { kind: "auth", code };
  return { kind: "network", code: code || "token-unavailable" };
}

function userLabel(user: User): string {
  if (typeof user.displayName === "string" && user.displayName.trim().length > 0) return user.displayName.trim();
  if (typeof user.email === "string" && user.email.length > 0) return user.email;
  return "your account";
}

type Deps = {
  readonly app: FirebaseApp;
  readonly auth: Auth;
  readonly functions: Functions;
};

export function createLabReportCloudTransport(deps: Deps): LabReportCloudTransport {
  const getCallable = httpsCallable<{ reportId: string }, CloudGetResult>(deps.functions, "labReportsGet");
  const saveCallable = httpsCallable<CloudSaveInput & { reportId: string }, CloudSaveResult>(deps.functions, "labReportsSave");

  // The Firebase Functions SDK silently sends a callable without credentials
  // when it cannot get the ID token, and the server then answers
  // "unauthenticated", which looks like an expired sign-in. Fetching the
  // token first turns a refresh that failed in transit into a retryable
  // network error, and a callable is never sent without a token. The SDK
  // reuses this cached token for the call that follows.
  const requireToken = async (): Promise<void> => {
    const user = deps.auth.currentUser;
    if (user === null) throw { kind: "auth", code: "signed-out" } satisfies CloudError;
    try {
      await user.getIdToken();
    } catch (err) {
      throw classifyTokenError(err);
    }
  };

  return {
    version: LAB_REPORT_CLOUD_VERSION,
    onAuthChange(callback) {
      return onAuthStateChanged(
        deps.auth,
        (user) => callback(user ? { uid: user.uid, label: userLabel(user) } : null),
        () => callback(null),
      );
    },
    async signIn() {
      const provider = new GoogleAuthProvider();
      configureGoogleSignInProvider(provider);
      try {
        const credential = await signInWithPopup(deps.auth, provider);
        return { uid: credential.user.uid, label: userLabel(credential.user) };
      } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "";
        if (code.includes("popup-blocked") || code.includes("operation-not-supported")) {
          await signInWithRedirect(deps.auth, provider);
          return null;
        }
        throw err;
      }
    },
    async signOut() {
      await signOut(deps.auth);
    },
    async get() {
      await requireToken();
      try {
        const result = await getCallable({ reportId: "active" });
        return result.data;
      } catch (err) {
        throw classifyCallableError(err);
      }
    },
    async save(input) {
      await requireToken();
      try {
        const result = await saveCallable({
          reportId: "active",
          expectedRevision: input.expectedRevision,
          saveId: input.saveId,
          report: input.report,
          allowBlank: input.allowBlank,
        });
        return result.data;
      } catch (err) {
        throw classifyCallableError(err);
      }
    },
  };
}
