import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  assessmentSessionsCollectionRef,
  assignmentDocRef,
  attemptsCollectionRef,
  classDocRef,
  enrollmentsCollectionRef,
  log,
  requireDistrictContext,
  type AssessmentAttemptRecord,
  type AssessmentSessionRecord,
  type AssignmentRecord,
  type ClassRecord,
  type EnrollmentRecord,
} from "../shared";

// Client-supplied request payload for assessmentAssignmentSummary. The
// assignment identifier is the only accepted field; the loaded assignment
// document, its referenced class, and the verified caller context together
// determine every ownership decision. Any owner-scoping or aggregation key
// on the request is refused so no laundering path can suggest cross-owner
// access or hidden scope override.
export type AssessmentAssignmentSummaryRequest = {
  readonly assignmentId: string;
};

// Aggregate teacher-facing summary of one assignment. Every field is a
// bounded numeric aggregate; no student, attempt, session, enrollment,
// item-result, response, or answer-key value crosses the boundary. Score
// metrics are `null` when no completed attempt exists so the client renders
// an unambiguous empty state instead of misleading zeros.
export type AssessmentAssignmentSummaryResponse = {
  readonly assignmentId: string;
  readonly classId: string;
  readonly totalStudents: number;
  readonly completedStudents: number;
  readonly inProgressStudents: number;
  readonly notStartedStudents: number;
  readonly completionPercentage: number;
  readonly averagePercentage: number | null;
  readonly highestPercentage: number | null;
  readonly lowestPercentage: number | null;
  readonly perfectScoreStudents: number;
};

const ASSIGNMENT_ID_PATTERN =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,254}[a-zA-Z0-9])?$/;

