// Firebase-native production binding for the Google Classroom OAuth
// client configuration and HTTPS transport. Sprint 23B activation slice
// (SPRINT_23_ARCHITECTURE_REVIEW.md §7, Option B).
//
// Invariants:
//
// - This module is package-local to `providers/google-classroom`. The
//   vendor-neutral LMS core never imports it (PDR-020f); only the
//   activated LMS callables reach into it, and only to (a) list the
//   secrets that must be bound to the function and (b) install the
//   production bindings idempotently at handler entry.
//
// - The client secret is stored only in Google Secret Manager
//   (`GOOGLE_CLASSROOM_CLIENT_SECRET`). It never appears in a Firestore
//   document, a client bundle, a fixture file, a log message, or a
//   callable response (PDR-019e; LMS_INTEGRATION_ARCHITECTURE.md §5.5,
//   §10.3.3).
//
// - `ensureGoogleClassroomProductionBindings` is idempotent AND
//   respects prior bindings: if a test has installed a fixture
//   transport or config via `setGoogleClassroomTransport` /
//   `setGoogleClassroomConfig`, the production installer detects the
//   prior binding and skips reinstallation. This preserves the
//   test-injection seam introduced in Sprint 23A.

import { defineSecret, defineString } from "firebase-functions/params";

import {
  isGoogleClassroomConfigBound,
  setGoogleClassroomConfig,
} from "./config";
import {
  createHttpsGoogleClassroomTransport,
  isGoogleClassroomTransportBound,
  setGoogleClassroomTransport,
} from "./transport";

// The three configuration values required to run the OAuth exchange and
// upstream Classroom REST calls. Client id and redirect uri are non-
// secret; the client secret is a Secret Manager secret.
//
// The parameter names use the Firebase Functions v2 convention: uppercase
// snake_case, so they map cleanly to `firebase functions:secrets:set`
// and to environment variables at emulator time.

export const GOOGLE_CLASSROOM_CLIENT_ID_PARAM = defineString(
  "GOOGLE_CLASSROOM_CLIENT_ID",
  {
    description:
      "OAuth 2.0 client id from the Google Cloud console for the LyfeLabz Google Classroom integration.",
    default: "",
  },
);

export const GOOGLE_CLASSROOM_REDIRECT_URI_PARAM = defineString(
  "GOOGLE_CLASSROOM_REDIRECT_URI",
  {
    description:
      "Registered redirect URI for the LyfeLabz Google Classroom OAuth client. Must match the OAuth client's authorized redirect URI list in the Google Cloud console.",
    default: "",
  },
);

export const GOOGLE_CLASSROOM_CLIENT_SECRET_PARAM = defineSecret(
  "GOOGLE_CLASSROOM_CLIENT_SECRET",
);

// The exact list of secrets an activated callable must attach to its
// `platformCallable` options so the Cloud Functions runtime binds the
// Secret Manager value into the invocation. Callables that never run
// against the upstream provider must NOT include this list.
export const googleClassroomProductionSecrets = [
  GOOGLE_CLASSROOM_CLIENT_SECRET_PARAM,
] as const;

// Installer: idempotent, and only binds if the seam is currently
// unbound. Tests inject fixtures via `setGoogleClassroomTransport` and
// `setGoogleClassroomConfig`; those calls set `isBound()` to true, and
// this installer becomes a no-op for that test lifecycle.
//
// The installer resolves the Firebase parameter values lazily: it
// touches `.value()` only inside the "not yet bound" branch. This means
// unit tests that inject their own bindings never reach for a Secret
// Manager value, and never fail because a secret is not provisioned in
// the test environment.
export function ensureGoogleClassroomProductionBindings(): void {
  if (!isGoogleClassroomConfigBound()) {
    setGoogleClassroomConfig({
      clientId: GOOGLE_CLASSROOM_CLIENT_ID_PARAM.value(),
      clientSecret: GOOGLE_CLASSROOM_CLIENT_SECRET_PARAM.value(),
      redirectUri: GOOGLE_CLASSROOM_REDIRECT_URI_PARAM.value(),
    });
  }
  if (!isGoogleClassroomTransportBound()) {
    setGoogleClassroomTransport(
      createHttpsGoogleClassroomTransport({
        resolveConfig: () => {
          // The resolver reads the same Secret Manager binding each
          // call so a rotated secret takes effect on the next invocation
          // without redeploying the function. Client id is a
          // non-sensitive parameter; only clientSecret is a Secret
          // Manager binding.
          return {
            clientId: GOOGLE_CLASSROOM_CLIENT_ID_PARAM.value(),
            clientSecret: GOOGLE_CLASSROOM_CLIENT_SECRET_PARAM.value(),
          };
        },
      }),
    );
  }
}
