import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  log,
  writeAuditEvent,
} from "../shared";

import {
  ensureGoogleClassroomProductionBindings,
  googleClassroomProductionSecrets,
} from "./providers/google-classroom/config-firebase";
import { assertAuthenticatedTeacherForLms, requireNonEmptyString } from "./shared/actor";
import {
  refreshClassRosterMemberships,
  type RefreshClassRosterMembershipsResult,
} from "./roster/membership-capture";

// lmsClassesRefreshRoster
//
// Sprint 29G.5K. Captures/refreshes the trusted upstream Google Classroom
// roster-membership cache for ONE imported class owned by the authenticated
// teacher. This is the reusable primitive behind the "zero-coordination"
// workflow: it is invoked as the server-side roster step of the single
// Import Class workflow, and may be invoked again at other trusted
// server-side lifecycle points to keep membership current. It replaces the
// teacher-visible manual "Sync roster" enrollment reconciliation as the
// normal-path roster operation.
//
// Contract:
// - Authenticated teacher only.
// - Accepts only the LyfeLabz `classId`; the provider, upstream classId,
//   connection, and OAuth credential are all derived server-side.
// - The response carries only deterministic membership counts. It NEVER
//   carries a provider account identifier, an identity hash, a Firebase
//   UID, an email, a display name, or a token.
// - Emits exactly one `lms.rosterMembershipsCaptured` audit event.
// - Creates NO user, NO Auth claim, and NO enrollment for a
//   not-yet-authenticated member. By default the only enrollment side
//   effect is the safe withdrawal of an active enrollment whose member was
//   removed from a fresh, non-empty upstream roster.
//
// Teacher-controlled manual refresh (Class settings > "Refresh roster from
// Google Classroom") additionally passes `reconcileEnrollments: true`: the
// class must be active, and after membership capture the class's
// enrollments are reconciled with the fresh roster - existing ACTIVE
// LyfeLabz students newly in the Classroom class are enrolled through the
// canonical membership-enrollment step, an enrollment that Classroom
// synchronization itself withdrew (durable provenance, current link) is
// restored when the student is back in the Classroom class, and any
// interrupted withdrawal is completed. See
// `roster/enrollment-reconcile.ts`. Import never sends the flag, so its
// behavior is unchanged. The response then also carries
// `enrollmentReconciliation` (counts only).

export type LmsClassesRefreshRosterRequest = {
  readonly classId: string;
  readonly reconcileEnrollments?: boolean;
};

export type LmsClassesRefreshRosterEnrollmentReconciliation = {
  readonly added: number;
  readonly alreadyEnrolled: number;
  readonly reactivated: number;
  readonly awaitingFirstSignIn: number;
  readonly notReactivated: number;
  readonly notMatched: number;
  readonly withdrawn: number;
};

export type LmsClassesRefreshRosterResponse = {
  readonly classId: string;
  readonly membersSeen: number;
  readonly added: number;
  readonly reaffirmed: number;
  readonly removed: number;
  readonly withdrawnEnrollments: number;
  readonly upstreamRosterEmpty: boolean;
  readonly enrollmentReconciliation?: LmsClassesRefreshRosterEnrollmentReconciliation;
};

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

function projectResponse(
  result: RefreshClassRosterMembershipsResult,
): LmsClassesRefreshRosterResponse {
  return {
    classId: result.classId,
    membersSeen: result.membersSeen,
    added: result.added,
    reaffirmed: result.reaffirmed,
    removed: result.removed,
    withdrawnEnrollments: result.withdrawnEnrollments,
    upstreamRosterEmpty: result.upstreamRosterEmpty,
    ...(result.enrollmentReconciliation !== undefined
      ? { enrollmentReconciliation: projectReconciliation(result.enrollmentReconciliation) }
      : {}),
  };
}

function projectReconciliation(
  r: LmsClassesRefreshRosterEnrollmentReconciliation,
): LmsClassesRefreshRosterEnrollmentReconciliation {
  return {
    added: r.added,
    alreadyEnrolled: r.alreadyEnrolled,
    reactivated: r.reactivated,
    awaitingFirstSignIn: r.awaitingFirstSignIn,
    notReactivated: r.notReactivated,
    notMatched: r.notMatched,
    withdrawn: r.withdrawn,
  };
}

async function handler(
  request: CallableRequest<unknown>,
): Promise<LmsClassesRefreshRosterResponse> {
  ensureGoogleClassroomProductionBindings();
  const actor = await assertAuthenticatedTeacherForLms(request);
  if (request.data === null || typeof request.data !== "object") {
    throw new PlatformError(
      "lms.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = request.data as Record<string, unknown>;
  const classId = requireNonEmptyString(
    payload.classId,
    "lms.invalidClassId",
    "classId must be a non-empty string.",
  );
  if (
    payload.reconcileEnrollments !== undefined &&
    typeof payload.reconcileEnrollments !== "boolean"
  ) {
    throw new PlatformError(
      "lms.invalidRequest",
      "reconcileEnrollments must be a boolean when present.",
    );
  }
  const reconcileEnrollments = payload.reconcileEnrollments === true;

  const result = await refreshClassRosterMemberships({
    actor: {
      uid: actor.uid,
      schoolId: actor.schoolId,
      ...(actor.districtId !== undefined ? { districtId: actor.districtId } : {}),
    },
    classId,
    ...(reconcileEnrollments ? { reconcileEnrollments: true } : {}),
  });

  await writeAuditEvent({
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "lms.rosterMembershipsCaptured",
    targetType: "class",
    targetId: result.classId,
    schoolId: actor.schoolId,
    ...(actor.districtId !== undefined ? { districtId: actor.districtId } : {}),
    payload: {
      providerId: result.providerId,
      membersSeen: result.membersSeen,
      added: result.added,
      reaffirmed: result.reaffirmed,
      removed: result.removed,
      withdrawnEnrollments: result.withdrawnEnrollments,
      upstreamRosterEmpty: result.upstreamRosterEmpty,
      ...(result.enrollmentReconciliation !== undefined
        ? { enrollmentReconciliation: projectReconciliation(result.enrollmentReconciliation) }
        : {}),
    },
  });

  safeLog(() =>
    log.info("lms.classesRefreshRoster.ok", {
      actorUserId: actor.uid,
      classId: result.classId,
      membersSeen: result.membersSeen,
      added: result.added,
      removed: result.removed,
    }),
  );

  return projectResponse(result);
}

export const lmsClassesRefreshRoster = platformCallable(
  { secrets: [...googleClassroomProductionSecrets] },
  handler,
);
export const __lmsClassesRefreshRosterHandler = handler;
