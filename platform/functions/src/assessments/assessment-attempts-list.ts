import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  attemptsCollectionRef,
  log,
  requireDistrictContext,
  type AssessmentAttemptRecord,
} from "../shared";

// Approved student-visible summary of a completed attempt per
// Sprint 12C Slice 1. The projection deliberately excludes every field the
// certified data model classifies as answer-key material, scoring
// internal, teacher-only metadata, internal audit, or district-security
// internal per ASSESSMENT_SCORING_CONTRACT.md §7, §10.4 and
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §13, §14, §22. In particular the
// per-item scoring artifacts (`itemResults`, containing `correctOptionId`
// and `explanation`) and the raw session responses are never surfaced
// through the retrieval layer; those payloads remain confined to the
// finalize response boundary where they are first delivered.
export type AssessmentAttemptSummary = {
  readonly attemptId: string;
  readonly assessmentId: string;
  readonly assignmentId: string;
  readonly assessmentRevisionId: string;
  readonly attemptNumber: number;
  readonly score: number;
  readonly maxScore: number;
  readonly percentage: number;
  readonly submittedAt: number;
  readonly status: "completed";
};

export type AssessmentAttemptsListRequest = Record<string, never>;

export type AssessmentAttemptsListResponse = {
  readonly attempts: readonly AssessmentAttemptSummary[];
};

// Forbidden top-level keys on the list request. The callable never accepts
// a student identifier or any district-scoping input; caller identity is
// the sole authorization source. Rejecting the field on shape is preferred
// to silent ignore so a broken client is surfaced quickly and no laundering
// path can suggest cross-student access.
const FORBIDDEN_REQUEST_KEYS: readonly string[] = [
  "studentId",
  "uid",
  "userId",
  "districtId",
  "schoolId",
  "classId",
  "teacherId",
];

function validateRequest(data: unknown): void {
  if (data === undefined || data === null) return;
  if (typeof data !== "object" || Array.isArray(data)) {
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
}

async function assertActiveStudentInDistrict(
  request: CallableRequest<unknown>,
): Promise<{
  readonly uid: string;
  readonly schoolId: string;
  readonly districtId: string;
}> {
  const context = await requireDistrictContext(request);
  if (context.role !== "student") {
    throw new PlatformError(
      "role-forbidden",
      "Caller must be an active student.",
    );
  }
  return {
    uid: context.uid,
    schoolId: context.schoolId,
    districtId: context.districtId,
  };
}

// Project the persisted attempt record into the approved student-visible
// summary. The projection is defensive: it never spreads the source record
// and never adds a passthrough for unknown fields, so a future addition to
// the persisted record shape cannot silently widen the retrieval surface.
export function projectAttemptSummary(
  attemptId: string,
  attempt: AssessmentAttemptRecord,
): AssessmentAttemptSummary {
  return {
    attemptId,
    assessmentId: attempt.assessmentId,
    assignmentId: attempt.assignmentId,
    assessmentRevisionId: attempt.assessmentRevisionId,
    attemptNumber: attempt.attemptNumber,
    score: attempt.score,
    maxScore: attempt.maxScore,
    percentage: attempt.percentage,
    submittedAt: attempt.submittedAt.toMillis(),
    status: "completed",
  };
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

// assessmentAttemptsList
//
// Returns the authenticated student's completed attempt history. Sprint 12C
// Slice 1 (retrieval, authenticated student surface).
//
// Authorization:
//   - `requireDistrictContext(request)` gates authentication, active
//     status, canonical claims, and district agreement (PDR-025 §5-§6,
//     §15). Non-student callers are refused with `role-forbidden`.
//   - The student identity used to scope the query is derived entirely
//     from the verified caller context. The callable never accepts a
//     `studentId` (or any equivalent identifier) on the request.
//
// Query:
//   - `attempts.where("studentId", "==", uid)` reuses the auto-created
//     single-field index. No composite index is introduced. Every returned
//     document is defense-in-depth-checked against the caller's verified
//     `districtId` and `schoolId` before projection; a district or school
//     mismatch on any candidate document is treated as a silent drop
//     rather than an error because the sole documented cause is a data
//     invariant violation the retrieval layer must not amplify.
//
// Projection:
//   - Only the fields enumerated on `AssessmentAttemptSummary` cross the
//     callable boundary. `itemResults`, `responses`, `idempotencyKey`,
//     `teacherId`, `classId`, `schoolId`, `districtId`, `activityId`, and
//     every future addition to the persisted record are excluded by
//     construction.
async function assessmentAttemptsListHandler(
  request: CallableRequest<unknown>,
): Promise<AssessmentAttemptsListResponse> {
  const actor = await assertActiveStudentInDistrict(request);
  validateRequest(request.data);

  const snapshot = await attemptsCollectionRef()
    .where("studentId", "==", actor.uid)
    .get();

  const summaries: AssessmentAttemptSummary[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!data) continue;
    if (data.districtId !== actor.districtId) continue;
    if (data.schoolId !== actor.schoolId) continue;
    summaries.push(projectAttemptSummary(doc.id, data));
  }

  summaries.sort((a, b) => b.submittedAt - a.submittedAt);

  safeLog(() =>
    log.info("assessmentAttempts.listed", {
      actorUserId: actor.uid,
      count: summaries.length,
    }),
  );

  return { attempts: summaries };
}

export const assessmentAttemptsList = platformCallable(
  assessmentAttemptsListHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assessmentAttemptsListHandler = assessmentAttemptsListHandler;
