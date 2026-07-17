import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  attemptDocRef,
  classDocRef,
  log,
  requireDistrictContext,
  type AssessmentAttemptRecord,
  type AssessmentAttemptItemResult,
  type ClassRecord,
} from "../shared";
import {
  createRosterDisplayNameResolver,
  type ResolvedRosterDisplayName,
} from "../enrollments/resolve-roster-display-name";
import type { AssessmentSessionResponse } from "../shared/types/assessment-session";

// Client-supplied request payload for assessmentAttemptGetForTeacher.
// The attempt identifier is the only accepted field; the loaded attempt
// document and the verified caller context together determine every
// ownership decision. Any owner-scoping key on the request is refused
// so no laundering path can suggest cross-owner access.
export type AssessmentAttemptGetForTeacherRequest = {
  readonly attemptId: string;
};

// Teacher-visible per-item response projection. `response` remains an
// opaque structured value carried verbatim from the frozen attempt record
// (ASSESSMENT_SCORING_CONTRACT.md sections 8 and 10.3). No scoring artifact
// is added; the response value itself is what the student submitted.
export type TeacherVisibleAttemptResponse = {
  readonly itemId: string;
  readonly response: unknown;
};

// Teacher-visible per-item scoring result projection. Every field is
// sourced from the immutable attempt record (never from the
// `assessmentAnswerKeys/*` collection); `correctOptionId` and `explanation`
// are the permitted subset of answer-key material frozen on the attempt at
// finalize per ASSESSMENT_SCORING_CONTRACT.md sections 10.3 and 10.4 and
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md sections 15 and 20.
export type TeacherVisibleAttemptItemResult = {
  readonly itemId: string;
  readonly isCorrect: boolean;
  readonly pointsEarned: number;
  readonly correctOptionId: string;
  readonly explanation: string;
  readonly studentResponse: string | null;
};

// Approved teacher-visible detail of a completed attempt in one owned
// class per Sprint 12D Slice 3. The projection matches the summary shape
// used by `assessmentAttemptsListForClass` (Slice 1) and extends it with
// the per-item detail fields the certified data model classifies as
// readable by the owning class teacher (ASSESSMENT_IMPLEMENTATION_CONTRACT
// section 20, Sprint 12A Data Access Review section 7.2). Every field the
// certified model classifies as answer-key source (raw
// `assessmentAnswerKeys/*` payload), scoring internal outside the frozen
// attempt subset, teacher-only routing metadata, or audit metadata is
// excluded by construction.
export type TeacherVisibleAttemptDetail = {
  readonly attemptId: string;
  readonly studentId: string;
  readonly studentDisplayName: string;
  readonly assessmentId: string;
  readonly assignmentId: string;
  readonly assessmentRevisionId: string;
  readonly attemptNumber: number;
  readonly score: number;
  readonly maxScore: number;
  readonly percentage: number;
  readonly submittedAt: number;
  readonly status: "completed";
  readonly responses: readonly TeacherVisibleAttemptResponse[];
  readonly itemResults: readonly TeacherVisibleAttemptItemResult[];
};

export type AssessmentAttemptGetForTeacherResponse = {
  readonly attempt: TeacherVisibleAttemptDetail;
};

const ATTEMPT_ID_PATTERN =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,254}[a-zA-Z0-9])?$/;

