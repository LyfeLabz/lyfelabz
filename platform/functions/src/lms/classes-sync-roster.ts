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
  synchronizeClassRoster,
  type RosterSyncSummary,
} from "./roster/sync-engine";

// lmsClassesSyncRoster
//
// Sprint 23C. Reconciles the roster of ONE linked upstream LMS class
// with the enrollments on ONE LyfeLabz class owned by the authenticated
// teacher.
//
// Contract:
//
// - Authenticated teacher only (assertAuthenticatedTeacherForLms).
// - Accepts only the LyfeLabz `classId`. The provider identifier, the
//   upstream `lmsClassId`, the connection identifier, and every OAuth
//   credential are derived server-side from the persisted class link
//   and connection records; a client can never inject them.
// - The client-visible response carries only deterministic
//   reconciliation counts. It never carries a provider account
//   identifier, a Firebase UID, an email, a display name, an OAuth
//   token, or an external identity document ID.
// - Emits exactly one `lms.rosterSynchronized` audit event per
//   completed reconciliation, targeting the LyfeLabz class.

export type LmsClassesSyncRosterRequest = {
  readonly classId: string;
};

export type LmsClassesSyncRosterResponse = {
  readonly classId: string;
  readonly added: number;
  readonly reactivated: number;
  readonly unchanged: number;
  readonly withdrawn: number;
  readonly unresolved: number;
  readonly skipped: number;
  readonly upstreamRosterEmpty: boolean;
};

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

function projectResponse(summary: RosterSyncSummary): LmsClassesSyncRosterResponse {
  return {
    classId: summary.classId,
    added: summary.added,
    reactivated: summary.reactivated,
    unchanged: summary.unchanged,
    withdrawn: summary.withdrawn,
    unresolved: summary.unresolved,
    skipped: summary.skipped,
    upstreamRosterEmpty: summary.upstreamRosterEmpty,
  };
}

async function handler(
  request: CallableRequest<unknown>,
): Promise<LmsClassesSyncRosterResponse> {
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

  const summary = await synchronizeClassRoster({
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
    action: "lms.rosterSynchronized",
    targetType: "class",
    targetId: summary.classId,
    schoolId: actor.schoolId,
    ...(actor.districtId !== undefined ? { districtId: actor.districtId } : {}),
    payload: {
      providerId: summary.providerId,
      added: summary.added,
      reactivated: summary.reactivated,
      unchanged: summary.unchanged,
      withdrawn: summary.withdrawn,
      unresolved: summary.unresolved,
      skipped: summary.skipped,
      upstreamRosterEmpty: summary.upstreamRosterEmpty,
      unresolvedPresent: summary.unresolved > 0,
    },
  });

  safeLog(() =>
    log.info("lms.classesSyncRoster.ok", {
      actorUserId: actor.uid,
      classId: summary.classId,
      added: summary.added,
      unchanged: summary.unchanged,
      withdrawn: summary.withdrawn,
      unresolved: summary.unresolved,
      skipped: summary.skipped,
    }),
  );

  return projectResponse(summary);
}

export const lmsClassesSyncRoster = platformCallable(
  { secrets: [...googleClassroomProductionSecrets] },
  handler,
);
export const __lmsClassesSyncRosterHandler = handler;
