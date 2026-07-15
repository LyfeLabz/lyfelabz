import { FieldValue } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  assertLegacySubmissionsWritesEnabled,
  enrollmentDocRef,
  log,
  submissionDocRef,
  submissionFinalizationDocRef,
  writeAuditEvent,
  type EnrollmentRecord,
  type SubmissionFinalizationWrite,
  type SubmissionRecord,
  type SubmissionResponse,
} from "../shared";

// Client-supplied request payload for submissionsFinalize. The
// authenticated student supplies the target submissionId and the final
// responses. Optional analytics fields (`score`, `durationMs`,
// `attemptCount`) may accompany the finalization; the server treats them
// as observations, not as authorization. Ownership fields are never
// carried on the request and are read from the persisted record.
export type SubmissionsFinalizeRequest = {
  readonly submissionId: string;
  readonly responses?: readonly SubmissionResponse[];
  readonly score?: number;
  readonly durationMs?: number;
  readonly attemptCount?: number;
};

// Return payload of a successful finalize call. `alreadyFinalized` is
// `true` when the record is already in `finalized` and no write is
// required (idempotent replay); `false` when this call advanced the
// lifecycle field from `submitted` to `finalized`.
export type SubmissionsFinalizeResponse = {
  readonly submissionId: string;
  readonly status: "finalized";
  readonly alreadyFinalized: boolean;
};

const SUBMISSION_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_.-]{0,126}[a-zA-Z0-9])?$/;
const QUESTION_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;
const MAX_RESPONSES = 200;
const MAX_SCORE = 100000;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
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
  readonly submissionId: string;
  readonly responses?: readonly SubmissionResponse[];
  readonly score?: number;
  readonly durationMs?: number;
  readonly attemptCount?: number;
};

function validateRequest(data: unknown): ValidatedRequest {
  if (data === null || typeof data !== "object") {
    throw new PlatformError(
      "submissions.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;

  if (!isNonEmptyString(payload.submissionId)) {
    throw new PlatformError(
      "submissions.invalidSubmissionId",
      "submissionId must be a non-empty string.",
    );
  }
  const submissionId = payload.submissionId.trim();
  if (!SUBMISSION_ID_PATTERN.test(submissionId)) {
    throw new PlatformError(
      "submissions.invalidSubmissionId",
      "submissionId must be a URL-safe token.",
    );
  }

  const out: ValidatedRequest = { submissionId };

  if (payload.responses !== undefined) {
    (out as { responses?: readonly SubmissionResponse[] }).responses =
      validateResponses(payload.responses);
  }

  if (payload.score !== undefined) {
    if (!isFiniteNonNegative(payload.score) || payload.score > MAX_SCORE) {
      throw new PlatformError(
        "submissions.invalidScore",
        `score, when supplied, must be a finite non-negative number no greater than ${MAX_SCORE}.`,
      );
    }
    (out as { score?: number }).score = payload.score;
  }

  if (payload.durationMs !== undefined) {
    if (!isFiniteNonNegative(payload.durationMs)) {
      throw new PlatformError(
        "submissions.invalidDurationMs",
        "durationMs, when supplied, must be a finite non-negative number.",
      );
    }
    (out as { durationMs?: number }).durationMs = payload.durationMs;
  }

  if (payload.attemptCount !== undefined) {
    if (
      !isFiniteNonNegative(payload.attemptCount) ||
      !Number.isInteger(payload.attemptCount)
    ) {
      throw new PlatformError(
        "submissions.invalidAttemptCount",
        "attemptCount, when supplied, must be a non-negative integer.",
      );
    }
    (out as { attemptCount?: number }).attemptCount = payload.attemptCount;
  }

  return out;
}

async function loadSubmission(submissionId: string): Promise<SubmissionRecord> {
  const snapshot = await submissionDocRef(submissionId).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "submissions.notFound",
      "Submission was not found.",
    );
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError(
      "submissions.notFound",
      "Submission record was empty.",
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

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

// submissionsFinalize
//
// Canonical finalization transition for submissions/{submissionId} per
// Data Model §3.7 lifecycle: `submitted` -> `finalized`. Callable by the
// owning student only.
//
// Every side effect flows through the canonical shared helpers:
//   - record read via `submissionDocRef(...).get()`                 (typed ref)
//   - enrollment read via `enrollmentDocRef(...).get()`             (typed ref)
//   - narrow finalize write via
//     `submissionFinalizationDocRef(...).update(...)`               (typed ref)
//   - audit event via `writeAuditEvent({...})`                      (§5 helper)
//
// Ownership: the caller's uid must match the persisted `studentId` and
// the caller's schoolId claim must match the persisted `schoolId`. Only
// the owning student may finalize their own submission; teacher and
// administrator finalization are out of scope for Sprint 5A.
//
// Idempotency: an already-`finalized` record owned by the caller returns
// `alreadyFinalized: true` with no second write and no second audit
// event. Every other current status is rejected with
// `submissions.invalidTransition`.
async function submissionsFinalizeHandler(
  request: CallableRequest<unknown>,
): Promise<SubmissionsFinalizeResponse> {
  // Sprint 11C Remediation Slice 1 (C-4). PDR-026 §26 requires that the
  // legacy `submissions` write path and the authoritative `attempts`
  // write path are never simultaneously writable in production. See
  // `assertLegacySubmissionsWritesEnabled` for the deployment gate.
  assertLegacySubmissionsWritesEnabled();

  const actor = assertAuthenticatedStudent(request);
  const input = validateRequest(request.data);

  const existing = await loadSubmission(input.submissionId);

  if (
    existing.studentId !== actor.uid ||
    existing.schoolId !== actor.schoolId
  ) {
    throw new PlatformError(
      "submissions.forbidden",
      "Caller does not own this submission.",
    );
  }

  if (existing.status === "finalized") {
    safeLog(() =>
      log.info("submissions.finalizeIdempotent", {
        actorUserId: actor.uid,
        submissionId: input.submissionId,
      }),
    );
    return {
      submissionId: input.submissionId,
      status: "finalized",
      alreadyFinalized: true,
    };
  }

  if (existing.status !== "submitted") {
    throw new PlatformError(
      "submissions.invalidTransition",
      `Cannot transition from "${String(existing.status)}" to "finalized".`,
    );
  }

  await loadActiveEnrollment(existing.classId, actor.uid);

  const write: SubmissionFinalizationWrite = {
    status: "finalized",
    submittedAt: FieldValue.serverTimestamp(),
    ...(input.responses !== undefined ? { responses: input.responses } : {}),
    ...(input.score !== undefined ? { score: input.score } : {}),
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    ...(input.attemptCount !== undefined
      ? { attemptCount: input.attemptCount }
      : {}),
  };

  await submissionFinalizationDocRef(input.submissionId).update(write);

  await writeAuditEvent({
    actorUserId: actor.uid,
    actorRole: "student",
    action: "submissions.finalized",
    targetType: "submission",
    targetId: input.submissionId,
    schoolId: actor.schoolId,
    payload: {
      assignmentId: existing.assignmentId,
      classId: existing.classId,
      lessonSlug: existing.lessonSlug,
      lessonVersion: existing.lessonVersion,
    },
  });

  safeLog(() =>
    log.info("submissions.finalized", {
      actorUserId: actor.uid,
      submissionId: input.submissionId,
    }),
  );

  return {
    submissionId: input.submissionId,
    status: "finalized",
    alreadyFinalized: false,
  };
}

export const submissionsFinalize = platformCallable(submissionsFinalizeHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __submissionsFinalizeHandler = submissionsFinalizeHandler;
