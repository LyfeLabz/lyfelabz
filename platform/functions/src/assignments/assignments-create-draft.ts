import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  assignmentCreationDocRef,
  assignmentDocRef,
  classDocRef,
  log,
  requireDistrictContext,
  writeAuditEvent,
  type AssignmentCreationWrite,
  type AssignmentMode,
  type AssignmentRecord,
  type ClassRecord,
} from "../shared";

// Client-supplied request payload for assignmentsCreateDraft. The teacher
// supplies the target assignmentId explicitly so the callable is idempotent
// against replays and never silently mints a second assignment document for
// the same intended draft. Ownership fields (`teacherId`, `schoolId`) are
// never carried on the request: `teacherId` is the caller's uid and
// `schoolId` is denormalized from the referenced class record. `classId`,
// `lessonSlug`, `lessonVersion`, and `mode` are teacher-authored. `title`,
// `instructions`, `windowClosesAt`, and `availableAt` are optional per Data
// Model §3.6. Timestamps are transported as ISO 8601 strings and converted
// to Firestore `Timestamp` at the write boundary.
export type AssignmentsCreateDraftRequest = {
  readonly assignmentId: string;
  readonly classId: string;
  readonly lessonSlug: string;
  readonly lessonVersion: string;
  readonly mode: AssignmentMode;
  readonly title?: string;
  readonly instructions?: string;
  readonly windowClosesAt?: string;
  readonly availableAt?: string;
};

// Return payload of a successful draft-creation call. `alreadyCreated` is
// `true` when the call is a no-op idempotent replay of a previously
// successful creation, and `false` when this call wrote the canonical
// assignments/{assignmentId} document.
export type AssignmentsCreateDraftResponse = {
  readonly assignmentId: string;
  readonly status: "draft";
  readonly alreadyCreated: boolean;
};

const ASSIGNMENT_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;
const CLASS_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;
const LESSON_SLUG_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,126}[A-Za-z0-9])?$/;
const LESSON_VERSION_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/;
const VALID_MODES: readonly AssignmentMode[] = ["practice", "classroom"];
const MAX_TITLE = 200;
const MAX_INSTRUCTIONS = 4000;

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

function parseIsoTimestamp(value: unknown, field: string): Timestamp {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PlatformError(
      `assignments.invalid${field}`,
      `${field}, when supplied, must be a non-empty ISO 8601 string.`,
    );
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new PlatformError(
      `assignments.invalid${field}`,
      `${field} must be a valid ISO 8601 timestamp.`,
    );
  }
  return Timestamp.fromMillis(parsed);
}

type ValidatedRequest = {
  readonly assignmentId: string;
  readonly classId: string;
  readonly lessonSlug: string;
  readonly lessonVersion: string;
  readonly mode: AssignmentMode;
  readonly title?: string;
  readonly instructions?: string;
  readonly windowClosesAt?: Timestamp;
  readonly availableAt?: Timestamp;
};

