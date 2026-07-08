import { FieldValue } from "firebase-admin/firestore";
import { onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  log,
  userRecordDocRef,
  writeAuditEvent,
  type TeacherDenialWrite,
  type UserRecord,
} from "../shared";

// Client-supplied request payload for teachersDenyVerification. The
// administrator names the target teacher explicitly so the callable never
// silently operates on the caller's own record.
export type TeachersDenyVerificationRequest = {
  readonly targetUid: string;
};

// Return payload of a successful denial call. `alreadyProvisioned` is
// `true` when the call is a no-op idempotent replay of a previously
// successful denial, and `false` when this call performed the
// `pendingVerification` -> `provisioned` transition.
export type TeachersDenyVerificationResponse = {
  readonly targetUid: string;
  readonly status: "provisioned";
  readonly schoolId: string | null;
  readonly alreadyProvisioned: boolean;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertAuthenticatedAdministrator(
  request: CallableRequest<unknown>,
): { readonly uid: string } {
  const auth = request.auth;
  if (!auth || !isNonEmptyString(auth.uid)) {
    throw new PlatformError(
      "teachers.unauthenticated",
      "An authenticated caller is required.",
    );
  }
  const token = auth.token as { readonly role?: unknown } | undefined;
  if (!token || token.role !== "platformAdministrator") {
    throw new PlatformError(
      "teachers.unauthorized",
      "Caller must be a Platform Administrator.",
    );
  }
  return { uid: auth.uid };
}

function validateRequest(
  data: unknown,
): TeachersDenyVerificationRequest {
  if (data === null || typeof data !== "object") {
    throw new PlatformError(
      "teachers.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;
  if (!isNonEmptyString(payload.targetUid)) {
    throw new PlatformError(
      "teachers.invalidTargetUid",
      "targetUid must be a non-empty string.",
    );
  }
  return { targetUid: payload.targetUid.trim() };
}

async function loadUserRecord(uid: string): Promise<UserRecord> {
  const snapshot = await userRecordDocRef(uid).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "teachers.userNotFound",
      "Target teacher was not found.",
    );
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError(
      "teachers.userNotFound",
      "Target teacher record was empty.",
    );
  }
  return data;
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

// teachersDenyVerification
//
// Canonical transition `pendingVerification` -> `provisioned` for
// teachers, per the transition table in PLATFORM_STATE_MACHINE.md §3.
// Callable only by a Platform Administrator (Sprint 2 §7.7).
//
// Custom claims are intentionally NOT issued at this step. Denial returns
// the caller to the pre-activation state, and the absence of claims is the
// canonical signal that the user has no active authorization
// (Cloud Function Charter §2).
//
// The transition returns the record to `provisioned`, which per Data
// Model §3.1 means the activation-required fields (role, schoolId,
// displayName) are no longer present. Those fields are cleared using the
// canonical `FieldValue.delete()` sentinel on the same typed reference.
//
// Idempotency: an already-`provisioned` target returns a success response
// with `alreadyProvisioned: true`. No second update is performed and no
// second `teachers.verificationDenied` audit event is emitted. The state
// on the user document and the audit stream are unchanged.
async function teachersDenyVerificationHandler(
  request: CallableRequest<unknown>,
): Promise<TeachersDenyVerificationResponse> {
  const { uid: actorUserId } = assertAuthenticatedAdministrator(request);
  const { targetUid } = validateRequest(request.data);

  const target = await loadUserRecord(targetUid);

  if (target.status === "provisioned") {
    safeLog(() =>
      log.info("teachers.verificationDenyIdempotent", {
        actorUserId,
        targetUid,
      }),
    );
    return {
      targetUid,
      status: "provisioned",
      schoolId: null,
      alreadyProvisioned: true,
    };
  }

  if (target.status !== "pendingVerification") {
    throw new PlatformError(
      "teachers.invalidStatus",
      `Denial requires target status "pendingVerification" (current: "${target.status}").`,
    );
  }

  if (target.role !== "teacher") {
    throw new PlatformError(
      "teachers.invalidTargetRole",
      "Denial target must have role \"teacher\".",
    );
  }

  if (!isNonEmptyString(target.schoolId)) {
    throw new PlatformError(
      "teachers.invalidTargetSchoolId",
      "Denial target must have a schoolId recorded.",
    );
  }

  const schoolId = target.schoolId;

  const denial: TeacherDenialWrite = {
    status: "provisioned",
    role: FieldValue.delete(),
    schoolId: FieldValue.delete(),
    displayName: FieldValue.delete(),
  };
  await userRecordDocRef(targetUid).update(denial);

  await writeAuditEvent({
    actorUserId,
    actorRole: "platformAdministrator",
    action: "teachers.verificationDenied",
    targetType: "user",
    targetId: targetUid,
    schoolId,
  });

  safeLog(() =>
    log.info("teachers.verificationDenied", {
      actorUserId,
      targetUid,
      schoolId,
    }),
  );

  return {
    targetUid,
    status: "provisioned",
    schoolId,
    alreadyProvisioned: false,
  };
}

export const teachersDenyVerification = onCall(
  teachersDenyVerificationHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __teachersDenyVerificationHandler =
  teachersDenyVerificationHandler;
