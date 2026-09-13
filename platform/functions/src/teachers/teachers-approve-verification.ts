import { type CallableRequest } from "firebase-functions/v2/https";

import {
  assertActivePlatformAdministratorInTransaction,
  assertTeacherPilotAllowlistedInTransaction,
  platformCallable,
  PlatformError,
  log,
  requireActivePlatformAdministrator,
  runFirestoreTransaction,
  schoolDocRef,
  userRecordDocRef,
  writeAuditEventInTransaction,
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
//   - administrator revalidation via `assertActivePlatformAdministratorInTransaction`
//   - target read/update via `tx.get`/`tx.update(userRecordDocRef(uid), ...)`
//   - allowlist read via `assertTeacherPilotAllowlistedInTransaction(tx, ...)`
//   - audit event via `writeAuditEventInTransaction(tx, {...})`  (§5 helper)
//   - custom claims via `writeCustomClaims({...})`               (§4 helper)
//
// Phase 8G.12A - transactional administrator authority. The administrator
// authority check, the target read, the allowlist check, the district
// resolution, the `pendingVerification` -> `active` status update, and the
// `teachers.verificationApproved` audit all happen in ONE Firestore
// transaction. An administrator demoted/suspended after the cheap
// pre-transaction guard but before the transaction commits is observed by the
// in-transaction re-validation, so the status transition and its audit do not
// commit. Custom claims (an Auth-side write, not part of the Firestore
// transaction) are issued only AFTER the durable transaction commits, so a
// refused transaction never issues teacher claims.
//
// Idempotency: an already-`active` teacher with role `teacher` and a
// present `schoolId` returns a success response with `alreadyActive: true`.
// No second update is performed, no second claims write is performed, and
// no second `teachers.verificationApproved` audit event is emitted.
async function teachersApproveVerificationHandler(
  request: CallableRequest<unknown>,
): Promise<TeachersApproveVerificationResponse> {
  // Phase 8G.12 admin-claim hardening (cheap pre-transaction gate): reject a
  // non-administrator caller before opening a transaction. The authoritative
  // check is re-run inside the transaction below.
  const { uid: actorUserId } = await requireActivePlatformAdministrator(
    request,
    {
      unauthenticatedCode: "teachers.unauthenticated",
      unauthorizedCode: "teachers.unauthorized",
    },
  );
  const { targetUid } = validateRequest(request.data);

  type ApproveOutcome =
    | { readonly alreadyActive: true; readonly schoolId: string }
    | {
        readonly alreadyActive: false;
        readonly schoolId: string;
        readonly districtId: string;
      };

  const outcome = await runFirestoreTransaction<ApproveOutcome>(async (tx) => {
    // -- Reads (all before any write, per Firestore transaction rules) --

    // Authoritative, mutation-time administrator revalidation (closes the
    // demotion race): a caller demoted/suspended after the cheap guard is
    // refused here and no status transition or audit is written.
    await assertActivePlatformAdministratorInTransaction(tx, actorUserId, {
      unauthorizedCode: "teachers.unauthorized",
    });

    const targetSnapshot = await tx.get(userRecordDocRef(targetUid));
    const target: UserRecord | undefined = targetSnapshot.exists
      ? targetSnapshot.data()
      : undefined;
    if (!target) {
      throw new PlatformError(
        "teachers.userNotFound",
        "Target teacher was not found.",
      );
    }

    if (
      target.status === "active" &&
      target.role === "teacher" &&
      isNonEmptyString(target.schoolId)
    ) {
      return { alreadyActive: true, schoolId: target.schoolId };
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
        'Approval target must have role "teacher".',
      );
    }
    if (!isNonEmptyString(target.schoolId)) {
      throw new PlatformError(
        "teachers.invalidTargetSchoolId",
        "Approval target must have a schoolId recorded.",
      );
    }
    const schoolId = target.schoolId;

    // Sprint 29C pilot allowlist guardrail, now evaluated inside the same
    // transaction. The target email is read from the authoritative
    // `users/{uid}` record, never the request payload.
    await assertTeacherPilotAllowlistedInTransaction(tx, target.email);

    // District resolution, read transactionally from the canonical school.
    const schoolSnapshot = await tx.get(schoolDocRef(schoolId));
    const school = schoolSnapshot.exists
      ? (schoolSnapshot.data() as
          | (Record<string, unknown> & { districtId?: unknown })
          | undefined)
      : undefined;
    if (!school) {
      throw new PlatformError(
        "school-district-mismatch",
        "The target teacher's active school could not be resolved.",
      );
    }
    const districtId = school.districtId;
    if (typeof districtId !== "string" || districtId.trim().length === 0) {
      throw new PlatformError(
        "district-unassigned",
        "The target teacher's active school is not assigned to a district.",
      );
    }

    // -- Writes --

    const approval: TeacherApprovalWrite = { status: "active" };
    tx.update(userRecordDocRef(targetUid), approval);

    writeAuditEventInTransaction(tx, {
      actorUserId,
      actorRole: "platformAdministrator",
      action: "teachers.verificationApproved",
      targetType: "user",
      targetId: targetUid,
      schoolId,
      districtId,
    });

    return { alreadyActive: false, schoolId, districtId };
  });

  if (outcome.alreadyActive) {
    safeLog(() =>
      log.info("teachers.verificationApproveIdempotent", {
        actorUserId,
        targetUid,
        schoolId: outcome.schoolId,
      }),
    );
    return {
      targetUid,
      status: "active",
      role: "teacher",
      schoolId: outcome.schoolId,
      alreadyActive: true,
    };
  }

  // Auth-side claims issuance AFTER the durable transaction commits.
  await writeCustomClaims({
    uid: targetUid,
    status: "active",
    role: "teacher",
    schoolId: outcome.schoolId,
    districtId: outcome.districtId,
  });

  safeLog(() =>
    log.info("teachers.verificationApproved", {
      actorUserId,
      targetUid,
      schoolId: outcome.schoolId,
    }),
  );

  return {
    targetUid,
    status: "active",
    role: "teacher",
    schoolId: outcome.schoolId,
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