function validateRequest(data: unknown): ValidatedRequest {
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
      "assignmentId must be a URL-safe token (letters, digits, hyphens, underscores).",
    );
  }

  if (!isNonEmptyString(payload.classId)) {
    throw new PlatformError(
      "assignments.invalidClassId",
      "classId must be a non-empty string.",
    );
  }
  const classId = payload.classId.trim();
  if (!CLASS_ID_PATTERN.test(classId)) {
    throw new PlatformError(
      "assignments.invalidClassId",
      "classId must be a URL-safe token.",
    );
  }

  if (!isNonEmptyString(payload.lessonSlug)) {
    throw new PlatformError(
      "assignments.invalidLessonSlug",
      "lessonSlug must be a non-empty string.",
    );
  }
  const lessonSlug = payload.lessonSlug.trim();
  if (!LESSON_SLUG_PATTERN.test(lessonSlug)) {
    throw new PlatformError(
      "assignments.invalidLessonSlug",
      "lessonSlug must be a URL-safe token.",
    );
  }

  if (!isNonEmptyString(payload.lessonVersion)) {
    throw new PlatformError(
      "assignments.invalidLessonVersion",
      "lessonVersion must be a non-empty string.",
    );
  }
  const lessonVersion = payload.lessonVersion.trim();
  if (!LESSON_VERSION_PATTERN.test(lessonVersion)) {
    throw new PlatformError(
      "assignments.invalidLessonVersion",
      "lessonVersion must be a short alphanumeric token.",
    );
  }

  if (
    typeof payload.mode !== "string" ||
    !(VALID_MODES as readonly string[]).includes(payload.mode)
  ) {
    throw new PlatformError(
      "assignments.invalidMode",
      `mode must be one of: ${VALID_MODES.join(", ")}.`,
    );
  }
  const mode = payload.mode as AssignmentMode;

  const out: {
    assignmentId: string;
    classId: string;
    lessonSlug: string;
    lessonVersion: string;
    mode: AssignmentMode;
    title?: string;
    instructions?: string;
    windowClosesAt?: Timestamp;
    availableAt?: Timestamp;
  } = { assignmentId, classId, lessonSlug, lessonVersion, mode };

  if (payload.title !== undefined) {
    if (!isNonEmptyString(payload.title)) {
      throw new PlatformError(
        "assignments.invalidTitle",
        "title, when supplied, must be a non-empty string.",
      );
    }
    const title = payload.title.trim();
    if (title.length > MAX_TITLE) {
      throw new PlatformError(
        "assignments.invalidTitle",
        `title must be at most ${MAX_TITLE} characters.`,
      );
    }
    out.title = title;
  }

  if (payload.instructions !== undefined) {
    if (!isNonEmptyString(payload.instructions)) {
      throw new PlatformError(
        "assignments.invalidInstructions",
        "instructions, when supplied, must be a non-empty string.",
      );
    }
    const instructions = payload.instructions.trim();
    if (instructions.length > MAX_INSTRUCTIONS) {
      throw new PlatformError(
        "assignments.invalidInstructions",
        `instructions must be at most ${MAX_INSTRUCTIONS} characters.`,
      );
    }
    out.instructions = instructions;
  }

  if (payload.windowClosesAt !== undefined) {
    out.windowClosesAt = parseIsoTimestamp(payload.windowClosesAt, "WindowClosesAt");
  }
  if (payload.availableAt !== undefined) {
    out.availableAt = parseIsoTimestamp(payload.availableAt, "AvailableAt");
  }

  return out;
}

async function loadClass(classId: string): Promise<ClassRecord> {
  const snapshot = await classDocRef(classId).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "assignments.classNotFound",
      "Referenced class was not found.",
    );
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError(
      "assignments.classNotFound",
      "Referenced class record was empty.",
    );
  }
  return data;
}

function timestampsEqual(
  a: Timestamp | undefined,
  b: Timestamp | undefined,
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return a.toMillis() === b.toMillis();
}

