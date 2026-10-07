import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  assignmentDocRef,
  log,
  requireDistrictContext,
  type AssignmentRecord,
} from "../shared";

// Client-supplied request payload for assignmentsClose. Only the target
// assignment identifier is carried. Ownership fields are never carried on
// the request and are derived server-side from the record.
export type AssignmentsCloseRequest = {
  readonly assignmentId: string;
};

// Return payload of a successful close call. Only a legacy record that is
// already `closed` can succeed, so `alreadyClosed` is always `true`. The
// field keeps the established response shape for cached legacy clients.
export type AssignmentsCloseResponse = {
  readonly assignmentId: string;
  readonly status: "closed";
  readonly alreadyClosed: true;
};

const ASSIGNMENT_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function assertActiveTeacherInDistrict(
  request: CallableRequest<unknown>,
): Promise<{ readonly uid: string; readonly schoolId: string; readonly districtId: string }> {
  const context = await requireDistrictContext(request);
  if (context.role !== "teacher") {
    throw new PlatformError(
      "role-forbidden",
      "Caller must be an active teacher.",
    );
  }
  return { uid: context.uid, schoolId: context.schoolId, districtId: context.districtId };
}

function validateRequest(data: unknown): AssignmentsCloseRequest {
  if (data === null || typeof data !== "object") {
    throw new PlatformError(
      "assignments.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;
  if (!isNonEmptyString(payload.assignmentId)) {
    throw new PlatformError(
      "assignments.invalidAssignmentId",
      "assignmentId must be a non-empty string.",
    );
  }
  const assignmentId = payload.assignmentId.trim();
  if (!ASSIGNMENT_ID_PATTERN.test(assignmentId)) {
    throw new PlatformError(
      "assignments.invalidAssignmentId",
      "assignmentId must be a URL-safe token.",
    );
  }
  return { assignmentId };
}

async function loadAssignment(assignmentId: string): Promise<AssignmentRecord> {
  const snapshot = await assignmentDocRef(assignmentId).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "assignments.notFound",
      "Assignment was not found.",
    );
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError(
      "assignments.notFound",
      "Assignment record was empty.",
    );
  }
  return data;
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

// assignmentsClose
//
// Retired lifecycle transition, kept exported for compatibility only.
//
// Teacher-controlled closing is no longer part of the assignment
// lifecycle: a published assignment stays available to its recipients for
// the lifetime of the active class (same-lesson reassignment, not closing,
// is what makes an earlier occurrence historical). The Teacher Workspace no
// longer offers Close, but a stale cached client may still invoke this
// callable, so it remains deployed (deleting it would be a Functions
// deletion operation) and can NEVER perform a `published` -> `closed`
// transition. This handler holds no write capability at all: no
// assignment write ref and no audit write.
//
// Behavior, in order:
//   - teacher role, district context, request shape, existence, and
//     ownership are validated exactly as before;
//   - a legacy record that is already `closed` returns
//     `alreadyClosed: true` (the established idempotent response, no
//     write, no audit event); `assignmentsReopen` remains its recovery path;
//   - a `published` record is refused with `assignments.closeRetired`;
//   - every other status (draft, archived) is still refused with
//     `assignments.invalidTransition`.
async function assignmentsCloseHandler(
  request: CallableRequest<unknown>,
): Promise<AssignmentsCloseResponse> {
  const actor = await assertActiveTeacherInDistrict(request);
  const input = validateRequest(request.data);

  const existing = await loadAssignment(input.assignmentId);

  if (
    existing.teacherId !== actor.uid ||
    existing.schoolId !== actor.schoolId
  ) {
    throw new PlatformError(
      "assignments.forbidden",
      "Caller does not own this assignment.",
    );
  }

  if (existing.status === "closed") {
    safeLog(() =>
      log.info("assignments.closeIdempotent", {
        actorUserId: actor.uid,
        assignmentId: input.assignmentId,
      }),
    );
    return {
      assignmentId: input.assignmentId,
      status: "closed",
      alreadyClosed: true,
    };
  }

  if (existing.status === "published") {
    safeLog(() =>
      log.info("assignments.closeRetiredRefused", {
        actorUserId: actor.uid,
        assignmentId: input.assignmentId,
      }),
    );
    throw new PlatformError(
      "assignments.closeRetired",
      "Assignments can no longer be closed. A published assignment stays available for the life of its class.",
    );
  }

  throw new PlatformError(
    "assignments.invalidTransition",
    `Cannot transition from "${existing.status}" to "closed".`,
  );
}

export const assignmentsClose = platformCallable(assignmentsCloseHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assignmentsCloseHandler = assignmentsCloseHandler;
