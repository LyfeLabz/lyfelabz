import { Timestamp } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  assignmentDocRef,
  assignmentDraftUpdateDocRef,
  log,
  requireDistrictContext,
  writeAuditEvent,
  type AssignmentDraftUpdateWrite,
  type AssignmentMode,
  type AssignmentRecord,
} from "../shared";

// Client-supplied request payload for assignmentsUpdateDraft. Only the
// teacher-editable metadata fields (`title`, `instructions`, `lessonSlug`,
// `lessonVersion`, `mode`, `windowClosesAt`, `availableAt`) are accepted
// per Data Model §3.6 and §7.6. Ownership fields, `status`, and
// `createdAt` are never carried on the request and are never writable
// through this path. At least one metadata field must be present; a
// payload with zero updates is rejected with `assignments.invalidRequest`.
// Timestamps are transported as ISO 8601 strings.
export type AssignmentsUpdateDraftRequest = {
  readonly assignmentId: string;
  readonly title?: string;
  readonly instructions?: string;
  readonly lessonSlug?: string;
  readonly lessonVersion?: string;
  readonly mode?: AssignmentMode;
  readonly windowClosesAt?: string;
  readonly availableAt?: string;
};

// Return payload of a successful draft-update call. `alreadyUpdated` is
// `true` when the submitted metadata matches the current record and no
// write is required; `false` when a write was performed.
export type AssignmentsUpdateDraftResponse = {
  readonly assignmentId: string;
  readonly alreadyUpdated: boolean;
};

const ASSIGNMENT_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;
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
  readonly title?: string;
  readonly instructions?: string;
  readonly lessonSlug?: string;
  readonly lessonVersion?: string;
  readonly mode?: AssignmentMode;
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
      "assignmentId must be a URL-safe token.",
    );
  }

  const out: {
    assignmentId: string;
    title?: string;
    instructions?: string;
    lessonSlug?: string;
    lessonVersion?: string;
    mode?: AssignmentMode;
    windowClosesAt?: Timestamp;
    availableAt?: Timestamp;
  } = { assignmentId };

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

  if (payload.lessonSlug !== undefined) {
    if (!isNonEmptyString(payload.lessonSlug)) {
      throw new PlatformError(
        "assignments.invalidLessonSlug",
        "lessonSlug, when supplied, must be a non-empty string.",
      );
    }
    const lessonSlug = payload.lessonSlug.trim();
    if (!LESSON_SLUG_PATTERN.test(lessonSlug)) {
      throw new PlatformError(
        "assignments.invalidLessonSlug",
        "lessonSlug must be a URL-safe token.",
      );
    }
    out.lessonSlug = lessonSlug;
  }

  if (payload.lessonVersion !== undefined) {
    if (!isNonEmptyString(payload.lessonVersion)) {
      throw new PlatformError(
        "assignments.invalidLessonVersion",
        "lessonVersion, when supplied, must be a non-empty string.",
      );
    }
    const lessonVersion = payload.lessonVersion.trim();
    if (!LESSON_VERSION_PATTERN.test(lessonVersion)) {
      throw new PlatformError(
        "assignments.invalidLessonVersion",
        "lessonVersion must be a short alphanumeric token.",
      );
    }
    out.lessonVersion = lessonVersion;
  }

  if (payload.mode !== undefined) {
    if (
      typeof payload.mode !== "string" ||
      !(VALID_MODES as readonly string[]).includes(payload.mode)
    ) {
      throw new PlatformError(
        "assignments.invalidMode",
        `mode must be one of: ${VALID_MODES.join(", ")}.`,
      );
    }
    out.mode = payload.mode as AssignmentMode;
  }

  if (payload.windowClosesAt !== undefined) {
    out.windowClosesAt = parseIsoTimestamp(payload.windowClosesAt, "WindowClosesAt");
  }
  if (payload.availableAt !== undefined) {
    out.availableAt = parseIsoTimestamp(payload.availableAt, "AvailableAt");
  }

  if (
    out.title === undefined &&
    out.instructions === undefined &&
    out.lessonSlug === undefined &&
    out.lessonVersion === undefined &&
    out.mode === undefined &&
    out.windowClosesAt === undefined &&
    out.availableAt === undefined
  ) {
    throw new PlatformError(
      "assignments.invalidRequest",
      "At least one metadata field must be supplied.",
    );
  }

  return out;
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

