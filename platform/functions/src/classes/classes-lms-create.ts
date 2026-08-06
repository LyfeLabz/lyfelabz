import { FieldValue } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  classDocRef,
  classLmsCreationDocRef,
  log,
  requireDistrictContext,
  writeAuditEvent,
  type ClassLmsCreationWrite,
  type ClassRecord,
} from "../shared";

// classesLmsCreate
//
// Sprint 24B Phase 2B.3 - narrow LMS-authored class creation seam.
//
// Creates a `classes/{classId}` document in the `needsSetup` lifecycle
// state per Phase 2B Implementation Specification §7. The callable is
// deliberately narrow:
//   - Request carries `{ classId, title }` only. No `grade`, `block`,
//     `academicTerm`, `providerId`, or `lmsClassId`.
//   - Ownership fields (`teacherId`, `schoolId`) are derived from the
//     authenticated caller's canonical district context and are never
//     client-supplied.
//   - The write shape (`ClassLmsCreationWrite`) omits `grade`, `block`,
//     and `joinCode`. Those three fields are written atomically by
//     `classesActivate` in a single Firestore transaction (Spec §5.3,
//     §8.5); no join code exists on a `needsSetup` class.
//   - LMS link fields (`enrollmentSource`, `lmsProviderRef`) are NOT
//     written by this callable. The existing `lmsClassesImport` callable
//     remains the single authoritative writer of the LMS link per PDR-019i
//     and PDR-019j; the Phase 2B.4 orchestration composes
//     `classesLmsCreate -> lmsClassesImport` and preserves link ownership
//     in one place.
//
// Darkness: no production client invokes this callable in Phase 2B.3. The
// client swap happens in Phase 2B.4.
//
// Idempotency: an existing `classes/{classId}` owned by the caller under
// the same school with matching `title` is returned as
// `alreadyCreated: true` with no second write and no second audit event.
// Because the callable is idempotent on the caller-supplied `classId`,
// two rapid replays produce exactly one class document by construction.
// Cross-owner or cross-school collisions surface as `classes.conflict`.
// An existing `active` document at the same `classId` from a prior Manual
// Create is treated as a conflict because Manual Create's shape is not the
// `needsSetup` write shape this callable owns.

export type ClassesLmsCreateRequest = {
  readonly classId: string;
  readonly title: string;
};

export type ClassesLmsCreateResponse = {
  readonly classId: string;
  readonly status: "needsSetup";
  readonly alreadyCreated: boolean;
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
  return {
    uid: context.uid,
    schoolId: context.schoolId,
    districtId: context.districtId,
  };
}

function validateRequest(data: unknown): ClassesLmsCreateRequest {
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

  if (!isNonEmptyString(payload.title)) {
    throw new PlatformError(
      "classes.invalidTitle",
      "title must be a non-empty string.",
    );
  }
  const title = payload.title.trim();

  return { classId, title };
}

function existingMatchesRequest(
  existing: ClassRecord,
  actor: { uid: string; schoolId: string },
  input: ClassesLmsCreateRequest,
): boolean {
  // The LMS creation seam is idempotent only on a prior `needsSetup`
  // document with the same owner, school, and title. An `active` or
  // `archived` document at the same classId is not an idempotent match:
  // Manual Create writes `active` documents through a different write
  // shape, so returning success here would misrepresent the record.
  if (existing.status !== "needsSetup") return false;
  if (existing.teacherId !== actor.uid) return false;
  if (existing.schoolId !== actor.schoolId) return false;
  if (existing.title !== input.title) return false;
  return true;
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

async function classesLmsCreateHandler(
  request: CallableRequest<unknown>,
): Promise<ClassesLmsCreateResponse> {
  const actor = await assertActiveTeacherInDistrict(request);
  const input = validateRequest(request.data);

  const existingSnapshot = await classDocRef(input.classId).get();
  if (existingSnapshot.exists) {
    const existing = existingSnapshot.data();
    if (existing && existingMatchesRequest(existing, actor, input)) {
      safeLog(() =>
        log.info("classes.lmsCreateIdempotent", {
          actorUserId: actor.uid,
          classId: input.classId,
        }),
      );
      return {
        classId: input.classId,
        status: "needsSetup",
        alreadyCreated: true,
      };
    }
    throw new PlatformError(
      "classes.conflict",
      "A class with this id already exists.",
    );
  }

  const creation: ClassLmsCreationWrite = {
    teacherId: actor.uid,
    schoolId: actor.schoolId,
    title: input.title,
    status: "needsSetup",
    createdAt: FieldValue.serverTimestamp(),
  };

  await classLmsCreationDocRef(input.classId).set(creation);

  await writeAuditEvent({
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "classes.created",
    targetType: "class",
    targetId: input.classId,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
    payload: { source: "lms" },
  });

  safeLog(() =>
    log.info("classes.lmsCreated", {
      actorUserId: actor.uid,
      classId: input.classId,
      schoolId: actor.schoolId,
      districtId: actor.districtId,
    }),
  );

  return {
    classId: input.classId,
    status: "needsSetup",
    alreadyCreated: false,
  };
}

export const classesLmsCreate = platformCallable(classesLmsCreateHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __classesLmsCreateHandler = classesLmsCreateHandler;
