import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  classArchiveDocRef,
  classDocRef,
  log,
  requireDistrictContext,
  writeAuditEvent,
  type ClassArchiveWrite,
  type ClassRecord,
} from "../shared";

// Client-supplied request payload for classesArchive. Only the target
// class identifier is carried. Ownership fields are never carried on the
// request and are derived server-side from the authenticated caller.
export type ClassesArchiveRequest = {
  readonly classId: string;
};

// Return payload of a successful archive call. `alreadyArchived` is
// `true` when the record is already in the `archived` terminal state and
// no write is required; `false` when this call advanced the lifecycle
// field from `active` to `archived`.
export type ClassesArchiveResponse = {
  readonly classId: string;
  readonly status: "archived";
  readonly alreadyArchived: boolean;
};

const CLASS_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;

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

function validateRequest(data: unknown): ClassesArchiveRequest {
  if (data === null || typeof data !== "object") {
    throw new PlatformError(
      "classes.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;
  if (!isNonEmptyString(payload.classId)) {
    throw new PlatformError(
      "classes.invalidClassId",
      "classId must be a non-empty string.",
    );
  }
  const classId = payload.classId.trim();
  if (!CLASS_ID_PATTERN.test(classId)) {
    throw new PlatformError(
      "classes.invalidClassId",
      "classId must be a URL-safe token (letters, digits, hyphens, underscores).",
    );
  }
  return { classId };
}

async function loadClass(classId: string): Promise<ClassRecord> {
  const snapshot = await classDocRef(classId).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "classes.notFound",
      "Class was not found.",
    );
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError(
      "classes.notFound",
      "Class record was empty.",
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

// classesArchive
//
// Canonical terminal archive transition for classes/{classId} per Data
// Model §3.3 lifecycle and §7.3. Callable by the owning teacher only.
// Ownership is enforced by comparing the record's `teacherId` to the
// authenticated caller and the record's `schoolId` to the caller's
// canonical `schoolId` claim.
//
// Every side effect flows through the canonical shared helpers:
//   - record read via `classDocRef(classId).get()`               (typed ref)
//   - narrow archive write via `classArchiveDocRef(classId).update(...)`
//                                                                (typed ref)
//   - audit event via `writeAuditEvent({...})`                   (§5 helper)
//
// Idempotency: an already-`archived` record returns
// `alreadyArchived: true` with no second write and no second audit event.
async function classesArchiveHandler(
  request: CallableRequest<unknown>,
): Promise<ClassesArchiveResponse> {
  const actor = await assertActiveTeacherInDistrict(request);
  const input = validateRequest(request.data);

  const existing = await loadClass(input.classId);

  if (existing.teacherId !== actor.uid || existing.schoolId !== actor.schoolId) {
    throw new PlatformError(
      "classes.forbidden",
      "Caller does not own this class.",
    );
  }

  if (existing.status === "archived") {
    safeLog(() =>
      log.info("classes.archiveIdempotent", {
        actorUserId: actor.uid,
        classId: input.classId,
      }),
    );
    return {
      classId: input.classId,
      status: "archived",
      alreadyArchived: true,
    };
  }

  // `existing.status` narrows to `"active"` here per the current
  // `ClassStatus` enumeration in shared/types/class.ts. If future
  // architecture amendments extend the enumeration, this callable must be
  // revisited so a non-active, non-archived status is either rejected
  // explicitly or transitioned intentionally.

  const write: ClassArchiveWrite = { status: "archived" };
  await classArchiveDocRef(input.classId).update(write);

  await writeAuditEvent({
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "classes.archived",
    targetType: "class",
    targetId: input.classId,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
  });

  safeLog(() =>
    log.info("classes.archived", {
      actorUserId: actor.uid,
      classId: input.classId,
    }),
  );

  return {
    classId: input.classId,
    status: "archived",
    alreadyArchived: false,
  };
}

export const classesArchive = platformCallable(classesArchiveHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __classesArchiveHandler = classesArchiveHandler;
