import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  log,
  schoolDocRef,
  userRecordDocRef,
  writeAuditEvent,
  writeCustomClaims,
  type TeacherApprovalWrite,
  type UserRecord,
} from "../shared";

// Client-supplied request payload for teachersApproveVerification. The
// administrator names the target teacher explicitly so the callable never
// silently operates on the caller's own record.
export type TeachersApproveVerificationRequest = {
  readonly targetUid: string;
};

// Return payload of a successful approval call. `alreadyActive` is `true`
// when the call is a no-op idempotent replay of a previously successful
// approval, and `false` when this call performed the `pendingVerification`
// -> `active` transition.
export type TeachersApproveVerificationResponse = {
  readonly targetUid: string;
  readonly status: "active";
  readonly role: "teacher";
  readonly schoolId: string;
  readonly alreadyActive: boolean;
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
): TeachersApproveVerificationRequest {
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

async function resolveSchoolDistrictId(schoolId: string): Promise<string> {
  const snapshot = await schoolDocRef(schoolId).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "school-district-mismatch",
      "The target teacher's active school could not be resolved.",
    );
  }
  const school = snapshot.data() as
    | (Record<string, unknown> & { districtId?: unknown })
    | undefined;
  if (!school) {
    throw new PlatformError(
      "school-district-mismatch",
      "The target teacher's active school record was unreadable.",
    );
  }
  const districtId = school.districtId;
  if (typeof districtId !== "string" || districtId.trim().length === 0) {
    throw new PlatformError(
      "district-unassigned",
      "The target teacher's active school is not assigned to a district.",
    );
  }
  return districtId;
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

// teachersApproveVerification
//
// Canonical transition `pendingVerification` -> `active` for teachers, per
// the transition table in PLATFORM_STATE_MACHINE.md §3. Callable only by a
// Platform Administrator (Sprint 2 §7.7).
//
// Every side effect flows through the canonical shared helpers:
//   - target read via `userRecordDocRef(uid).get()`              (typed ref)
//   - status update via `userRecordDocRef(uid).update(...)`      (typed ref)
//   - custom claims via `writeCustomClaims({...})`               (§4 helper)
//   - audit event via `writeAuditEvent({...})`                   (§5 helper)
//
// Idempotency: an already-`active` teacher with role `teacher` and a
// present `schoolId` returns a success response with `alreadyActive: true`.
// No second update is performed, no second claims write is performed, and
// no second `teachers.verificationApproved` audit event is emitted.
async function teachersApproveVerificationHandler(
  request: CallableRequest<unknown>,
): Promise<TeachersApproveVerificationResponse> {
  const { uid: actorUserId } = assertAuthenticatedAdministrator(request);
  const { targetUid } = validateRequest(request.data);

  const target = await loadUserRecord(targetUid);

  if (
    target.status === "active" &&
    target.role === "teacher" &&
    isNonEmptyString(target.schoolId)
  ) {
    safeLog(() =>
      log.info("teachers.verificationApproveIdempotent", {
        actorUserId,
        targetUid,
        schoolId: target.schoolId,
      }),
    );
    return {
      targetUid,
      status: "active",
      role: "teacher",
      schoolId: target.schoolId,
      alreadyActive: true,
    };
  }

  if (target.status !== "pendingVerification") {
    throw new PlatformError(
      "teachers.invalidStatus",
      `Approval requires target status "pendingVerification" (current: "${target.status}").`,
    );
  }

  if (target.role !== "teacher") {
    throw new PlatformError(
      "teachers.invalidTargetRole",
      "Approval target must have role \"teacher\".",
    );
  }

  if (!isNonEmptyString(target.schoolId)) {
    throw new PlatformError(
      "teachers.invalidTargetSchoolId",
      "Approval target must have a schoolId recorded.",
    );
  }

  const schoolId = target.schoolId;
  const districtId = await resolveSchoolDistrictId(schoolId);

  const approval: TeacherApprovalWrite = { status: "active" };
  await userRecordDocRef(targetUid).update(approval);

  await writeCustomClaims({
    uid: targetUid,
    status: "active",
    role: "teacher",
    schoolId,
    districtId,
  });

  await writeAuditEvent({
    actorUserId,
    actorRole: "platformAdministrator",
    action: "teachers.verificationApproved",
    targetType: "user",
    targetId: targetUid,
    schoolId,
    districtId,
  });

  safeLog(() =>
    log.info("teachers.verificationApproved", {
      actorUserId,
      targetUid,
      schoolId,
    }),
  );

  return {
    targetUid,
    status: "active",
    role: "teacher",
    schoolId,
    alreadyActive: false,
  };
}

export const teachersApproveVerification = platformCallable(
  teachersApproveVerificationHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __teachersApproveVerificationHandler =
  teachersApproveVerificationHandler;