function timestampsEqual(
  a: Timestamp | undefined,
  b: Timestamp | undefined,
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return a.toMillis() === b.toMillis();
}

function computeDiff(
  existing: AssignmentRecord,
  input: ValidatedRequest,
): {
  readonly write: AssignmentDraftUpdateWrite;
  readonly changedFields: readonly string[];
} {
  const write: {
    title?: string;
    instructions?: string;
    lessonSlug?: string;
    lessonVersion?: string;
    mode?: AssignmentMode;
    windowClosesAt?: Timestamp;
    availableAt?: Timestamp;
  } = {};
  const changedFields: string[] = [];

  if (input.title !== undefined && input.title !== existing.title) {
    write.title = input.title;
    changedFields.push("title");
  }
  if (
    input.instructions !== undefined &&
    input.instructions !== existing.instructions
  ) {
    write.instructions = input.instructions;
    changedFields.push("instructions");
  }
  if (
    input.lessonSlug !== undefined &&
    input.lessonSlug !== existing.lessonSlug
  ) {
    write.lessonSlug = input.lessonSlug;
    changedFields.push("lessonSlug");
  }
  if (
    input.lessonVersion !== undefined &&
    input.lessonVersion !== existing.lessonVersion
  ) {
    write.lessonVersion = input.lessonVersion;
    changedFields.push("lessonVersion");
  }
  if (input.mode !== undefined && input.mode !== existing.mode) {
    write.mode = input.mode;
    changedFields.push("mode");
  }
  if (
    input.windowClosesAt !== undefined &&
    !timestampsEqual(input.windowClosesAt, existing.windowClosesAt)
  ) {
    write.windowClosesAt = input.windowClosesAt;
    changedFields.push("windowClosesAt");
  }
  if (
    input.availableAt !== undefined &&
    !timestampsEqual(input.availableAt, existing.availableAt)
  ) {
    write.availableAt = input.availableAt;
    changedFields.push("availableAt");
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

// assignmentsUpdateDraft
//
// Canonical narrow-metadata update of assignments/{assignmentId} while the
// record is still in `draft` per Data Model §3.6 and §7.6. Callable by the
// owning teacher only. Ownership is enforced by comparing the record's
// `teacherId` to the authenticated caller and the record's `schoolId` to
// the caller's canonical `schoolId` claim; a cross-teacher or cross-school
// update is rejected with `assignments.forbidden`. Updates against a
// non-`draft` record are rejected with `assignments.invalidStatus` so a
// published, closed, or archived assignment can never be silently mutated.
//
// Every side effect flows through the canonical shared helpers:
//   - record read via `assignmentDocRef(...).get()`               (typed ref)
//   - narrow update via `assignmentDraftUpdateDocRef(...).update(...)`
//                                                                 (typed ref)
//   - audit event via `writeAuditEvent({...})`                    (§5 helper)
//
// Idempotency: if every submitted field already matches the stored value,
// no write and no audit event are emitted and `alreadyUpdated: true` is
// returned.
async function assignmentsUpdateDraftHandler(
  request: CallableRequest<unknown>,
): Promise<AssignmentsUpdateDraftResponse> {
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

  if (existing.status !== "draft") {
    throw new PlatformError(
      "assignments.invalidStatus",
      `Draft update requires status "draft" (current: "${existing.status}").`,
    );
  }

  const { write, changedFields } = computeDiff(existing, input);
  if (changedFields.length === 0) {
    safeLog(() =>
      log.info("assignments.updateDraftIdempotent", {
        actorUserId: actor.uid,
        assignmentId: input.assignmentId,
      }),
    );
    return { assignmentId: input.assignmentId, alreadyUpdated: true };
  }

  await assignmentDraftUpdateDocRef(input.assignmentId).update(write);

  await writeAuditEvent({
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "assignments.updated",
    targetType: "assignment",
    targetId: input.assignmentId,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
    payload: { changedFields },
  });

  safeLog(() =>
    log.info("assignments.updated", {
      actorUserId: actor.uid,
      assignmentId: input.assignmentId,
      changedFields,
    }),
  );

  return { assignmentId: input.assignmentId, alreadyUpdated: false };
}

export const assignmentsUpdateDraft = platformCallable(assignmentsUpdateDraftHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assignmentsUpdateDraftHandler = assignmentsUpdateDraftHandler;
