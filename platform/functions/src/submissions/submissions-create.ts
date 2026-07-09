import { FieldValue } from "firebase-admin/firestore";
import { onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  assignmentDocRef,
  enrollmentDocRef,
  log,
  submissionCreationDocRef,
  submissionDocRef,
  writeAuditEvent,
  type AssignmentRecord,
  type EnrollmentRecord,
  type SubmissionCreationWrite,
  type SubmissionRecord,
  type SubmissionResponse,
} from "../shared";

// Client-supplied request payload for submissionsCreate. The authenticated
// student supplies the target assignmentId only; ownership fields are
// server-derived. `responses` is optional at creation time: Sprint 5A
// splits create and finalize into two callables so a student may start a
// submission with no responses and record answers on finalization, or may
// pass an initial snapshot at creation. Timestamps are not carried on the
// request; `startedAt` is stamped by the server via
// `FieldValue.serverTimestamp()`.
export type SubmissionsCreateRequest = {
  readonly assignmentId: string;
  readonly responses?: readonly SubmissionResponse[];
};

// Return payload of a successful create call. `submissionId` is the
// deterministic composite `{assignmentId}__{studentId}` that enforces
// uniqueness of the current attempt at the write boundary per Data Model
// §5.6, without a hot document or a transactional query. `alreadyCreated`
// is `true` when the call is a no-op idempotent replay of an existing
// `submitted` document owned by the caller, and `false` when this call
// wrote the canonical submissions/{submissionId} document.
export type SubmissionsCreateResponse = {
  readonly submissionId: string;
  readonly alreadyCreated: boolean;
};

const ASSIGNMENT_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;
const QUESTION_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;
const MAX_RESPONSES = 200;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertAuthenticatedStudent(
  request: CallableRequest<unknown>,
): { readonly uid: string; readonly schoolId: string } {
  const auth = request.auth;
  if (!auth || !isNonEmptyString(auth.uid)) {
    throw new PlatformError(
      "submissions.unauthenticated",
      "An authenticated caller is required.",
    );
  }
  const token = auth.token as
    | { readonly role?: unknown; readonly schoolId?: unknown }
    | undefined;
  if (!token || token.role !== "student") {
    throw new PlatformError(
      "submissions.unauthorized",
      "Caller must be an active student.",
    );
  }
  if (!isNonEmptyString(token.schoolId)) {
    throw new PlatformError(
      "submissions.unauthorized",
      "Caller is missing a canonical schoolId claim.",
    );
  }
  return { uid: auth.uid, schoolId: token.schoolId };
}

function validateResponses(value: unknown): readonly SubmissionResponse[] {
  if (!Array.isArray(value)) {
    throw new PlatformError(
      "submissions.invalidResponses",
      "responses, when supplied, must be an array.",
    );
  }
  if (value.length > MAX_RESPONSES) {
    throw new PlatformError(
      "submissions.invalidResponses",
      `responses must be at most ${MAX_RESPONSES} entries.`,
    );
  }
  const seen = new Set<string>();
  const out: SubmissionResponse[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new PlatformError(
        "submissions.invalidResponses",
        "each response entry must be a structured object.",
      );
    }
    const record = entry as { questionId?: unknown; response?: unknown };
    if (!isNonEmptyString(record.questionId)) {
      throw new PlatformError(
        "submissions.invalidResponses",
        "each response entry must carry a non-empty questionId.",
      );
    }
    const questionId = record.questionId.trim();
    if (!QUESTION_ID_PATTERN.test(questionId)) {
      throw new PlatformError(
        "submissions.invalidResponses",
        "questionId must be a URL-safe token.",
      );
    }
    if (seen.has(questionId)) {
      throw new PlatformError(
        "submissions.invalidResponses",
        "responses must not contain duplicate questionId values.",
      );
    }
    seen.add(questionId);
    if (record.response === undefined) {
      throw new PlatformError(
        "submissions.invalidResponses",
        "each response entry must carry a response value.",
      );
    }
    out.push({ questionId, response: record.response });
  }
  return out;
}

type ValidatedRequest = {
  readonly assignmentId: string;
  readonly responses: readonly SubmissionResponse[];
};

function validateRequest(data: unknown): ValidatedRequest {
  if (data === null || typeof data !== "object") {
    throw new PlatformError(
      "submissions.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;

  if (!isNonEmptyString(payload.assignmentId)) {
    throw new PlatformError(
      "submissions.invalidAssignmentId",
      "assignmentId must be a non-empty string.",
    );
  }
  const assignmentId = payload.assignmentId.trim();
  if (!ASSIGNMENT_ID_PATTERN.test(assignmentId)) {
    throw new PlatformError(
      "submissions.invalidAssignmentId",
      "assignmentId must be a URL-safe token.",
    );
  }

  const responses =
    payload.responses === undefined ? [] : validateResponses(payload.responses);

  return { assignmentId, responses };
}

// Deterministic submission document ID for the (assignmentId, studentId)
// pair. Enforces the §5.6 uniqueness invariant at the write boundary
// without a transactional query and without a hot document. Sprint 5A
// treats each (assignment, student) pair as a single-attempt surface;
// multi-attempt semantics are a future amendment that would extend the
// composite with an attempt number.
export function submissionIdFor(
  assignmentId: string,
  studentId: string,
): string {
  return `${assignmentId}__${studentId}`;
}

async function loadAssignment(assignmentId: string): Promise<AssignmentRecord> {
  const snapshot = await assignmentDocRef(assignmentId).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "submissions.assignmentNotFound",
      "Referenced assignment was not found.",
    );
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError(
      "submissions.assignmentNotFound",
      "Referenced assignment record was empty.",
    );
  }
  return data;
}

