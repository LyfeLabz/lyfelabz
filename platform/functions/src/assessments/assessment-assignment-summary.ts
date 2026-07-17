import { type CallableRequest } from "firebase-functions/v2/https";
import { type Timestamp } from "firebase-admin/firestore";

import {
  platformCallable,
  PlatformError,
  assessmentSessionsCollectionRef,
  assignmentDocRef,
  assignmentRecipientsCollectionRef,
  attemptsCollectionRef,
  classDocRef,
  log,
  requireDistrictContext,
  type AssessmentAttemptRecord,
  type AssessmentSessionRecord,
  type AssignmentRecipientRecord,
  type AssignmentRecord,
  type ClassRecord,
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
// bounded numeric aggregate; no student, attempt, session, recipient,
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

// PDR-029 tie-break policy rule 3 compares the canonical completion
// timestamp on each attempt. The certified attempt record freezes exactly
// one completion instant: `submittedAt`, stamped by the sole authorized
// writer (`assessmentAttemptsFinalize`) via `FieldValue.serverTimestamp()`
// per `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` sections 7 and 21. The
// ratified policy names this instant "completedAt"; the on-disk
// representation is `submittedAt`. Nothing else on the attempt or session
// record is a valid substitute: session `startedAt` is not the completion
// instant, and Firestore document creation time is not part of the
// certified schema. We convert the timestamp to a finite millisecond
// number so the comparison remains total and deterministic.
function completedAtMillis(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && value !== null) {
    const maybe = value as { toMillis?: () => unknown };
    if (typeof maybe.toMillis === "function") {
      const raw = maybe.toMillis();
      if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    }
  }
  return null;
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
// per PDR-029 section 6. The canonical order is:
//   1. Higher `percentage` wins.
//   2. Higher `attemptNumber` wins.
//   3. Later `completedAt` (on-disk `submittedAt`) wins when both
//      attempts carry comparable timestamps. A valid timestamp outranks a
//      missing or malformed timestamp.
//   4. Ascending `attemptId` wins as the final deterministic fallback so
//      the selection never depends on Firestore document ordering.
// `AssessmentAttemptRecord.percentage`, `attemptNumber`, `score`,
// `maxScore`, and `submittedAt` are all frozen at finalize. Raw `score`
// MUST NOT be used for comparison because `maxScore` may differ across
// assessment revisions (PDR-029 section 5).
export type SelectedCompletedAttempt = {
  readonly attemptId: string;
  readonly percentage: number;
  readonly score: number;
  readonly maxScore: number;
  readonly attemptNumber: number;
  readonly completedAtMillis: number | null;
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
      completedAtMillis: completedAtMillis(data.submittedAt),
    };
    if (best === null) {
      best = candidate;
      continue;
    }
    // Rule 1: higher percentage wins.
    if (candidate.percentage > best.percentage) {
      best = candidate;
      continue;
    }
    if (candidate.percentage < best.percentage) continue;
    // Rule 2: higher attemptNumber wins.
    if (candidate.attemptNumber > best.attemptNumber) {
      best = candidate;
      continue;
    }
    if (candidate.attemptNumber < best.attemptNumber) continue;
    // Rule 3: later completedAt wins. A valid finite timestamp outranks
    // a missing or malformed timestamp so a well-formed record never
    // loses to a malformed peer.
    const candTs = candidate.completedAtMillis;
    const bestTs = best.completedAtMillis;
    if (candTs !== null && bestTs === null) {
      best = candidate;
      continue;
    }
    if (candTs === null && bestTs !== null) continue;
    if (candTs !== null && bestTs !== null) {
      if (candTs > bestTs) {
        best = candidate;
        continue;
      }
      if (candTs < bestTs) continue;
    }
    // Rule 4: ascending attemptId is the final deterministic fallback.
    if (candidate.attemptId < best.attemptId) {
      best = candidate;
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
// class the authenticated teacher currently owns. Sprint 12E Slice 2C
// migrates the population authority from the current active enrollment
// roster to the canonical frozen assignment-recipient subcollection at
// `assignments/{assignmentId}/recipients/{studentId}` per PDR-029h and
// PDR-029l. Roster changes after publication no longer alter the
// historical summary population.
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
//     `draft` assignments have no recipient snapshot yet, so the summary
//     is inherently zero-populated for a draft. The lifecycle itself is
//     not a gate on this read; the ownership chain is.
//
// Canonical student population:
//   - The subcollection `assignments/{assignmentId}/recipients` is the
//     sole authority for "who is in this assignment". Every recipient
//     record is validated against the loaded assignment and the caller
//     context (assignmentId, classId, schoolId, districtId, teacherId,
//     status === "assigned", non-empty studentId, and document id ===
//     studentId). Malformed rows that fail any predicate are silently
//     dropped from the population per the repository's existing
//     defense-in-depth pattern, and are not permitted to contribute to
//     totalStudents. The recipient snapshot is captured at first
//     publication (Sprint 12E Slice 2A) and augmented only by
//     `assignmentsRecipientAdd` (Sprint 12E Slice 2A), so current
//     enrollment status does not silently rewrite the summary
//     population. Historical accuracy: a student who completed the
//     assignment and then transferred, withdrew, or was archived
//     remains in the summary.
//
// Attempt selection for score metrics:
//   - PDR-029 section 6: percentage first, then attemptNumber, then
//     `completedAt` (on-disk `submittedAt`), then ascending `attemptId`
//     as the final deterministic fallback. Raw `score` is never used
//     for selection or as a tie-breaker.
//
// Query:
//   - `assignments/{assignmentId}/recipients` (subcollection read)
//   - `attempts.where("assignmentId", "==", assignmentId)` (auto index)
//   - `assessmentSessions.where("assignmentId", "==", assignmentId)` (auto index)
//   No composite index is introduced. Every returned attempt or session
//   document is defense-in-depth-checked against the loaded
//   assignment/class ownership fields before it contributes to metrics;
//   a mismatch is treated as a silent drop rather than an error because
//   the sole documented cause is a data-invariant violation the
//   retrieval layer must not amplify.
//
// Projection:
//   - Only the fields enumerated on
//     `AssessmentAssignmentSummaryResponse` cross the callable boundary.
//     No student identifier, name, recipient identifier, attempt
//     identifier, session identifier, score, response, item result, or
//     answer-key value is ever returned.
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

  const [attemptsSnapshot, sessionsSnapshot, recipientsSnapshot] =
    await Promise.all([
      attemptsCollectionRef()
        .where("assignmentId", "==", input.assignmentId)
        .get(),
      assessmentSessionsCollectionRef()
        .where("assignmentId", "==", input.assignmentId)
        .get(),
      assignmentRecipientsCollectionRef(input.assignmentId).get(),
    ]);

  // Canonical student population per PDR-029l: unique studentIds whose
  // canonical recipient record for this assignment is well-formed and
  // owned by the same district, school, class, teacher, and assignment
  // as the loaded assignment record. The recipient document identifier
  // is `studentId`, so a duplicate recipient row is structurally
  // impossible; the deduplicating `Set` is a defensive guard, not a
  // correctness dependency. Malformed rows are silently dropped and
  // MUST NOT contribute to `totalStudents`.
  const population = new Set<string>();
  for (const doc of recipientsSnapshot.docs) {
    const data = doc.data() as AssignmentRecipientRecord | undefined;
    if (!data) continue;
    if (!isNonEmptyString(data.studentId)) continue;
    if (doc.id !== data.studentId) continue;
    if (data.assignmentId !== input.assignmentId) continue;
    if (data.classId !== classId) continue;
    if (data.teacherId !== actor.uid) continue;
    if (data.schoolId !== actor.schoolId) continue;
    if (data.districtId !== actor.districtId) continue;
    if (data.status !== "assigned") continue;
    population.add(data.studentId);
  }

  // Group defense-in-depth-admitted attempts by studentId so multiple
  // attempts by the same student contribute exactly one completed count
  // and exactly one selected score. Attempts by students who are not in
  // the canonical recipient population are excluded from the summary
  // even if the attempt record itself is otherwise well-formed; this
  // preserves PDR-029l historical stability under roster churn.
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

// `Timestamp` is imported for the type-side dependency on
// `AssessmentAttemptRecord.submittedAt` in the tie-break helper's
// documentation contract. The actual runtime read goes through
// `completedAtMillis` so the helper never depends on an admin-SDK
// runtime symbol during unit testing.
export type { Timestamp };

export const assessmentAssignmentSummary = platformCallable(
  assessmentAssignmentSummaryHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assessmentAssignmentSummaryHandler =
  assessmentAssignmentSummaryHandler;
