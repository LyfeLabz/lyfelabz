import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  attemptDocRef,
  log,
  requireDistrictContext,
} from "../shared";

import {
  projectAttemptSummary,
  type AssessmentAttemptSummary,
} from "./assessment-attempts-list";

// Client-supplied request payload for assessmentAttemptGet. The attempt
// identifier is the only accepted field; ownership and district scoping
// are derived from the verified caller context per Sprint 12C Slice 1.
export type AssessmentAttemptGetRequest = {
  readonly attemptId: string;
};

export type AssessmentAttemptGetResponse = {
  readonly attempt: AssessmentAttemptSummary;
};

const ATTEMPT_ID_PATTERN =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,254}[a-zA-Z0-9])?$/;

// Forbidden top-level keys on the get request. Caller identity is the
// authorization source; a client that supplies any ownership or district
// identifier is refused so no laundering path can suggest cross-owner
// access.
const FORBIDDEN_REQUEST_KEYS: readonly string[] = [
  "studentId",
  "uid",
  "userId",
  "districtId",
  "schoolId",
  "classId",
  "teacherId",
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateRequest(data: unknown): { readonly attemptId: string } {
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

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

// assessmentAttemptGet
//
// Returns a single completed attempt owned by the authenticated student.
// Sprint 12C Slice 1 (retrieval, authenticated student surface).
//
// Authorization is layered:
//   1. `requireDistrictContext(request)` gates authentication, active
//      status, canonical claims, and district agreement (PDR-025 §5-§6,
//      §15). Non-student callers are refused with `role-forbidden`.
//   2. Ownership: the attempt's frozen `studentId` MUST equal the caller's
//      verified uid. Any mismatch is refused as `assessmentAttempts.notOwned`
//      (mapped to `permission-denied`). The refusal never distinguishes
//      "another student's attempt" from "not found" beyond the canonical
//      error identifier space; a missing document surfaces
//      `assessmentAttempts.notFound`.
//   3. District: the attempt's frozen `districtId` MUST equal the caller's
//      verified `districtId`. Cross-district access is refused with
//      canonical `district-mismatch`.
//   4. School: the attempt's frozen `schoolId` MUST equal the caller's
//      verified `schoolId`. School mismatch is refused with
//      `assessmentAttempts.forbidden`.
//
// The projection reuses the exported `projectAttemptSummary` so the
// approved field set is enforced once for both retrieval callables. No
// answer-key, scoring-internal, teacher-only, or audit field crosses the
// callable boundary.
async function assessmentAttemptGetHandler(
  request: CallableRequest<unknown>,
): Promise<AssessmentAttemptGetResponse> {
  const actor = await assertActiveStudentInDistrict(request);
  const input = validateRequest(request.data);

  const snapshot = await attemptDocRef(input.attemptId).get();
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

  if (attempt.studentId !== actor.uid) {
    throw new PlatformError(
      "assessmentAttempts.notOwned",
      "Caller does not own the referenced attempt.",
    );
  }
  if (attempt.districtId !== actor.districtId) {
    throw new PlatformError(
      "district-mismatch",
      "Caller does not have access to this attempt.",
    );
  }
  if (attempt.schoolId !== actor.schoolId) {
    throw new PlatformError(
      "assessmentAttempts.forbidden",
      "Caller does not have access to this attempt.",
    );
  }

  safeLog(() =>
    log.info("assessmentAttempts.retrieved", {
      actorUserId: actor.uid,
      attemptId: input.attemptId,
    }),
  );

  return { attempt: projectAttemptSummary(input.attemptId, attempt) };
}

export const assessmentAttemptGet = platformCallable(
  assessmentAttemptGetHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assessmentAttemptGetHandler = assessmentAttemptGetHandler;
