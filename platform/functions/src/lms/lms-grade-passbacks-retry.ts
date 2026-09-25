import { type CallableRequest } from "firebase-functions/v2/https";

import {
  assignmentDocRef,
  platformCallable,
  PlatformError,
  requireDistrictContext,
  writeAuditEvent,
} from "../shared";

import {
  synchronizeGradePassback,
  type GradePassbackSyncOutcome,
} from "./grade-passback/engine";
import { googleClassroomProductionSecrets } from "./providers/google-classroom/config-firebase";

// lmsGradePassbacksRetry
//
// Sprint 30A.2 - the NARROW teacher-facing manual retry capability for
// Google Classroom best-score grade passback. Exists because the current
// platform has no background queue (LYFELABZ_CLOUD_FUNCTION_CHARTER.md):
// if Classroom is temporarily unavailable when a student finalizes an
// attempt and the student never attempts again, the sync would otherwise
// remain permanently unsyncable. This callable gives a teacher a way to
// re-trigger synchronization for one (assignment, student) pair.
//
// Contract summary (all locked, Sprint 30A.2 specification):
//   - Requires an authenticated, active teacher who owns the assignment.
//   - Accepts only `assignmentId` and `studentId` - the minimum identifier
//     needed. It NEVER accepts a grade value from the caller; there is no
//     "force grade to X" capability and no manual editing of grade
//     values.
//   - Only applies to graded Classroom assignments
//     (`assignment.classroomGrading?.mode === "graded"`); an ungraded or
//     legacy assignment is refused before the synchronizer is ever
//     invoked.
//   - Recomputes the current canonical best LyfeLabz performance and
//     invokes the EXACT SAME monotonic synchronization engine attempt
//     finalization uses (`synchronizeGradePassback`) - there is no second,
//     retry-specific sync algorithm.
//   - Returns a bounded, product-safe status. It never exposes a raw
//     Google error, a Classroom submission id, a provider account id, or
//     internal lease/generation state.
export type LmsGradePassbacksRetryRequest = {
  readonly assignmentId: string;
  readonly studentId: string;
};

export type LmsGradePassbacksRetryStatus =
  | "synced"
  | "pending"
  | "failed"
  | "notApplicable";

// `status` keeps the established four-value contract the client validates.
// `detail` (additive) says exactly what the fresh evaluation found, e.g.
// `{ outcome: "noChange", action: "preservedClassroomHigher" }` or
// `{ outcome: "destinationUnavailable", reason: "courseworkDeleted" }`. It
// never carries a grade value, Classroom id, or credential material.
export type LmsGradePassbacksRetryResponse = {
  readonly ok: true;
  readonly status: LmsGradePassbacksRetryStatus;
  readonly detail: {
    readonly outcome: GradePassbackSyncOutcome["outcome"];
    readonly action?: string;
    readonly reason?: string;
  };
};

const ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,254}[a-zA-Z0-9])?$/;

function requireIdToken(value: unknown, code: string, message: string): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new PlatformError(code, message);
  }
  return value;
}

function validateRequest(data: unknown): LmsGradePassbacksRetryRequest {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new PlatformError(
      "gradePassback.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;
  const assignmentId = requireIdToken(
    payload.assignmentId,
    "gradePassback.invalidAssignmentId",
    "assignmentId must be a URL-safe token.",
  );
  const studentId = requireIdToken(
    payload.studentId,
    "gradePassback.invalidStudentId",
    "studentId must be a URL-safe token.",
  );
  return { assignmentId, studentId };
}

function mapOutcomeToStatus(
  outcome: GradePassbackSyncOutcome["outcome"],
): LmsGradePassbacksRetryStatus {
  switch (outcome) {
    // Classroom now holds (or already held) an acceptable grade.
    case "synced":
    case "alreadySynced":
    case "noChange":
      return "synced";
    case "noAttempts":
    case "deferred":
      return "pending";
    // Nothing to write by rule: protected Classroom grade, student outside
    // the grade-sync roster, or an ungraded destination.
    case "notApplicable":
    case "protected":
    case "outsideRoster":
      return "notApplicable";
    case "noPublication":
    case "destinationUnavailable":
    case "destinationChanged":
    case "failed":
      return "failed";
  }
}

function detailOf(result: GradePassbackSyncOutcome): LmsGradePassbacksRetryResponse["detail"] {
  switch (result.outcome) {
    case "synced":
    case "noChange":
    case "protected":
      return { outcome: result.outcome, action: result.action };
    case "destinationUnavailable":
      return { outcome: result.outcome, reason: result.status };
    case "failed":
      return { outcome: result.outcome, reason: result.errorCode };
    default:
      return { outcome: result.outcome };
  }
}

async function lmsGradePassbacksRetryHandler(
  request: CallableRequest<unknown>,
): Promise<LmsGradePassbacksRetryResponse> {
  const context = await requireDistrictContext(request);
  if (context.role !== "teacher") {
    throw new PlatformError(
      "role-forbidden",
      "Caller must be an active teacher.",
    );
  }

  const { assignmentId, studentId } = validateRequest(request.data);

  // Server-side ownership verification: never trust a client claim.
  const assignmentSnapshot = await assignmentDocRef(assignmentId).get();
  if (!assignmentSnapshot.exists) {
    throw new PlatformError(
      "gradePassback.forbidden",
      "Caller does not own this assignment.",
    );
  }
  const assignment = assignmentSnapshot.data();
  if (
    !assignment ||
    assignment.teacherId !== context.uid ||
    assignment.schoolId !== context.schoolId
  ) {
    throw new PlatformError(
      "gradePassback.forbidden",
      "Caller does not own this assignment.",
    );
  }

  if (assignment.classroomGrading?.mode !== "graded") {
    throw new PlatformError(
      "gradePassback.notGraded",
      "This assignment is not configured for Google Classroom grading.",
    );
  }

  try {
    await writeAuditEvent({
      actorUserId: context.uid,
      actorRole: "teacher",
      action: "lms.gradePassbackRetryRequested",
      targetType: "assignment",
      targetId: assignmentId,
      schoolId: context.schoolId,
      districtId: context.districtId,
      payload: { studentId },
    });
  } catch {
    // Audit failure is non-blocking, matching the existing lms.* convention.
  }

  // Retry means "re-evaluate this student's cumulative grade sync now",
  // never "repeat the historical write". The engine resolves Current fresh
  // from the canonical grouping (the assignment given here only identifies
  // the class + lesson family), runs the live destination preflight,
  // recomputes the cumulative best, re-reads the student's live Classroom
  // grade, and writes only if the canonical decision allows it.
  const result = await synchronizeGradePassback({
    assignmentId,
    studentId,
    districtId: context.districtId,
    trigger: "teacher",
  });

  return {
    ok: true,
    status: mapOutcomeToStatus(result.outcome),
    detail: detailOf(result),
  };
}

export const lmsGradePassbacksRetry = platformCallable(
  { secrets: [...googleClassroomProductionSecrets] },
  lmsGradePassbacksRetryHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __lmsGradePassbacksRetryHandler = lmsGradePassbacksRetryHandler;
