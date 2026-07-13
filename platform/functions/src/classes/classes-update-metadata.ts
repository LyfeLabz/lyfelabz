import { onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  classDocRef,
  classMetadataUpdateDocRef,
  log,
  requireDistrictContext,
  writeAuditEvent,
  type ClassMetadataUpdateWrite,
  type ClassRecord,
} from "../shared";

// Client-supplied request payload for classesUpdateMetadata. Only the
// teacher-editable metadata fields (`title`, `grade`, `block`,
// `academicTerm`) are accepted per Data Model §7.3. Ownership fields,
// `joinCode`, `status`, and `createdAt` are never carried on the request
// and are never writable through this path. At least one metadata field
// must be present; a payload with zero updates is rejected with
// `classes.invalidRequest`.
export type ClassesUpdateMetadataRequest = {
  readonly classId: string;
  readonly title?: string;
  readonly grade?: string;
  readonly block?: string;
  readonly academicTerm?: string;
};

// Return payload of a successful metadata update. `alreadyUpdated` is
// `true` when the submitted metadata matches the current record and no
// write is required; `false` when a write was performed.
export type ClassesUpdateMetadataResponse = {
  readonly classId: string;
  readonly alreadyUpdated: boolean;
};

const CLASS_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;
const BLOCK_PATTERN = /^[A-G]$/;
const GRADE_PATTERN = /^[A-Za-z0-9]{1,8}$/;

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

function validateRequest(data: unknown): ClassesUpdateMetadataRequest {
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

  const out: {
    classId: string;
    title?: string;
    grade?: string;
    block?: string;
    academicTerm?: string;
  } = { classId };

  if (payload.title !== undefined) {
    if (!isNonEmptyString(payload.title)) {
      throw new PlatformError(
        "classes.invalidTitle",
        "title, when supplied, must be a non-empty string.",
      );
    }
    out.title = payload.title.trim();
  }

  if (payload.grade !== undefined) {
    if (!isNonEmptyString(payload.grade)) {
      throw new PlatformError(
        "classes.invalidGrade",
        "grade, when supplied, must be a non-empty string.",
      );
    }
    const grade = payload.grade.trim();
    if (!GRADE_PATTERN.test(grade)) {
      throw new PlatformError(
        "classes.invalidGrade",
        "grade must be a short alphanumeric token.",
      );
    }
    out.grade = grade;
  }

  if (payload.block !== undefined) {
    if (!isNonEmptyString(payload.block)) {
      throw new PlatformError(
        "classes.invalidBlock",
        "block, when supplied, must be a non-empty string.",
      );
    }
    const block = payload.block.trim().toUpperCase();
    if (!BLOCK_PATTERN.test(block)) {
      throw new PlatformError(
        "classes.invalidBlock",
        "block must be a single letter A through G.",
      );
    }
    out.block = block;
  }

  if (payload.academicTerm !== undefined) {
    if (!isNonEmptyString(payload.academicTerm)) {
      throw new PlatformError(
        "classes.invalidAcademicTerm",
        "academicTerm, when supplied, must be a non-empty string.",
      );
    }
    out.academicTerm = payload.academicTerm.trim();
  }

  if (
    out.title === undefined &&
    out.grade === undefined &&
    out.block === undefined &&
    out.academicTerm === undefined
  ) {
    throw new PlatformError(
      "classes.invalidRequest",
      "At least one metadata field must be supplied.",
    );
  }

  return out;
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

function computeDiff(
  existing: ClassRecord,
  input: ClassesUpdateMetadataRequest,
): {
  readonly write: ClassMetadataUpdateWrite;
  readonly changedFields: readonly string[];
} {
  const write: {
    title?: string;
    grade?: string;
    block?: string;
    academicTerm?: string;
  } = {};
  const changedFields: string[] = [];

  if (input.title !== undefined && input.title !== existing.title) {
    write.title = input.title;
    changedFields.push("title");
  }
  if (input.grade !== undefined && input.grade !== existing.grade) {
    write.grade = input.grade;
    changedFields.push("grade");
  }
  if (input.block !== undefined && input.block !== existing.block) {
    write.block = input.block;
    changedFields.push("block");
  }
  if (
    input.academicTerm !== undefined &&
    input.academicTerm !== existing.academicTerm
  ) {
    write.academicTerm = input.academicTerm;
    changedFields.push("academicTerm");
  }

  return { write, changedFields };
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

// classesUpdateMetadata
//
// Canonical narrow-metadata update of classes/{classId} per Data Model
// §3.3 and §7.3. Callable by the owning teacher only. Ownership is
// enforced by comparing the record's `teacherId` to the authenticated
// caller and the record's `schoolId` to the caller's canonical
// `schoolId` claim; a cross-teacher or cross-school update is rejected
// with `classes.forbidden`.
//
// Every side effect flows through the canonical shared helpers:
//   - record read via `classDocRef(classId).get()`               (typed ref)
//   - narrow update via `classMetadataUpdateDocRef(classId).update(...)`
//                                                                (typed ref)
//   - audit event via `writeAuditEvent({...})`                   (§5 helper)
//
// Idempotency: if every submitted field already matches the stored value,
// no write and no audit event are emitted and `alreadyUpdated: true` is
// returned. Archived classes are not editable; an update against an
// archived class returns `classes.invalidStatus`.
async function classesUpdateMetadataHandler(
  request: CallableRequest<unknown>,
): Promise<ClassesUpdateMetadataResponse> {
  const actor = await assertActiveTeacherInDistrict(request);
  const input = validateRequest(request.data);

  const existing = await loadClass(input.classId);

  if (existing.teacherId !== actor.uid || existing.schoolId !== actor.schoolId) {
    throw new PlatformError(
      "classes.forbidden",
      "Caller does not own this class.",
    );
  }

  if (existing.status !== "active") {
    throw new PlatformError(
      "classes.invalidStatus",
      `Metadata update requires status "active" (current: "${existing.status}").`,
    );
  }

  const { write, changedFields } = computeDiff(existing, input);
  if (changedFields.length === 0) {
    safeLog(() =>
      log.info("classes.updateMetadataIdempotent", {
        actorUserId: actor.uid,
        classId: input.classId,
      }),
    );
    return { classId: input.classId, alreadyUpdated: true };
  }

  await classMetadataUpdateDocRef(input.classId).update(write);

  await writeAuditEvent({
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "classes.metadataUpdated",
    targetType: "class",
    targetId: input.classId,
    schoolId: actor.schoolId,
    payload: { changedFields },
  });

  safeLog(() =>
    log.info("classes.metadataUpdated", {
      actorUserId: actor.uid,
      classId: input.classId,
      changedFields,
    }),
  );

  return { classId: input.classId, alreadyUpdated: false };
}

export const classesUpdateMetadata = onCall(classesUpdateMetadataHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __classesUpdateMetadataHandler = classesUpdateMetadataHandler;
