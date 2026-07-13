import { onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  assignmentCloseDocRef,
  assignmentDocRef,
  log,
  requireDistrictContext,
  writeAuditEvent,
  type AssignmentCloseWrite,
  type AssignmentRecord,
} from "../shared";

// Client-supplied request payload for assignmentsClose. Only the target
// assignment identifier is carried. Ownership fields are never carried on
// the request and are derived server-side from the record.
export type AssignmentsCloseRequest = {
  readonly assignmentId: string;
};

// Return payload of a successful close call. `alreadyClosed` is `true`
// when the record is already in `closed` and no write is required; `false`
// when this call advanced the lifecycle field from `published` to
// `closed`.
export type AssignmentsCloseResponse = {
  readonly assignmentId: string;
  readonly status: "closed";
  readonly alreadyClosed: boolean;
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
// Canonical close transition for assignments/{assignmentId} per Data Model
// §3.6 lifecycle: `published` -> `closed`. Callable by the owning teacher
// only.
//
// Every side effect flows through the canonical shared helpers:
//   - record read via `assignmentDocRef(...).get()`               (typed ref)
//   - narrow close write via `assignmentCloseDocRef(...).update(...)`
//                                                                 (typed ref)
//   - audit event via `writeAuditEvent({...})`                    (§5 helper)
//
// Idempotency: an already-`closed` record returns `alreadyClosed: true`
// with no second write and no second audit event. Every other current
// status (draft, archived) is rejected with `assignments.invalidTransition`.
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

  if (existing.status !== "published") {
    throw new PlatformError(
      "assignments.invalidTransition",
      `Cannot transition from "${existing.status}" to "closed".`,
    );
  }

  const write: AssignmentCloseWrite = { status: "closed" };
  await assignmentCloseDocRef(input.assignmentId).update(write);

  await writeAuditEvent({
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "assignments.closed",
    targetType: "assignment",
    targetId: input.assignmentId,
    schoolId: actor.schoolId,
    payload: { classId: existing.classId },
  });

  safeLog(() =>
    log.info("assignments.closed", {
      actorUserId: actor.uid,
      assignmentId: input.assignmentId,
    }),
  );

  return {
    assignmentId: input.assignmentId,
    status: "closed",
    alreadyClosed: false,
  };
}

export const assignmentsClose = onCall(assignmentsCloseHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assignmentsCloseHandler = assignmentsCloseHandler;
