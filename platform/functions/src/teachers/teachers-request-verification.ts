import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  log,
  schoolDocRef,
  userRecordDocRef,
  writeAuditEvent,
  type TeacherVerificationRequestWrite,
  type UserRecord,
} from "../shared";

// Client-supplied request payload for teachersRequestVerification. The role
// is carried on the payload as an explicit self-declaration so this
// callable never silently transitions a caller who intended a different
// role. The activation-required fields (role, schoolId, displayName)
// mirror the amended Data Model §3.1 activation-required set.
export type TeachersRequestVerificationRequest = {
  readonly role: "teacher";
  readonly schoolId: string;
  readonly displayName: string;
};

// Return payload of a successful verification request. `alreadyPending` is
// `true` when the call is a no-op idempotent replay of a previously
// successful request, and `false` when this call performed the
// `provisioned` -> `pendingVerification` transition.
export type TeachersRequestVerificationResponse = {
  readonly uid: string;
  readonly status: "pendingVerification";
  readonly role: "teacher";
  readonly schoolId: string;
  readonly alreadyPending: boolean;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertAuthenticated(
  request: CallableRequest<unknown>,
): { readonly uid: string } {
  const auth = request.auth;
  if (!auth || !isNonEmptyString(auth.uid)) {
    throw new PlatformError(
      "teachers.unauthenticated",
      "An authenticated caller is required.",
    );
  }
  return { uid: auth.uid };
}

function validateRequest(
  data: unknown,
): TeachersRequestVerificationRequest {
  if (data === null || typeof data !== "object") {
    throw new PlatformError(
      "teachers.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;
  if (payload.role !== "teacher") {
    throw new PlatformError(
      "teachers.invalidRole",
      'role must be "teacher".',
    );
  }
  if (!isNonEmptyString(payload.schoolId)) {
    throw new PlatformError(
      "teachers.invalidSchoolId",
      "schoolId must be a non-empty string.",
    );
  }
  if (!isNonEmptyString(payload.displayName)) {
    throw new PlatformError(
      "teachers.invalidDisplayName",
      "displayName must be a non-empty string.",
    );
  }
  return {
    role: "teacher",
    schoolId: payload.schoolId.trim(),
    displayName: payload.displayName.trim(),
  };
}

async function loadUserRecord(uid: string): Promise<UserRecord> {
  const snapshot = await userRecordDocRef(uid).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "teachers.userNotFound",
      "User record was not found for the authenticated caller.",
    );
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError(
      "teachers.userNotFound",
      "User record was empty for the authenticated caller.",
    );
  }
  return data;
}

async function assertSchoolExists(schoolId: string): Promise<void> {
  const snapshot = await schoolDocRef(schoolId).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "teachers.schoolNotFound",
      "Referenced school does not exist.",
    );
  }
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle. A logger failure after the
    // Firestore write has succeeded (or after a failure is already being
    // rethrown) must never itself become the outcome of the callable.
  }
}

// teachersRequestVerification
//
// Canonical transition `provisioned` -> `pendingVerification` for
// teachers, per the transition table in PLATFORM_STATE_MACHINE.md §3.
//
// Custom claims are intentionally NOT issued at this step. A teacher only
// becomes claim-bearing after administrative approval, which is handled by
// a later callable. Writing claims here would grant teacher authority to
// an unverified caller.
//
// Every side effect flows through the canonical shared helpers:
//   - user record read via `userRecordDocRef(uid).get()`         (typed ref)
//   - school record read via `schoolDocRef(schoolId).get()`      (typed ref)
//   - request update via `userRecordDocRef(uid).update(...)`     (typed ref)
//   - audit event via `writeAuditEvent({...})`                   (§5 helper)
//
// The callable never touches `setCustomUserClaims` directly, never adds an
// `auditEvents` document directly, and never reaches Firestore through
// `getAdminFirestore()` without going through a typed-ref builder.
//
// Idempotency: a caller who is already `pendingVerification` with the same
// role and schoolId receives a success response with `alreadyPending:
// true`. No second update is performed and no second
// `teachers.verificationRequested` audit event is emitted. The state on
// the user document and the audit stream are unchanged.
async function teachersRequestVerificationHandler(
  request: CallableRequest<unknown>,
): Promise<TeachersRequestVerificationResponse> {
  const { uid } = assertAuthenticated(request);
  const input = validateRequest(request.data);

  const user = await loadUserRecord(uid);

  if (
    user.status === "pendingVerification" &&
    user.role === "teacher" &&
    user.schoolId === input.schoolId
  ) {
    safeLog(() =>
      log.info("teachers.verificationRequestIdempotent", {
        uid,
        schoolId: input.schoolId,
      }),
    );
    return {
      uid,
      status: "pendingVerification",
      role: "teacher",
      schoolId: input.schoolId,
      alreadyPending: true,
    };
  }

  if (user.status !== "provisioned") {
    throw new PlatformError(
      "teachers.invalidStatus",
      `Verification request requires status "provisioned" (current: "${user.status}").`,
    );
  }

  await assertSchoolExists(input.schoolId);

  const verificationRequest: TeacherVerificationRequestWrite = {
    role: "teacher",
    schoolId: input.schoolId,
    displayName: input.displayName,
    status: "pendingVerification",
  };

  await userRecordDocRef(uid).update(verificationRequest);

  await writeAuditEvent({
    actorUserId: uid,
    actorRole: "teacher",
    action: "teachers.verificationRequested",
    targetType: "user",
    targetId: uid,
    schoolId: input.schoolId,
  });

  safeLog(() =>
    log.info("teachers.verificationRequested", {
      uid,
      schoolId: input.schoolId,
    }),
  );

  return {
    uid,
    status: "pendingVerification",
    role: "teacher",
    schoolId: input.schoolId,
    alreadyPending: false,
  };
}

export const teachersRequestVerification = platformCallable(
  teachersRequestVerificationHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __teachersRequestVerificationHandler =
  teachersRequestVerificationHandler;