// Forbidden top-level keys on the request. Caller identity and every
// ownership scope are derived from the verified caller context and the
// loaded assignment/class records; a client that supplies any owner-scoping,
// routing, filter, or aggregation identifier is refused with a single
// canonical invalid-request identifier so no laundering path can suggest
// cross-owner access or override the canonical population.
const FORBIDDEN_REQUEST_KEYS: readonly string[] = [
  "studentId",
  "uid",
  "userId",
  "districtId",
  "schoolId",
  "classId",
  "teacherId",
  "assessmentId",
  "assessmentRevisionId",
  "activityId",
  "attemptId",
  "sessionId",
  "startAt",
  "endAt",
  "from",
  "to",
  "groupBy",
  "aggregate",
  "filter",
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateRequest(
  data: unknown,
): AssessmentAssignmentSummaryRequest {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new PlatformError(
      "assignments.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;
  for (const key of FORBIDDEN_REQUEST_KEYS) {
    if (key in payload) {
      throw new PlatformError(
        "assignments.invalidRequest",
        `Field "${key}" is not permitted on the request.`,
      );
    }
  }
  if (!("assignmentId" in payload)) {
    throw new PlatformError(
      "assignments.invalidAssignmentId",
      "assignmentId must be a non-empty string.",
    );
  }
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
  return { assignmentId };
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

// Selects the score-metric-bearing attempt for a single completed student
// per the certified attempt-selection policy documented in the Sprint 12E
// Slice 1 completion report. The current policy is "highest completed
// attempt": among the student's valid frozen attempts for the assignment,
// pick the one with the largest `percentage`. Ties are broken by the
// larger `attemptNumber` and then by the lexicographic `attemptId` so the
// selection is fully deterministic and does not depend on Firestore
// document ordering. `AssessmentAttemptRecord.percentage`,
// `attemptNumber`, `score`, and `maxScore` are all frozen at finalize.
export type SelectedCompletedAttempt = {
  readonly attemptId: string;
  readonly percentage: number;
  readonly score: number;
  readonly maxScore: number;
  readonly attemptNumber: number;
};

export function selectHighestCompletedAttempt(
  attempts: readonly {
    readonly id: string;
    readonly data: AssessmentAttemptRecord;
  }[],
): SelectedCompletedAttempt | null {
  let best: SelectedCompletedAttempt | null = null;
  for (const { id, data } of attempts) {
    if (!isFiniteNumber(data.percentage)) continue;
    if (!isFiniteNumber(data.score)) continue;
    if (!isFiniteNumber(data.maxScore)) continue;
    if (!isFiniteNumber(data.attemptNumber)) continue;
    const candidate: SelectedCompletedAttempt = {
      attemptId: id,
      percentage: data.percentage,
      score: data.score,
      maxScore: data.maxScore,
      attemptNumber: data.attemptNumber,
    };
    if (best === null) {
      best = candidate;
      continue;
    }
    if (candidate.percentage > best.percentage) {
      best = candidate;
      continue;
    }
    if (candidate.percentage === best.percentage) {
      if (candidate.attemptNumber > best.attemptNumber) {
        best = candidate;
        continue;
      }
      if (
        candidate.attemptNumber === best.attemptNumber &&
        candidate.attemptId > best.attemptId
      ) {
        best = candidate;
      }
    }
  }
  return best;
}

// Deterministic rounding rule for the reported percentages: round to the
// nearest integer using half-up rounding. Repository convention keeps
// completion and score percentages as bounded integers on the wire so the
// client never has to decide how to display a decimal aggregate. The
// invariant `completed + inProgress + notStarted === totalStudents` holds
// on the underlying integer counts, not on the rounded completion
// percentage.
function roundPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = value < 0 ? 0 : value > 100 ? 100 : value;
  return Math.round(clamped);
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

// assessmentAssignmentSummary
//
// Returns aggregate teacher-facing metrics for one assignment owned by a
// class the authenticated teacher currently owns. Sprint 12E Slice 1
// (retrieval, authenticated teacher surface for the future assignment
// summary card).
//
// Authorization is layered:
//   1. `requireDistrictContext(request)` gates authentication, active
//      status, canonical claims, and district agreement (PDR-025 sections
//      5 through 6 and 15). Non-teacher callers are refused with
//      `role-forbidden`.
//   2. The request shape is validated: `assignmentId` must be a URL-safe
//      token; any owner-scoping, routing, or aggregation key is refused
//      with `assignments.invalidRequest`.
//   3. The assignment document is loaded via
//      `assignmentDocRef(assignmentId).get()`. A missing or empty record
//      is refused with `assignments.notFound`.
//   4. The assignment's frozen `schoolId` MUST equal the caller's verified
//      `schoolId` and its frozen `teacherId` MUST equal the caller's
//      verified uid. Any mismatch is refused with `assignments.forbidden`
//      so cross-teacher, cross-school, and cross-district requests are all
//      denied with the canonical assignment-boundary identifier.
//   5. The assignment's frozen `classId` MUST be a non-empty string; a
//      malformed record is refused with `assignments.notFound` because
//      the retrieval layer never surfaces a data-invariant violation to
//      the client.
//   6. The referenced class is loaded via `classDocRef(classId).get()`.
//      A missing record is refused with `classes.notFound`.
//   7. Class ownership: the class record's frozen `teacherId` MUST equal
//      the caller's verified uid AND the class record's frozen `schoolId`
//      MUST equal the caller's verified `schoolId`. Any mismatch is
//      refused with `classes.forbidden`. Class ownership fields are
//      immutable per Data Model section 1.2, so a matching district or a
//      matching school on its own never authorizes access.
//   8. Defense in depth: the assignment's frozen `teacherId` MUST equal
//      the class record's `teacherId`, and the assignment's frozen
//      `schoolId` MUST equal the class record's `schoolId`. A stored
//      inconsistency is refused with `assignments.notFound` so the
//      retrieval layer never returns metrics derived from a document
//      whose frozen ownership fields disagree with the authoritative
//      class record.
//
// Assignment lifecycle:
//   - `draft`, `published`, `closed`, and `archived` are all readable to
//     the owning teacher per the certified read pattern for teacher-owned
//     assignment history (ASSESSMENT_IMPLEMENTATION_CONTRACT section 17).
//     No new session or attempt can be produced for `draft` or `archived`
//     assignments, so a summary for those states is inherently
//     zero-populated unless historical attempts exist. The lifecycle
//     itself is not a gate on this read; the ownership chain is.
//
// Canonical student population:
//   - Active `enrollments` for the assignment's frozen class, filtered by
//     `status === "active"`. The certified data model does not currently
//     define a frozen assignment-recipient snapshot, so "who is expected
//     to complete this assignment right now" is the currently-enrolled
//     roster. Historical accuracy has a documented caveat: a student who
//     completed the assignment and then transferred or withdrew is not
//     in the current population and is therefore not counted. This
//     interpretation is a material deviation from a future
//     recipient-snapshot model and is called out in the completion report.
//
// Attempt selection for score metrics:
//   - Highest completed attempt per student, with ties broken by higher
//     `attemptNumber` then lexicographic `attemptId`. The certified
//     teacher-visible metric list in
//     ASSESSMENT_IMPLEMENTATION_CONTRACT section 20 enumerates "Highest
//     score" first, and section 18 defines the pilot rollup's
//     `bestScore`/`bestAttemptId` as the canonical "best" attempt. This
//     slice uses direct queries rather than the rollup, but preserves the
//     same selection semantics so the summary card renders the same
//     "highest" number the rollup would.
//
// Query:
//   - `attempts.where("assignmentId", "==", assignmentId)` (auto index)
//   - `assessmentSessions.where("assignmentId", "==", assignmentId)` (auto index)
//   - `enrollments.where("classId", "==", classId)` (auto index)
//   No composite index is introduced. Every returned document is
//   defense-in-depth-checked against the loaded assignment/class ownership
//   fields before it contributes to metrics; a mismatch is treated as a
//   silent drop rather than an error because the sole documented cause is
//   a data-invariant violation the retrieval layer must not amplify.
//
// Projection:
//   - Only the fields enumerated on
//     `AssessmentAssignmentSummaryResponse` cross the callable boundary.
//     No student identifier, name, attempt identifier, session identifier,
//     score, response, item result, or answer-key value is ever returned.
async function assessmentAssignmentSummaryHandler(
  request: CallableRequest<unknown>,
): Promise<AssessmentAssignmentSummaryResponse> {
  const actor = await assertActiveTeacherInDistrict(request);
  const input = validateRequest(request.data);

  const assignment = await loadAssignment(input.assignmentId);

  if (
    assignment.teacherId !== actor.uid ||
    assignment.schoolId !== actor.schoolId
  ) {
    throw new PlatformError(
      "assignments.forbidden",
      "Caller does not own this assignment.",
    );
  }

  if (!isNonEmptyString(assignment.classId)) {
    throw new PlatformError(
      "assignments.notFound",
      "Assignment record is missing its class reference.",
    );
  }

  const classRecord = await loadClass(assignment.classId);

  if (
    classRecord.teacherId !== actor.uid ||
    classRecord.schoolId !== actor.schoolId
  ) {
    throw new PlatformError(
      "classes.forbidden",
      "Caller does not own the class that owns this assignment.",
    );
  }

  if (
    assignment.teacherId !== classRecord.teacherId ||
    assignment.schoolId !== classRecord.schoolId
  ) {
    throw new PlatformError(
      "assignments.notFound",
      "Assignment record has inconsistent frozen ownership fields.",
    );
  }

  const classId = assignment.classId;

  const [attemptsSnapshot, sessionsSnapshot, enrollmentsSnapshot] =
    await Promise.all([
      attemptsCollectionRef()
        .where("assignmentId", "==", input.assignmentId)
        .get(),
      assessmentSessionsCollectionRef()
        .where("assignmentId", "==", input.assignmentId)
        .get(),
      enrollmentsCollectionRef().where("classId", "==", classId).get(),
    ]);

  // Canonical student population: unique studentIds whose enrollment in
  // the assignment's class is currently `active`. Duplicate enrollment
  // documents that share a studentId collapse into a single entry.
  const population = new Set<string>();
  for (const doc of enrollmentsSnapshot.docs) {
    const data = doc.data() as EnrollmentRecord | undefined;
    if (!data) continue;
    if (data.classId !== classId) continue;
    if (data.schoolId !== actor.schoolId) continue;
    if (data.status !== "active") continue;
    if (!isNonEmptyString(data.studentId)) continue;
    population.add(data.studentId);
  }

  // Group defense-in-depth-admitted attempts by studentId so multiple
  // attempts by the same student contribute exactly one completed count
  // and exactly one selected score.
  const attemptsByStudent = new Map<
    string,
    Array<{ id: string; data: AssessmentAttemptRecord }>
  >();
  for (const doc of attemptsSnapshot.docs) {
    const data = doc.data() as AssessmentAttemptRecord | undefined;
    if (!data) continue;
    if (data.assignmentId !== input.assignmentId) continue;
    if (data.classId !== classId) continue;
    if (data.teacherId !== actor.uid) continue;
    if (data.schoolId !== actor.schoolId) continue;
    if (data.districtId !== actor.districtId) continue;
    if (!isNonEmptyString(data.studentId)) continue;
    if (!population.has(data.studentId)) continue;
    const bucket = attemptsByStudent.get(data.studentId) ?? [];
    bucket.push({ id: doc.id, data });
    attemptsByStudent.set(data.studentId, bucket);
  }

  // Only sessions belonging to students in the canonical population are
  // considered for the in-progress classification. A finalize transaction
  // deletes the session on success (per
  // ASSESSMENT_IMPLEMENTATION_CONTRACT section 21), so a student with a
  // live session and no completed attempt is genuinely in progress; a
  // student with both a completed attempt and a live session is classified
  // as completed because the completed classification takes precedence.
  const inProgressStudentIds = new Set<string>();
  for (const doc of sessionsSnapshot.docs) {
    const data = doc.data() as AssessmentSessionRecord | undefined;
    if (!data) continue;
    if (data.assignmentId !== input.assignmentId) continue;
    if (data.classId !== classId) continue;
    if (data.teacherId !== actor.uid) continue;
    if (data.schoolId !== actor.schoolId) continue;
    if (data.districtId !== actor.districtId) continue;
    if (data.status !== "live") continue;
    if (!isNonEmptyString(data.studentId)) continue;
    if (!population.has(data.studentId)) continue;
    inProgressStudentIds.add(data.studentId);
  }

  // Classify every student in the population exactly once. Completed
  // wins over in-progress; in-progress wins over not-started.
  const totalStudents = population.size;
  let completedStudents = 0;
  let inProgressStudents = 0;
  const selectedByStudent = new Map<string, SelectedCompletedAttempt>();

  for (const studentId of population) {
    const attempts = attemptsByStudent.get(studentId);
    if (attempts && attempts.length > 0) {
      const selected = selectHighestCompletedAttempt(attempts);
      if (selected !== null) {
        completedStudents += 1;
        selectedByStudent.set(studentId, selected);
        continue;
      }
    }
    if (inProgressStudentIds.has(studentId)) {
      inProgressStudents += 1;
    }
  }

  const notStartedStudents =
    totalStudents - completedStudents - inProgressStudents;

  // Score metrics computed from the selected attempt per completed
  // student. `null` when no completed attempts exist so the client
  // renders an unambiguous empty state.
  let averagePercentage: number | null = null;
  let highestPercentage: number | null = null;
  let lowestPercentage: number | null = null;
  let perfectScoreStudents = 0;

  if (selectedByStudent.size > 0) {
    let sum = 0;
    let highest = Number.NEGATIVE_INFINITY;
    let lowest = Number.POSITIVE_INFINITY;
    for (const selected of selectedByStudent.values()) {
      sum += selected.percentage;
      if (selected.percentage > highest) highest = selected.percentage;
      if (selected.percentage < lowest) lowest = selected.percentage;
      // Perfect score uses the raw score/maxScore pair so a rounded
      // 100% percentage from bonus-point or floating-point drift cannot
      // masquerade as a perfect score, and a legitimate perfect score
      // is counted even if the persisted `percentage` field is stale.
      if (
        selected.maxScore > 0 &&
        selected.score === selected.maxScore
      ) {
        perfectScoreStudents += 1;
      }
    }
    averagePercentage = roundPercentage(sum / selectedByStudent.size);
    highestPercentage = roundPercentage(highest);
    lowestPercentage = roundPercentage(lowest);
  }

  const completionPercentage =
    totalStudents === 0
      ? 0
      : roundPercentage((completedStudents / totalStudents) * 100);

  safeLog(() =>
    log.info("assessmentAssignment.summarized", {
      actorUserId: actor.uid,
      assignmentId: input.assignmentId,
      classId,
      totalStudents,
      completedStudents,
      inProgressStudents,
      notStartedStudents,
    }),
  );

  return {
    assignmentId: input.assignmentId,
    classId,
    totalStudents,
    completedStudents,
    inProgressStudents,
    notStartedStudents,
    completionPercentage,
    averagePercentage,
    highestPercentage,
    lowestPercentage,
    perfectScoreStudents,
  };
}

export const assessmentAssignmentSummary = platformCallable(
  assessmentAssignmentSummaryHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assessmentAssignmentSummaryHandler =
  assessmentAssignmentSummaryHandler;
