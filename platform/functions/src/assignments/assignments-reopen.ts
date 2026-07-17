import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  assignmentReopenDocRef,
  assignmentDocRef,
  log,
  requireDistrictContext,
  writeAuditEvent,
  type AssignmentReopenWrite,
  type AssignmentRecord,
} from "../shared";

// Client-supplied request payload for assignmentsReopen. Only the target
// assignment identifier is carried. Ownership fields are never carried
// on the request and are derived server-side from the record.
export type AssignmentsReopenRequest = {
  readonly assignmentId: string;
};

// Return payload of a successful reopen call. `alreadyPublished` is
// `true` when the record is already in `published` and no write is
// required; `false` when this call advanced the lifecycle field from
// `closed` back to `published`.
export type AssignmentsReopenResponse = {
  readonly assignmentId: string;
  readonly status: "published";
  readonly alreadyPublished: boolean;
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

function validateRequest(data: unknown): AssignmentsReopenRequest {
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

// assignmentsReopen
//
// Inverse of assignmentsClose per Data Model 3.6 lifecycle: the
// `closed` -> `published` transition. Callable by the owning teacher
// only. The write is intentionally narrow so the reopen path cannot be
// laundered into a metadata edit, an ownership change, or a lesson
// change; recipients, attempts, sessions, summaries, and answer keys
// are never touched.
//
// Every side effect flows through the canonical shared helpers:
//   - record read via `assignmentDocRef(...).get()`               (typed ref)
//   - narrow reopen write via `assignmentReopenDocRef(...).update(...)`
//                                                                 (typed ref)
//   - audit event via `writeAuditEvent({...})`                    (5 helper)
//
// Idempotency: an already-`published` record returns
// `alreadyPublished: true` with no second write and no second audit
// event. Every other current status (draft, archived) is rejected with
// `assignments.invalidTransition`.
async function assignmentsReopenHandler(
  request: CallableRequest<unknown>,
): Promise<AssignmentsReopenResponse> {
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

  if (existing.status === "published") {
    safeLog(() =>
      log.info("assignments.reopenIdempotent", {
        actorUserId: actor.uid,
        assignmentId: input.assignmentId,
      }),
    );
    return {
      assignmentId: input.assignmentId,
      status: "published",
      alreadyPublished: true,
    };
  }

  if (existing.status !== "closed") {
    throw new PlatformError(
      "assignments.invalidTransition",
      `Cannot transition from "${existing.status}" to "published".`,
    );
  }

  const write: AssignmentReopenWrite = { status: "published" };
  await assignmentReopenDocRef(input.assignmentId).update(write);

  await writeAuditEvent({
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "assignments.reopened",
    targetType: "assignment",
    targetId: input.assignmentId,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
    payload: { classId: existing.classId },
  });

  safeLog(() =>
    log.info("assignments.reopened", {
      actorUserId: actor.uid,
      assignmentId: input.assignmentId,
    }),
  );

  return {
    assignmentId: input.assignmentId,
    status: "published",
    alreadyPublished: false,
  };
}

export const assignmentsReopen = platformCallable(assignmentsReopenHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assignmentsReopenHandler = assignmentsReopenHandler;