// Forbidden top-level keys on the request. Caller identity and every
// ownership scope are derived from the verified caller context and the
// loaded attempt record; a client that supplies any owner-scoping,
// routing, or lifecycle identifier is refused with a single canonical
// invalid-request identifier so no laundering path can suggest
// cross-owner access.
const FORBIDDEN_REQUEST_KEYS: readonly string[] = [
  "studentId",
  "uid",
  "userId",
  "districtId",
  "schoolId",
  "classId",
  "teacherId",
  "assignmentId",
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateRequest(
  data: unknown,
): AssessmentAttemptGetForTeacherRequest {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new PlatformError(
      "assessmentAttempts.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;
  for (const key of FORBIDDEN_REQUEST_KEYS) {
    if (key in payload) {
      throw new PlatformError(
        "assessmentAttempts.invalidRequest",
        `Field "${key}" is not permitted on the request.`,
      );
    }
  }
  if (!isNonEmptyString(payload.attemptId)) {
    throw new PlatformError(
      "assessmentAttempts.invalidAttemptId",
      "attemptId must be a non-empty string.",
    );
  }
  const attemptId = payload.attemptId.trim();
  if (!ATTEMPT_ID_PATTERN.test(attemptId)) {
    throw new PlatformError(
      "assessmentAttempts.invalidAttemptId",
      "attemptId must be a URL-safe token.",
    );
  }
  return { attemptId };
}

async function assertActiveTeacherInDistrict(
  request: CallableRequest<unknown>,
): Promise<{
  readonly uid: string;
  readonly schoolId: string;
  readonly districtId: string;
}> {
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

async function loadAttempt(
  attemptId: string,
): Promise<AssessmentAttemptRecord> {
  const snapshot = await attemptDocRef(attemptId).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "assessmentAttempts.notFound",
      "Referenced attempt was not found.",
    );
  }
  const attempt = snapshot.data();
  if (!attempt) {
    throw new PlatformError(
      "assessmentAttempts.notFound",
      "Referenced attempt record was empty.",
    );
  }
  return attempt;
}

async function loadClass(classId: string): Promise<ClassRecord> {
  const snapshot = await classDocRef(classId).get();
  if (!snapshot.exists) {
    throw new PlatformError("classes.notFound", "Class was not found.");
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError("classes.notFound", "Class record was empty.");
  }
  return data;
}

// Defensive projection of a single frozen response element. The `response`
// value is preserved verbatim (the teacher must see what the student
// submitted); every other property that a future writer might attach is
// discarded because the output shape enumerates its fields.
function projectResponse(
  response: AssessmentSessionResponse,
): TeacherVisibleAttemptResponse {
  return {
    itemId: response.itemId,
    response: response.response,
  };
}

// Defensive projection of a single frozen item-result element. The subset
// is the certified teacher-visible superset (Sprint 12A section 7.2) which
// equals the certified student-visible subset (ASSESSMENT_SCORING_CONTRACT
// section 10.3). No field outside this enumeration crosses the boundary.
function projectItemResult(
  item: AssessmentAttemptItemResult,
): TeacherVisibleAttemptItemResult {
  return {
    itemId: item.itemId,
    isCorrect: item.isCorrect,
    pointsEarned: item.pointsEarned,
    correctOptionId: item.correctOptionId,
    explanation: item.explanation,
    studentResponse: item.studentResponse,
  };
}

// Project the persisted attempt record into the approved teacher-visible
// detail. The projection never spreads the source record and never adds a
// passthrough for unknown fields, so a future addition to the persisted
// record shape cannot silently widen the retrieval surface.
export function projectTeacherAttemptDetail(
  attemptId: string,
  attempt: AssessmentAttemptRecord,
  resolved: ResolvedRosterDisplayName,
): TeacherVisibleAttemptDetail {
  return {
    attemptId,
    studentId: attempt.studentId,
    studentDisplayName: resolved.displayName,
    assessmentId: attempt.assessmentId,
    assignmentId: attempt.assignmentId,
    assessmentRevisionId: attempt.assessmentRevisionId,
    attemptNumber: attempt.attemptNumber,
    score: attempt.score,
    maxScore: attempt.maxScore,
    percentage: attempt.percentage,
    submittedAt: attempt.submittedAt.toMillis(),
    status: "completed",
    responses: attempt.responses.map(projectResponse),
    itemResults: attempt.itemResults.map(projectItemResult),
  };
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

// assessmentAttemptGetForTeacher
//
// Returns a single completed attempt owned by a class the authenticated
// teacher currently owns. Sprint 12D Slice 3 (retrieval, authenticated
// teacher surface for individual-submission drill-down).
//
// Authorization is layered:
//   1. `requireDistrictContext(request)` gates authentication, active
//      status, canonical claims, and district agreement (PDR-025 sections
//      5 through 6 and 15). Non-teacher callers are refused with
//      `role-forbidden`.
//   2. The request shape is validated: `attemptId` must be a URL-safe
//      token; any owner-scoping key (`studentId`, `uid`, `userId`,
//      `districtId`, `schoolId`, `classId`, `teacherId`, `assignmentId`)
//      is refused with `assessmentAttempts.invalidRequest`.
//   3. The attempt document is loaded via `attemptDocRef(attemptId).get()`.
//      A missing or empty record is refused with
//      `assessmentAttempts.notFound`.
//   4. The attempt's frozen `districtId` MUST equal the caller's verified
//      `districtId`; a cross-district attempt is refused with the generic
//      `assessmentAttempts.forbidden` identifier so no observer can
//      distinguish a cross-district attempt from an attempt that does not
//      exist in another district.
//   5. The attempt's frozen `schoolId` MUST equal the caller's verified
//      `schoolId`; a cross-school attempt is refused with
//      `assessmentAttempts.forbidden` for the same reason.
//   6. The attempt's frozen `classId` MUST be a non-empty string; a
//      malformed record is refused with `assessmentAttempts.notFound`
//      because the retrieval layer never surfaces a data-invariant
//      violation to the client.
//   7. The referenced class is loaded via `classDocRef(classId).get()`. A
//      missing record is refused with `classes.notFound`.
//   8. Class ownership: the class record's frozen `teacherId` MUST equal
//      the caller's verified uid AND the class record's frozen `schoolId`
//      MUST equal the caller's verified `schoolId`. Any mismatch is
//      refused with `classes.forbidden`, so cross-teacher and cross-school
//      access are both denied with the canonical class-boundary
//      identifier. Per the LyfeLabz Firestore Data Model, class ownership
//      fields are immutable, so a matching district or a matching school
//      on its own never authorizes access, and current class ownership
//      matches frozen class ownership by construction.
//   9. Defense in depth: the attempt's frozen `teacherId` MUST equal the
//      class record's `teacherId`, and the attempt's frozen `schoolId`
//      MUST equal the class record's `schoolId`. A stored inconsistency
//      is treated as a malformed record (`assessmentAttempts.notFound`)
//      so the retrieval layer never returns a document whose frozen
//      ownership fields disagree with the authoritative class record.
//
// Historical membership:
//   - Class ownership fields (`teacherId`, `schoolId`) are immutable per
//     Data Model section 1.2. Current class ownership by the authenticated
//     teacher therefore authorizes the full historical set of attempts
//     for that class, including attempts by students who have since
//     exited the class, because enrollment status is orthogonal to the
//     immutable attempt record. A teacher who never owned the class is
//     refused at step 8 and cannot reach the projection.
//
// Projection:
//   - Only the fields enumerated on `TeacherVisibleAttemptDetail` cross
//     the callable boundary. `idempotencyKey`, `teacherId`, `classId`,
//     `schoolId`, `districtId`, `activityId`, and every future addition to
//     the persisted record are excluded by construction. The per-item
//     projection sub-helpers enumerate their outputs so future additions
//     to `AssessmentSessionResponse` or `AssessmentAttemptItemResult`
//     cannot silently widen the retrieval surface either.
//
// Answer-key confidentiality:
//   - The callable never reads `assessmentAnswerKeys/*`. `correctOptionId`
//     and `explanation` are the certified permitted subset of answer-key
//     material frozen on the immutable attempt document by the scorer
//     (ASSESSMENT_SCORING_CONTRACT.md sections 10.3 and 10.4). Returning
//     them here does not widen the answer-key boundary because no
//     answer-key collection is read.
async function assessmentAttemptGetForTeacherHandler(
  request: CallableRequest<unknown>,
): Promise<AssessmentAttemptGetForTeacherResponse> {
  const actor = await assertActiveTeacherInDistrict(request);
  const input = validateRequest(request.data);

  const attempt = await loadAttempt(input.attemptId);

  if (attempt.districtId !== actor.districtId) {
    throw new PlatformError(
      "assessmentAttempts.forbidden",
      "Caller does not have access to this attempt.",
    );
  }
  if (attempt.schoolId !== actor.schoolId) {
    throw new PlatformError(
      "assessmentAttempts.forbidden",
      "Caller does not have access to this attempt.",
    );
  }
  if (!isNonEmptyString(attempt.classId)) {
    throw new PlatformError(
      "assessmentAttempts.notFound",
      "Attempt record is missing its class reference.",
    );
  }
  if (!isNonEmptyString(attempt.studentId)) {
    throw new PlatformError(
      "assessmentAttempts.notFound",
      "Attempt record is missing its student reference.",
    );
  }

  const classRecord = await loadClass(attempt.classId);

  if (
    classRecord.teacherId !== actor.uid ||
    classRecord.schoolId !== actor.schoolId
  ) {
    throw new PlatformError(
      "classes.forbidden",
      "Caller does not own the class that owns this attempt.",
    );
  }

  if (
    attempt.teacherId !== classRecord.teacherId ||
    attempt.schoolId !== classRecord.schoolId
  ) {
    throw new PlatformError(
      "assessmentAttempts.notFound",
      "Attempt record has inconsistent frozen ownership fields.",
    );
  }

  const resolveDisplayName = createRosterDisplayNameResolver({
    classId: attempt.classId,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
  });
  const resolved = await resolveDisplayName(attempt.studentId);

  safeLog(() =>
    log.info("assessmentAttempts.retrievedForTeacher", {
      actorUserId: actor.uid,
      attemptId: input.attemptId,
    }),
  );

  return {
    attempt: projectTeacherAttemptDetail(input.attemptId, attempt, resolved),
  };
}

export const assessmentAttemptGetForTeacher = platformCallable(
  assessmentAttemptGetForTeacherHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assessmentAttemptGetForTeacherHandler =
  assessmentAttemptGetForTeacherHandler;