function existingMatchesRequest(
  existing: AssignmentRecord,
  actor: { uid: string; schoolId: string },
  input: ValidatedRequest,
): boolean {
  if (existing.teacherId !== actor.uid) return false;
  if (existing.schoolId !== actor.schoolId) return false;
  if (existing.classId !== input.classId) return false;
  if (existing.lessonSlug !== input.lessonSlug) return false;
  if (existing.lessonVersion !== input.lessonVersion) return false;
  if (existing.mode !== input.mode) return false;
  if (existing.status !== "draft") return false;
  if ((existing.title ?? undefined) !== (input.title ?? undefined)) return false;
  if ((existing.instructions ?? undefined) !== (input.instructions ?? undefined)) {
    return false;
  }
  if (!timestampsEqual(existing.windowClosesAt, input.windowClosesAt)) return false;
  if (!timestampsEqual(existing.availableAt, input.availableAt)) return false;
  return true;
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

// assignmentsCreateDraft
//
// Canonical creation of an assignments/{assignmentId} document in the
// `draft` state per Data Model §3.6. Callable by an authenticated teacher
// whose canonical custom claims (`{ role: "teacher", schoolId }`) match the
// referenced class's schoolId and whose uid matches the class's teacherId.
// Ownership fields are server-derived: `teacherId` is the caller's uid and
// `schoolId` is denormalized from the referenced class per §4.6.
//
// Every side effect flows through the canonical shared helpers:
//   - class read via `classDocRef(classId).get()`                 (typed ref)
//   - existing-record read via `assignmentDocRef(...).get()`      (typed ref)
//   - creation write via `assignmentCreationDocRef(...).set(...)` (typed ref)
//   - audit event via `writeAuditEvent({...})`                    (§5 helper)
//
// Idempotency: an existing assignments/{assignmentId} owned by the caller
// under the same school and class with matching canonical fields and still
// in `draft` returns `alreadyCreated: true` with no second write and no
// second audit event. Every other conflict is rejected with
// `assignments.conflict`.
async function assignmentsCreateDraftHandler(
  request: CallableRequest<unknown>,
): Promise<AssignmentsCreateDraftResponse> {
  const actor = await assertActiveTeacherInDistrict(request);
  const input = validateRequest(request.data);

  const classRecord = await loadClass(input.classId);
  if (
    classRecord.teacherId !== actor.uid ||
    classRecord.schoolId !== actor.schoolId
  ) {
    throw new PlatformError(
      "assignments.forbidden",
      "Caller does not own the referenced class.",
    );
  }
  if (classRecord.status !== "active") {
    throw new PlatformError(
      "assignments.invalidClassStatus",
      "Assignments may only be created against an active class.",
    );
  }

  const existingSnapshot = await assignmentDocRef(input.assignmentId).get();
  if (existingSnapshot.exists) {
    const existing = existingSnapshot.data();
    if (existing && existingMatchesRequest(existing, actor, input)) {
      safeLog(() =>
        log.info("assignments.createDraftIdempotent", {
          actorUserId: actor.uid,
          assignmentId: input.assignmentId,
        }),
      );
      return {
        assignmentId: input.assignmentId,
        status: "draft",
        alreadyCreated: true,
      };
    }
    throw new PlatformError(
      "assignments.conflict",
      "An assignment with this id already exists with different canonical fields.",
    );
  }

  const creation: AssignmentCreationWrite = {
    classId: input.classId,
    teacherId: actor.uid,
    schoolId: actor.schoolId,
    lessonSlug: input.lessonSlug,
    lessonVersion: input.lessonVersion,
    mode: input.mode,
    status: "draft",
    createdAt: FieldValue.serverTimestamp(),
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.instructions !== undefined
      ? { instructions: input.instructions }
      : {}),
    ...(input.windowClosesAt !== undefined
      ? { windowClosesAt: input.windowClosesAt }
      : {}),
    ...(input.availableAt !== undefined
      ? { availableAt: input.availableAt }
      : {}),
  };

  await assignmentCreationDocRef(input.assignmentId).set(creation);

  await writeAuditEvent({
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "assignments.created",
    targetType: "assignment",
    targetId: input.assignmentId,
    schoolId: actor.schoolId,
    payload: {
      classId: input.classId,
      lessonSlug: input.lessonSlug,
      lessonVersion: input.lessonVersion,
      mode: input.mode,
    },
  });

  safeLog(() =>
    log.info("assignments.created", {
      actorUserId: actor.uid,
      assignmentId: input.assignmentId,
      classId: input.classId,
    }),
  );

  return {
    assignmentId: input.assignmentId,
    status: "draft",
    alreadyCreated: false,
  };
}

export const assignmentsCreateDraft = onCall(assignmentsCreateDraftHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assignmentsCreateDraftHandler = assignmentsCreateDraftHandler;
