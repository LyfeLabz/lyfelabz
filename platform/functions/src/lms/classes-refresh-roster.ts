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
//   not-yet-authenticated member. The only enrollment side effect is the
//   safe withdrawal of an active enrollment whose member was removed from a
//   fresh, non-empty upstream roster.

export type LmsClassesRefreshRosterRequest = {
  readonly classId: string;
};

export type LmsClassesRefreshRosterResponse = {
  readonly classId: string;
  readonly membersSeen: number;
  readonly added: number;
  readonly reaffirmed: number;
  readonly removed: number;
  readonly withdrawnEnrollments: number;
  readonly upstreamRosterEmpty: boolean;
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
  };
}

async function handler(
  request: CallableRequest<unknown>,
): Promise<LmsClassesRefreshRosterResponse> {
  ensureGoogleClassroomProductionBindings();
  const actor = assertAuthenticatedTeacherForLms(request);
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

  const result = await refreshClassRosterMemberships({
    actor: {
      uid: actor.uid,
      schoolId: actor.schoolId,
      ...(actor.districtId !== undefined ? { districtId: actor.districtId } : {}),
    },
    classId,
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
