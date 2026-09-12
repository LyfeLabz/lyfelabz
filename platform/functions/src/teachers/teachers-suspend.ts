import { type CallableRequest } from "firebase-functions/v2/https";

import {
  clearCustomClaims,
  log,
  platformCallable,
  PlatformError,
  revokeUserRefreshTokens,
  runFirestoreTransaction,
  schoolDocRef,
  userRecordDocRef,
  writeAuditEventInTransaction,
  type TeacherSuspensionWrite,
} from "../shared";

// Client-supplied request payload for teachersSuspend. The administrator
// names the target teacher explicitly by UID and supplies nothing else. No
// authoritative identity field (email, role, status, schoolId, districtId)
// is accepted from the caller; every such value is resolved server-side
// from the canonical `users/{uid}` record so it cannot be spoofed.
export type TeachersSuspendRequest = {
  readonly targetUid: string;
};

// Return payload of a successful suspension call. `alreadySuspended` is
// `true` when the call was an idempotent replay against an already-suspended
// teacher (no lifecycle transition, no audit event; Auth cleanup re-run),
// and `false` when this call performed the `active` -> `suspended`
// transition.
export type TeachersSuspendResponse = {
  readonly targetUid: string;
  readonly status: "suspended";
  readonly role: "teacher";
  readonly alreadySuspended: boolean;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Cheap request-boundary gate establishing the CLAIMED caller identity and
// administrator role from the signed token. This is intentionally NOT the
// authoritative administrator check: the token claim can be stale. The
// authoritative `users/{adminUid}` validation is performed INSIDE the
// suspension transaction (Phase 8G.3 correction for the admin TOCTOU
// finding), so an administrator who is suspended/demoted after this cheap
// gate but before the transaction commits cannot suspend the target.
function assertClaimedAdministrator(
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

function validateRequest(data: unknown): TeachersSuspendRequest {
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

// Auth-side cleanup that establishes the desired suspended Auth state:
// no authorization custom claims and no usable refresh tokens. Both helpers
// are idempotent, so this runs both on the first successful transition and
// on every idempotent replay to repair a partially completed prior
// suspension. Order matches the ratified sequence: clear claims, then revoke
// refresh tokens. The Firebase Auth identity is never deleted.
async function repairSuspendedAuthState(uid: string): Promise<void> {
  await clearCustomClaims(uid);
  await revokeUserRefreshTokens(uid);
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle. A logger failure must never
    // become the outcome of the callable.
  }
}

// Outcome of the durable transaction. `wrote` is `true` when this call
// performed the `active` -> `suspended` transition; `false` when the target
// was already suspended (idempotent replay or concurrent loser).
type SuspendTransactionOutcome = { readonly wrote: boolean };

// teachersSuspend
//
// Canonical administrative transition `active` -> `suspended` for teachers,
// per the transition table in PLATFORM_STATE_MACHINE.md §3. Callable only by
// an authenticated `platformAdministrator` whose authority is confirmed
// against the authoritative `users/{adminUid}` record.
//
// Suspension is a temporary administrative withholding of access. It
// preserves Firebase Auth identity, the canonical user record (every field
// except `status`), teacher-owned instructional data, LMS connections and
// links, rosters, enrollments, assignments, submissions, attempts,
// preferences, and all history/audit records. It never disconnects Google
// Classroom and never deletes anything.
//
// Durable boundary (one Firestore transaction). Everything authoritative is
// read and validated INSIDE the transaction so there is no time-of-check /
// time-of-use gap (Phase 8G.3):
//   1. the administrator record is read and validated as an `active`
//      `platformAdministrator` whose `authUid` matches the caller;
//   2. the target record is read and validated as a well-formed `teacher`
//      whose `authUid` matches the target UID;
//   3. the target's school document is read and its `districtId` resolved;
//   4. the `active` -> `suspended` status update and exactly one
//      `users.suspended` audit event (carrying the same transactionally
//      observed school/district context) are committed atomically.
// If the administrator becomes inactive/suspended/demoted, or the target
// context changes, before commit, the transaction observes it and suspends
// nothing. Firestore transaction isolation guarantees concurrent/replayed
// requests produce exactly one transition and one audit event; the losing
// request observes the already-suspended state and takes the idempotent path.
//
// After the durable boundary, Auth-side cleanup runs: custom claims are
// cleared and refresh tokens are revoked. These steps are idempotently
// repairable - if either fails after the durable transition, the user
// remains `suspended`, authorization boundaries already fail closed on the
// authoritative status, and a subsequent call against the suspended teacher
// re-runs the cleanup WITHOUT emitting a second audit event or repeating the
// lifecycle transition.
//
// Security: claim clearing and refresh-token revocation are not sufficient
// on their own, because an already-issued ID token keeps stale teacher
// claims until it expires. The affected authorization boundaries (the LMS
// actor gate and the teacher-side Firestore Rules) consult the authoritative
// `users/{uid}.status`, so suspension fails closed immediately.
async function teachersSuspendHandler(
  request: CallableRequest<unknown>,
): Promise<TeachersSuspendResponse> {
  const { uid: actorUserId } = assertClaimedAdministrator(request);
  const { targetUid } = validateRequest(request.data);

  // An administrator may never suspend themselves. (An administrator is not
  // a teacher target either, but this check is explicit and independent of
  // the role check below.)
  if (targetUid === actorUserId) {
    throw new PlatformError(
      "teachers.selfTargetForbidden",
      "An administrator cannot suspend their own account.",
    );
  }

  const outcome = await runFirestoreTransaction<SuspendTransactionOutcome>(
    async (tx) => {
      // -- Reads (all before any write, per Firestore transaction rules) --

      // 1. Authoritative administrator validation. The signed admin claim
      //    is not sufficient; the caller must be an `active`
      //    `platformAdministrator` in the canonical record, with a
      //    structurally consistent `authUid`. This closes the admin TOCTOU:
      //    a concurrently suspended/demoted admin fails here and no target
      //    transition or audit occurs.
      const adminSnapshot = await tx.get(userRecordDocRef(actorUserId));
      const admin = adminSnapshot.exists ? adminSnapshot.data() : undefined;
      if (
        !admin ||
        admin.authUid !== actorUserId ||
        admin.status !== "active" ||
        admin.role !== "platformAdministrator"
      ) {
        throw new PlatformError(
          "teachers.unauthorized",
          "Caller is not an active Platform Administrator.",
        );
      }

      // 2. Authoritative target validation, read transactionally.
      const targetSnapshot = await tx.get(userRecordDocRef(targetUid));
      const target = targetSnapshot.exists ? targetSnapshot.data() : undefined;
      if (!target) {
        throw new PlatformError(
          "teachers.userNotFound",
          "Target teacher was not found.",
        );
      }
      // Fail closed on a malformed/contradictory record: `authUid` is a
      // canonical invariant (it equals the document id / uid). A record whose
      // `authUid` is missing or does not match the target UID is not a
      // trustworthy identity and must never be suspended.
      if (target.authUid !== targetUid) {
        throw new PlatformError(
          "teachers.invalidTargetRecord",
          "Target record identity is malformed.",
        );
      }
      // Only teachers are suspendable through this callable. A non-teacher
      // target (student, another administrator, or an unroled account) is
      // refused, which also prevents an administrator from suspending another
      // administrator here.
      if (target.role !== "teacher") {
        throw new PlatformError(
          "teachers.invalidTargetRole",
          'Suspension target must have role "teacher".',
        );
      }
      if (!isNonEmptyString(target.schoolId)) {
        throw new PlatformError(
          "teachers.invalidTargetSchoolId",
          "Suspension target must have a schoolId recorded.",
        );
      }
      const schoolId = target.schoolId;

      // Idempotent replay / concurrent loser: the target is already
      // suspended. Do not transition and do not emit a second audit event;
      // the Auth cleanup is re-run after the transaction to repair a
      // previously interrupted suspension.
      if (target.status === "suspended") {
        return { wrote: false };
      }
      // Only `active` teachers may transition to `suspended`. Every other
      // source lifecycle state (provisioned, pendingVerification, archived)
      // is an invalid transition and is refused before any write.
      if (target.status !== "active") {
        throw new PlatformError(
          "teachers.invalidStatus",
          `Suspension requires target status "active" (current: "${target.status}").`,
        );
      }

      // 3. Authoritative district context, resolved transactionally from the
      //    canonical school document so the audit reflects the same state the
      //    transition observed (Phase 8G.3 - no stale pre-transaction read).
      const schoolSnapshot = await tx.get(schoolDocRef(schoolId));
      const school = schoolSnapshot.exists
        ? (schoolSnapshot.data() as
            | (Record<string, unknown> & { districtId?: unknown })
            | undefined)
        : undefined;
      if (!school) {
        throw new PlatformError(
          "school-district-mismatch",
          "The target teacher's school could not be resolved.",
        );
      }
      const districtId = school.districtId;
      if (!isNonEmptyString(districtId)) {
        throw new PlatformError(
          "district-unassigned",
          "The target teacher's school is not assigned to a district.",
        );
      }

      // -- Writes --

      const write: TeacherSuspensionWrite = { status: "suspended" };
      tx.update(userRecordDocRef(targetUid), write);

      // Exactly one audit event, atomic with the transition, carrying the
      // transactionally observed school/district context.
      writeAuditEventInTransaction(tx, {
        actorUserId,
        actorRole: "platformAdministrator",
        action: "users.suspended",
        targetType: "user",
        targetId: targetUid,
        schoolId,
        districtId,
        payload: { previousStatus: "active", role: "teacher" },
      });

      return { wrote: true };
    },
  );

  // Auth cleanup runs after the durable boundary for both the first
  // transition and the concurrent-loser (already-suspended) case. The
  // administrator was authoritatively validated inside the same transaction,
  // so reaching this point means an authorized suspension exists. Idempotent
  // by construction, so re-running it is safe.
  await repairSuspendedAuthState(targetUid);

  if (outcome.wrote) {
    safeLog(() =>
      log.info("teachers.suspended", { actorUserId, targetUid }),
    );
  } else {
    safeLog(() =>
      log.info("teachers.suspendIdempotent", { actorUserId, targetUid }),
    );
  }

  return {
    targetUid,
    status: "suspended",
    role: "teacher",
    alreadySuspended: !outcome.wrote,
  };
}

export const teachersSuspend = platformCallable(teachersSuspendHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __teachersSuspendHandler = teachersSuspendHandler;