async function loadActiveEnrollment(
  classId: string,
  studentId: string,
): Promise<EnrollmentRecord> {
  const id = `${classId}__${studentId}`;
  const snapshot = await enrollmentDocRef(id).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "submissions.notEnrolled",
      "Caller is not enrolled in the referenced class.",
    );
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError(
      "submissions.notEnrolled",
      "Caller is not enrolled in the referenced class.",
    );
  }
  if (data.status !== "active") {
    throw new PlatformError(
      "submissions.notEnrolled",
      "Caller is not actively enrolled in the referenced class.",
    );
  }
  return data;
}

function existingMatchesRequest(
  existing: SubmissionRecord,
  actor: { uid: string; schoolId: string },
  assignmentId: string,
  assignment: AssignmentRecord,
): boolean {
  if (existing.status !== "submitted") return false;
  if (existing.studentId !== actor.uid) return false;
  if (existing.assignmentId !== assignmentId) return false;
  if (existing.schoolId !== actor.schoolId) return false;
  if (existing.classId !== assignment.classId) return false;
  if (existing.teacherId !== assignment.teacherId) return false;
  if (existing.lessonSlug !== assignment.lessonSlug) return false;
  if (existing.lessonVersion !== assignment.lessonVersion) return false;
  if (existing.mode !== assignment.mode) return false;
  return true;
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

// submissionsCreate
//
// Canonical creation of a submissions/{submissionId} document in the
// transient `submitted` state per Data Model §3.7. Callable by an
// authenticated student whose canonical custom claims
// (`{ role: "student", schoolId }`) were issued by
// studentsCompleteOnboarding in Sprint 2. Ownership fields are
// server-derived: `studentId` is the caller's uid; `classId`, `teacherId`,
// `schoolId`, `lessonSlug`, `lessonVersion`, and `mode` are denormalized
// from the referenced assignment record per §12.3; none are client-supplied.
//
// Every side effect flows through the canonical shared helpers:
//   - assignment read via `assignmentDocRef(...).get()`             (typed ref)
//   - enrollment read via `enrollmentDocRef(...).get()`             (typed ref)
//   - existing-record read via `submissionDocRef(...).get()`        (typed ref)
//   - creation write via `submissionCreationDocRef(...).set(...)`   (typed ref)
//   - audit event via `writeAuditEvent({...})`                      (§5 helper)
//
// The assignment must be `published` and in `classroom` mode; a `practice`
// assignment is client-only per Cloud Function Charter §2 and never
// finalizes a submission. Cross-school targets are rejected with
// `submissions.forbidden`.
//
// Idempotency: an existing submission for this (assignment, student) pair
// still in `submitted` returns `alreadyCreated: true` with no second write
// and no second audit event. Every other conflict (finalized document,
// mismatched canonical fields) is rejected with `submissions.conflict`.
async function submissionsCreateHandler(
  request: CallableRequest<unknown>,
): Promise<SubmissionsCreateResponse> {
  const actor = assertAuthenticatedStudent(request);
  const input = validateRequest(request.data);

  const assignment = await loadAssignment(input.assignmentId);

  if (assignment.schoolId !== actor.schoolId) {
    throw new PlatformError(
      "submissions.forbidden",
      "Caller does not have access to this assignment.",
    );
  }
  if (assignment.mode !== "classroom") {
    throw new PlatformError(
      "submissions.invalidAssignmentMode",
      "Submissions are only recorded for classroom-mode assignments.",
    );
  }
  if (assignment.status !== "published") {
    throw new PlatformError(
      "submissions.invalidAssignmentStatus",
      "Submissions may only be created against a published assignment.",
    );
  }

  await loadActiveEnrollment(assignment.classId, actor.uid);

  const submissionId = submissionIdFor(input.assignmentId, actor.uid);
  const existingSnapshot = await submissionDocRef(submissionId).get();
  if (existingSnapshot.exists) {
    const existing = existingSnapshot.data();
    if (
      existing &&
      existingMatchesRequest(existing, actor, input.assignmentId, assignment)
    ) {
      safeLog(() =>
        log.info("submissions.createIdempotent", {
          actorUserId: actor.uid,
          submissionId,
        }),
      );
      return { submissionId, alreadyCreated: true };
    }
    throw new PlatformError(
      "submissions.conflict",
      "A submission for this assignment and student already exists.",
    );
  }

  const creation: SubmissionCreationWrite = {
    assignmentId: input.assignmentId,
    studentId: actor.uid,
    classId: assignment.classId,
    teacherId: assignment.teacherId,
    schoolId: assignment.schoolId,
    lessonSlug: assignment.lessonSlug,
    lessonVersion: assignment.lessonVersion,
    mode: assignment.mode,
    status: "submitted",
    startedAt: FieldValue.serverTimestamp(),
    responses: input.responses,
  };

  await submissionCreationDocRef(submissionId).set(creation);

  await writeAuditEvent({
    actorUserId: actor.uid,
    actorRole: "student",
    action: "submissions.created",
    targetType: "submission",
    targetId: submissionId,
    schoolId: actor.schoolId,
    payload: {
      assignmentId: input.assignmentId,
      classId: assignment.classId,
      lessonSlug: assignment.lessonSlug,
      lessonVersion: assignment.lessonVersion,
    },
  });

  safeLog(() =>
    log.info("submissions.created", {
      actorUserId: actor.uid,
      submissionId,
      assignmentId: input.assignmentId,
    }),
  );

  return { submissionId, alreadyCreated: false };
}

export const submissionsCreate = onCall(submissionsCreateHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __submissionsCreateHandler = submissionsCreateHandler;
