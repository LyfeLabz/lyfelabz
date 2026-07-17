import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  attemptsCollectionRef,
  classDocRef,
  log,
  requireDistrictContext,
  type AssessmentAttemptRecord,
  type ClassRecord,
} from "../shared";
import {
  createRosterDisplayNameResolver,
  type ResolvedRosterDisplayName,
} from "../enrollments/resolve-roster-display-name";

// Approved teacher-visible summary of a completed attempt in one owned
// class per Sprint 12D Slice 1. The projection deliberately excludes every
// field the certified data model classifies as answer-key material,
// scoring internal, teacher-only routing metadata, internal audit, or
// district-security internal per ASSESSMENT_SCORING_CONTRACT.md sections
// 7 and 10.4 and ASSESSMENT_IMPLEMENTATION_CONTRACT.md sections 13, 14,
// and 22. In particular the per-item scoring artifacts (`itemResults`,
// containing `correctOptionId` and `explanation`) and the raw session
// responses are never surfaced through the retrieval layer; those payloads
// remain confined to the finalize response boundary where they are first
// delivered.
//
// `studentId` is the opaque stable reference. `studentDisplayName` is
// resolved through the canonical roster display-name resolver in the
// enrollments domain (PDR-028 section 9): the enrollment
// `displayNameOverride` takes precedence, then the user profile
// `displayName`, and finally a fixed non-empty fallback. No name is ever
// read from the attempt document; attempts remain opaque per Data Model
// section 3.7 and ASSESSMENT_PIPELINE_SPECIFICATION.md section 466.
export type TeacherClassAttemptSummary = {
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
};

export type AssessmentAttemptsListForClassRequest = {
  readonly classId: string;
};

export type AssessmentAttemptsListForClassResponse = {
  readonly classId: string;
  readonly attempts: readonly TeacherClassAttemptSummary[];
};

// Forbidden top-level keys on the request. Caller identity and district
// scoping are derived from the verified caller context and the loaded
// class record; a client that supplies any owner-scoping identifier is
// refused so no laundering path can suggest cross-owner access.
const FORBIDDEN_REQUEST_KEYS: readonly string[] = [
  "studentId",
  "uid",
  "userId",
  "districtId",
  "schoolId",
  "teacherId",
];

const CLASS_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateRequest(
  data: unknown,
): AssessmentAttemptsListForClassRequest {
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
  if (!("classId" in payload)) {
    throw new PlatformError(
      "classes.invalidClassId",
      "classId must be a non-empty string.",
    );
  }
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
  return { classId };
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

// Project the persisted attempt record into the approved teacher-visible
// summary. The projection is defensive: it never spreads the source record
// and never adds a passthrough for unknown fields, so a future addition to
// the persisted record shape cannot silently widen the retrieval surface.
export function projectTeacherClassAttemptSummary(
  attemptId: string,
  attempt: AssessmentAttemptRecord,
  resolved: ResolvedRosterDisplayName,
): TeacherClassAttemptSummary {
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
  };
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

// assessmentAttemptsListForClass
//
// Returns completed attempt summaries for exactly one class owned by the
// authenticated teacher. Sprint 12D Slice 1 (retrieval, authenticated
// teacher surface).
//
// Authorization is layered:
//   1. `requireDistrictContext(request)` gates authentication, active
//      status, canonical claims, and district agreement (PDR-025 sections
//      5 through 6 and 15). Non-teacher callers are refused with
//      `role-forbidden`.
//   2. The request shape is validated: `classId` must be a URL-safe
//      token; any owner-scoping key (`studentId`, `uid`, `userId`,
//      `districtId`, `schoolId`, `teacherId`) is refused with
//      `assessmentAttempts.invalidRequest`.
//   3. The class record is loaded via `classDocRef(classId).get()`. A
//      missing record is refused with `classes.notFound`.
//   4. Class ownership: the record's frozen `teacherId` MUST equal the
//      caller's verified uid AND the record's frozen `schoolId` MUST
//      equal the caller's verified `schoolId`. Any mismatch is refused
//      with `classes.forbidden`, so cross-teacher and cross-school access
//      are both denied with the canonical class-boundary identifier. Per
//      the LyfeLabz Firestore Data Model, class ownership fields are
//      immutable, so a matching district or a matching school on its own
//      never authorizes access.
//
// Query:
//   - `attempts.where("classId", "==", classId)` reuses the auto-created
//     single-field index. No composite index is introduced. Every returned
//     document is defense-in-depth-checked against the loaded class
//     record's ownership fields (`teacherId`, `schoolId`, `districtId`)
//     before projection; a mismatch on any candidate document is treated
//     as a silent drop rather than an error because the sole documented
//     cause is a data-invariant violation the retrieval layer must not
//     amplify.
//
// Historical membership:
//   - Class ownership fields (`teacherId`, `schoolId`) are immutable per
//     Data Model section 1.2, so every attempt stamped with the given
//     `classId` shares the same frozen `teacherId` and `schoolId` as the
//     current class record. Current class ownership therefore authorizes
//     the full historical set of attempts for that class. A student who
//     later leaves the class does not disappear from that history because
//     enrollment status is orthogonal to the immutable attempt record.
//
// Projection:
//   - Only the fields enumerated on `TeacherClassAttemptSummary` cross
//     the callable boundary. `itemResults`, `responses`, `idempotencyKey`,
//     `teacherId`, `classId`, `schoolId`, `districtId`, `activityId`, and
//     every future addition to the persisted record are excluded by
//     construction.
async function assessmentAttemptsListForClassHandler(
  request: CallableRequest<unknown>,
): Promise<AssessmentAttemptsListForClassResponse> {
  const actor = await assertActiveTeacherInDistrict(request);
  const input = validateRequest(request.data);

  const existing = await loadClass(input.classId);

  if (
    existing.teacherId !== actor.uid ||
    existing.schoolId !== actor.schoolId
  ) {
    throw new PlatformError(
      "classes.forbidden",
      "Caller does not own this class.",
    );
  }

  const snapshot = await attemptsCollectionRef()
    .where("classId", "==", input.classId)
    .get();

  const admitted: Array<{ id: string; data: AssessmentAttemptRecord }> = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!data) continue;
    if (data.teacherId !== actor.uid) continue;
    if (data.schoolId !== actor.schoolId) continue;
    if (data.districtId !== actor.districtId) continue;
    admitted.push({ id: doc.id, data });
  }

  // Canonical roster display-name resolver, memoized per request. Multiple
  // attempts by the same student share one resolved name and one pair of
  // Firestore reads.
  const resolveDisplayName = createRosterDisplayNameResolver({
    classId: input.classId,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
  });

  const summaries: TeacherClassAttemptSummary[] = await Promise.all(
    admitted.map(async (entry) => {
      const resolved = await resolveDisplayName(entry.data.studentId);
      return projectTeacherClassAttemptSummary(entry.id, entry.data, resolved);
    }),
  );

  summaries.sort((a, b) => {
    if (b.submittedAt !== a.submittedAt) return b.submittedAt - a.submittedAt;
    return a.attemptId < b.attemptId ? -1 : a.attemptId > b.attemptId ? 1 : 0;
  });

  safeLog(() =>
    log.info("assessmentAttempts.listedForClass", {
      actorUserId: actor.uid,
      classId: input.classId,
      count: summaries.length,
    }),
  );

  return { classId: input.classId, attempts: summaries };
}

export const assessmentAttemptsListForClass = platformCallable(
  assessmentAttemptsListForClassHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assessmentAttemptsListForClassHandler =
  assessmentAttemptsListForClassHandler;
