import { FieldValue } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  assertActivePlatformAdministratorInTransaction,
  platformCallable,
  PlatformError,
  log,
  requireActivePlatformAdministrator,
  runFirestoreTransaction,
  userRecordDocRef,
  writeAuditEventInTransaction,
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
// Phase 8G.12A - transactional administrator authority. The administrator
// re-validation, the target read, the `pendingVerification` -> `provisioned`
// update, and the `teachers.verificationDenied` audit all commit in ONE
// Firestore transaction, so an administrator demoted/suspended after the cheap
// pre-transaction guard cannot deny a teacher (the transaction observes the
// demotion and writes nothing).
//
// Idempotency: an already-`provisioned` target returns a success response
// with `alreadyProvisioned: true`. No second update is performed and no
// second `teachers.verificationDenied` audit event is emitted. The state
// on the user document and the audit stream are unchanged.
async function teachersDenyVerificationHandler(
  request: CallableRequest<unknown>,
): Promise<TeachersDenyVerificationResponse> {
  // Phase 8G.12 admin-claim hardening (cheap pre-transaction gate). The
  // authoritative check is re-run inside the transaction below.
  const { uid: actorUserId } = await requireActivePlatformAdministrator(
    request,
    {
      unauthenticatedCode: "teachers.unauthenticated",
      unauthorizedCode: "teachers.unauthorized",
    },
  );
  const { targetUid } = validateRequest(request.data);

  const outcome = await runFirestoreTransaction<{
    readonly alreadyProvisioned: boolean;
    readonly schoolId: string | null;
  }>(async (tx) => {
    // -- Reads (all before any write, per Firestore transaction rules) --

    // Authoritative, mutation-time administrator revalidation (closes the
    // demotion race).
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

    if (target.status === "provisioned") {
      return { alreadyProvisioned: true, schoolId: null };
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
        'Denial target must have role "teacher".',
      );
    }
    if (!isNonEmptyString(target.schoolId)) {
      throw new PlatformError(
        "teachers.invalidTargetSchoolId",
        "Denial target must have a schoolId recorded.",
      );
    }
    const schoolId = target.schoolId;

    // -- Writes --

    const denial: TeacherDenialWrite = {
      status: "provisioned",
      role: FieldValue.delete(),
      schoolId: FieldValue.delete(),
      displayName: FieldValue.delete(),
    };
    tx.update(userRecordDocRef(targetUid), denial);

    writeAuditEventInTransaction(tx, {
      actorUserId,
      actorRole: "platformAdministrator",
      action: "teachers.verificationDenied",
      targetType: "user",
      targetId: targetUid,
      schoolId,
    });

    return { alreadyProvisioned: false, schoolId };
  });

  if (outcome.alreadyProvisioned) {
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

  safeLog(() =>
    log.info("teachers.verificationDenied", {
      actorUserId,
      targetUid,
      schoolId: outcome.schoolId,
    }),
  );

  return {
    targetUid,
    status: "provisioned",
    schoolId: outcome.schoolId,
    alreadyProvisioned: false,
  };
}

export const teachersDenyVerification = platformCallable(
  teachersDenyVerificationHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __teachersDenyVerificationHandler =
  teachersDenyVerificationHandler;
