import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  assignmentArchiveDocRef,
  assignmentDocRef,
  log,
  requireDistrictContext,
  writeAuditEvent,
  type AssignmentArchiveWrite,
  type AssignmentRecord,
} from "../shared";

// Client-supplied request payload for assignmentsArchive. Only the target
// assignment identifier is carried. Ownership fields are never carried on
// the request and are derived server-side from the record.
export type AssignmentsArchiveRequest = {
  readonly assignmentId: string;
};

// Return payload of a successful archive call. `alreadyArchived` is
// `true` when the record is already in the terminal `archived` state and
// no write is required; `false` when this call advanced the lifecycle
// field to `archived`.
export type AssignmentsArchiveResponse = {
  readonly assignmentId: string;
  readonly status: "archived";
  readonly alreadyArchived: boolean;
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

function validateRequest(data: unknown): AssignmentsArchiveRequest {
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

// assignmentsArchive
//
// Canonical terminal archive transition for assignments/{assignmentId}
// per Data Model §3.6 lifecycle. Callable by the owning teacher only.
// `archived` may be reached from `draft`, `published`, or `closed`; it is
// terminal.
//
// Every side effect flows through the canonical shared helpers:
//   - record read via `assignmentDocRef(...).get()`               (typed ref)
//   - narrow archive write via `assignmentArchiveDocRef(...).update(...)`
//                                                                 (typed ref)
//   - audit event via `writeAuditEvent({...})`                    (§5 helper)
//
// Idempotency: an already-`archived` record returns
// `alreadyArchived: true` with no second write and no second audit event.
async function assignmentsArchiveHandler(
  request: CallableRequest<unknown>,
): Promise<AssignmentsArchiveResponse> {
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

  if (existing.status === "archived") {
    safeLog(() =>
      log.info("assignments.archiveIdempotent", {
        actorUserId: actor.uid,
        assignmentId: input.assignmentId,
      }),
    );
    return {
      assignmentId: input.assignmentId,
      status: "archived",
      alreadyArchived: true,
    };
  }

  // `existing.status` narrows to `"draft" | "published" | "closed"` here
  // per the current `AssignmentStatus` enumeration. All three transition
  // to `archived` per §3.6.

  const write: AssignmentArchiveWrite = { status: "archived" };
  await assignmentArchiveDocRef(input.assignmentId).update(write);

  await writeAuditEvent({
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "assignments.archived",
    targetType: "assignment",
    targetId: input.assignmentId,
    schoolId: actor.schoolId,
    payload: { classId: existing.classId, previousStatus: existing.status },
  });

  safeLog(() =>
    log.info("assignments.archived", {
      actorUserId: actor.uid,
      assignmentId: input.assignmentId,
    }),
  );

  return {
    assignmentId: input.assignmentId,
    status: "archived",
    alreadyArchived: false,
  };
}

export const assignmentsArchive = platformCallable(assignmentsArchiveHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assignmentsArchiveHandler = assignmentsArchiveHandler;
