import {
  checkActiveConsistency,
  extractCanonicalClaims,
  isTokenAheadOfRecord,
} from "./consistency";
import type {
  BootstrapAuthInput,
  BootstrapAuthUser,
  BootstrapEnv,
  BootstrapFirestoreInput,
  ErrorReason,
  Session,
  UserRecordRead,
} from "./types";
import { validateUserRecord } from "./user-record";

// Freezes the constructed Session so no downstream surface can mutate it.
// Sprint 3 refinement: whenever authentication, claims, or authorization
// change, the caller runs the bootstrap again to obtain a completely new
// Session object. Sessions are never patched in place.
const freeze = (session: Session): Session => Object.freeze(session);

const errorSession = (reason: ErrorReason): Session =>
  freeze({ kind: "error", reason });

const defaultEnv: BootstrapEnv = {
  isOnline: () => {
    if (typeof navigator === "undefined") return true;
    if (typeof navigator.onLine !== "boolean") return true;
    return navigator.onLine;
  },
  delay: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
};

// Bounded polling for the users/{uid} document after first sign-in. The
// `authOnUserCreate` trigger provisions the record asynchronously and
// typically completes in ~1-1.5 s (observed in lyfelabz-prod). The client
// reaches the getUser read within a few hundred milliseconds of Auth
// resolving, so a naive read races the trigger and returns
// `userRecordMissing` for a brand-new Google account. Polling gives the
// trigger a calm, bounded window to land before we surface a permanent
// missing-record error. Total wait ≤ 3 s (7 attempts × 500 ms).
const MISSING_RECORD_MAX_ATTEMPTS = 7;
const MISSING_RECORD_DELAY_MS = 500;

// The Canonical Session Bootstrap.
//
// Composes: Firebase Authentication -> optional bounded token refresh ->
// custom claims -> Firestore users/{uid} -> consistency validation ->
// immutable Canonical Session Object.
//
// Scope refinement (Sprint 3 Step 3 implementation): identity and
// authorization only. This bootstrap does not load school documents,
// classroom data, assignments, or application configuration. Everything
// beyond schoolId is deferred to post-bootstrap application init.
//
// Never throws to the caller. Every failure path is a discriminated
// Session kind. See Step 3 spec §9.
export async function bootstrapSession(
  auth: BootstrapAuthInput,
  db: BootstrapFirestoreInput,
  env: BootstrapEnv = defaultEnv,
): Promise<Session> {
  let user: BootstrapAuthUser | null;
  try {
    user = await auth.waitForAuthState();
  } catch {
    return errorSession("authInitFailed");
  }

  if (user === null) {
    return freeze({ kind: "unauthenticated" });
  }

  const uid = user.uid;

  // Fast offline detection. When the browser reports offline before we
  // attempt the read, prefer the networkUnavailable reason over the
  // more general userRecordUnreadable classification.
  if (!env.isOnline()) {
    return errorSession("networkUnavailable");
  }

  let snapshot;
  try {
    snapshot = await db.getUser(uid);
  } catch {
    return errorSession("userRecordUnreadable");
  }

  if (!snapshot.exists) {
    const delay = env.delay ?? defaultEnv.delay!;
    for (let attempt = 1; attempt < MISSING_RECORD_MAX_ATTEMPTS; attempt++) {
      await delay(MISSING_RECORD_DELAY_MS);
      try {
        snapshot = await db.getUser(uid);
      } catch {
        return errorSession("userRecordUnreadable");
      }
      if (snapshot.exists) break;
    }
    if (!snapshot.exists) {
      return errorSession("userRecordMissing");
    }
  }

  const record = validateUserRecord(snapshot.data());
  if (record === null) {
    return errorSession("recordShapeInvalid");
  }

  // Read the current ID token result without forcing a refresh. Force-
  // refresh is bounded to at most one call, triggered only by the
  // "record ahead of token" drift condition (Step 3 spec §8).
  let claims;
  try {
    const initial = await user.getIdTokenResult(false);
    claims = extractCanonicalClaims(initial.claims);
  } catch {
    return errorSession("authInitFailed");
  }

  return resolveSession(uid, user, user.email, record, claims);
}

async function resolveSession(
  uid: string,
  user: BootstrapAuthUser,
  email: string | null,
  record: UserRecordRead,
  initialClaims: ReturnType<typeof extractCanonicalClaims>,
): Promise<Session> {
  switch (record.status) {
    case "provisioned": {
      const session: Session = email
        ? { kind: "provisioned", uid, email }
        : { kind: "provisioned", uid };
      return freeze(session);
    }
    case "pendingVerification": {
      // schoolId and displayName are guaranteed present by validation.
      return freeze({
        kind: "pendingVerification",
        uid,
        schoolId: record.schoolId as string,
        displayName: record.displayName as string,
      });
    }
    case "suspended":
      return freeze({ kind: "suspendedUser", uid });
    case "archived":
      return freeze({ kind: "archivedUser", uid });
    case "active":
      return resolveActive(uid, user, record, initialClaims);
    default: {
      // Unreachable; validateUserRecord constrains status.
      return errorSession("recordShapeInvalid");
    }
  }
}

async function resolveActive(
  uid: string,
  user: BootstrapAuthUser,
  record: UserRecordRead,
  initialClaims: ReturnType<typeof extractCanonicalClaims>,
): Promise<Session> {
  let claims = initialClaims;
  let verdict = checkActiveConsistency(record, claims);

  // Bounded token refresh: at most one force-refresh per bootstrap, and
  // only when the record already says active but claims disagree ("record
  // ahead of token" drift, Step 3 spec §8).
  if (verdict === "mismatch") {
    try {
      const refreshed = await user.getIdTokenResult(true);
      claims = extractCanonicalClaims(refreshed.claims);
      verdict = checkActiveConsistency(record, claims);
    } catch {
      return errorSession("authInitFailed");
    }
  }

  if (verdict !== "match") {
    // Record wins on disagreement. Degrade the caller to
    // pendingVerification-equivalent refusal. The record has role and
    // schoolId (active requires them) and displayName; reuse them so the
    // pending stub can display the caller name.
    return freeze({
      kind: "pendingVerification",
      uid,
      schoolId: record.schoolId as string,
      displayName: record.displayName as string,
    });
  }

  // Token-ahead-of-record is impossible here because record is active;
  // however we still assert claims.role is a known active role.
  const displayName = record.displayName as string;
  const schoolId = record.schoolId as string;
  switch (record.role) {
    case "teacher":
      return freeze({ kind: "activeTeacher", uid, schoolId, displayName });
    case "student":
      return freeze({ kind: "activeStudent", uid, schoolId, displayName });
    case "platformAdministrator":
      return freeze({
        kind: "activeAdministrator",
        uid,
        schoolId,
        displayName,
      });
    default:
      return errorSession("recordShapeInvalid");
  }
}

// Re-exported so tests and integration callers can construct the
// same drift refusal shape without depending on internals.
export const _internals = {
  freeze,
  isTokenAheadOfRecord,
};
