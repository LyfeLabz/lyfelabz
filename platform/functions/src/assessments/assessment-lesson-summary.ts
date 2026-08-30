import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  assignmentsCollectionRef,
  assignmentRecipientsCollectionRef,
  attemptsCollectionRef,
  log,
  requireDistrictContext,
  type AssessmentAttemptRecord,
  type AssignmentRecipientRecord,
  type AssignmentStatus,
} from "../shared";
import {
  selectHighestCompletedAttempt,
  type SelectedCompletedAttempt,
} from "./assessment-assignment-summary";

// Sprint 28.6E: lesson-level cross-assignment analytics callable.
//
// Product question (Blueprint §10-11): "How has this lesson performed
// across the classes and assignments I own?" This is deliberately NOT the
// operational, assignment-specific question served by
// `assessmentAssignmentSummary` (Classes -> Class -> Assignment Detail).
// Because that operational home exists, the lesson summary is free to use
// UNIQUE-STUDENT semantics without being misleading: every rate/score
// metric keys on distinct students, and denominators are never mixed.
//
// The callable is caller-scoped and bounded. It reuses the exact
// `assignmentsTeacherList` indexed query shape (teacherId + schoolId +
// status in [published, closed]), filters the requested `lessonSlug` in
// memory, and reads only the matched assignments' frozen recipients and
// attempts. No new Firestore composite index is introduced, and there is
// no client-side fan-out across assignments.

// Client-supplied request payload. The lesson slug is the only accepted
// field; the verified caller context (uid, schoolId, districtId) supplies
// every ownership decision. Any owner-scoping, routing, or aggregation key
// is refused so no laundering path can suggest cross-owner access.
export type AssessmentLessonSummaryRequest = {
  readonly lessonSlug: string;
};

// Aggregate lesson-level summary. Every field is a bounded numeric
// aggregate; no student, attempt, session, recipient, class, item-result,
// response, or answer-key identifier or value ever crosses the boundary.
// `averageBestPercentage` is `null` when no student has completed the
// lesson in any matched assignment so the client renders an unambiguous
// "No completed scores yet" state instead of a misleading 0%.
export type AssessmentLessonSummaryResponse = {
  readonly lessonSlug: string;
  readonly classesAssigned: number;
  readonly students: number;
  readonly studentsCompleted: number;
  readonly completionPercentage: number;
  readonly averageBestPercentage: number | null;
  readonly assignmentsConsidered: number;
};

// Canonical curriculum lesson-slug pattern, identical to the
// `LESSON_SLUG_PATTERN` enforced by `assignmentsCreateDraft` /
// `assignmentsUpdateDraft`. A syntactically valid slug that the teacher
// has simply never assigned is NOT an error; it yields a zero summary.
const LESSON_SLUG_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,126}[A-Za-z0-9])?$/;

// Forbidden top-level request keys. Caller identity and every ownership
// scope are derived from the verified caller context; a client that
// supplies any owner-scoping, routing, filter, or aggregation identifier
// is refused with a single canonical `assignments.invalidRequest` so no
// laundering path can suggest cross-owner access or override the canonical
// population. Mirrors `assessmentAssignmentSummary`'s forbidden-key rule.
const FORBIDDEN_REQUEST_KEYS: readonly string[] = [
  "studentId",
  "uid",
  "userId",
  "districtId",
  "schoolId",
  "classId",
  "teacherId",
  "assignmentId",
  "assessmentId",
  "assessmentRevisionId",
  "activityId",
  "attemptId",
  "sessionId",
  "status",
  "includeDrafts",
  "groupBy",
  "aggregate",
  "filter",
];

// Only owned published/closed assignments contribute historical lesson
// analytics (Blueprint §10-11). `draft` (no frozen recipient snapshot yet)
// and `archived` (terminal, removed from active teacher views) are
// excluded. Closed assignments DO contribute: "closed" means unavailable
// for new work, not erased from historical lesson performance.
const CONSIDERED_STATUSES: ReadonlyArray<AssignmentStatus> = [
  "published",
  "closed",
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Deterministic half-up rounding, clamped to 0-100. Identical convention
// to `assessmentAssignmentSummary.roundPercentage` (Blueprint §11 rounding
// lock) so the two teacher summaries never disagree on how a percentage is
// presented.
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

function validateRequest(data: unknown): AssessmentLessonSummaryRequest {
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
  if (!("lessonSlug" in payload) || !isNonEmptyString(payload.lessonSlug)) {
    throw new PlatformError(
      "assignments.invalidRequest",
      "lessonSlug must be a non-empty string.",
    );
  }
  const lessonSlug = payload.lessonSlug.trim();
  if (!LESSON_SLUG_PATTERN.test(lessonSlug)) {
    throw new PlatformError(
      "assignments.invalidRequest",
      "lessonSlug must be a canonical curriculum slug.",
    );
  }
  return { lessonSlug };
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

// One matched, owned assignment of the requested lesson, with its frozen
// recipient population and the valid completed-attempt candidates
// restricted to that population. This is the Firestore-free input to the
// pure aggregator so lesson-mastery semantics are deterministically
// testable without an emulator.
export type LessonSummaryAssignmentInput = {
  readonly assignmentId: string;
  readonly classId: string;
  // Distinct, ownership-validated recipient studentIds (frozen population).
  readonly recipientStudentIds: readonly string[];
  // Attempts already validated and restricted to this assignment's frozen
  // recipients, shaped for the certified selector. `id` is the attemptId
  // (Firestore doc id); `data` is the immutable attempt record.
  readonly attempts: ReadonlyArray<{
    readonly id: string;
    readonly data: AssessmentAttemptRecord;
  }>;
};

export type LessonSummaryAggregate = {
  readonly classesAssigned: number;
  readonly students: number;
  readonly studentsCompleted: number;
  readonly completionPercentage: number;
  readonly averageBestPercentage: number | null;
  readonly assignmentsConsidered: number;
};

// Cross-assignment best-attempt selection. Rules 1-4 (percentage,
// attemptNumber, completedAt, ascending attemptId) are delegated wholesale
// to the certified per-assignment `selectHighestCompletedAttempt`
// (PDR-029 §6); no second best-attempt algorithm is invented. This helper
// only adds Blueprint §11's single documented cross-assignment extension:
// when two per-assignment winners are otherwise indistinguishable, the
// smaller `assignmentId` wins so the lesson-level selection is fully
// deterministic and never depends on read order. Returns true when
// `candidate` should replace `incumbent`.
function crossAssignmentIsBetter(
  candidate: { readonly sel: SelectedCompletedAttempt; readonly assignmentId: string },
  incumbent: { readonly sel: SelectedCompletedAttempt; readonly assignmentId: string },
): boolean {
  const c = candidate.sel;
  const b = incumbent.sel;
  // Rule 1: higher percentage.
  if (c.percentage !== b.percentage) return c.percentage > b.percentage;
  // Rule 2: higher attemptNumber.
  if (c.attemptNumber !== b.attemptNumber) {
    return c.attemptNumber > b.attemptNumber;
  }
  // Rule 3: later completedAt; a valid finite timestamp outranks a missing
  // or malformed one.
  const cTs = c.completedAtMillis;
  const bTs = b.completedAtMillis;
  if (cTs !== bTs) {
    if (cTs === null) return false;
    if (bTs === null) return true;
    return cTs > bTs;
  }
  // Rule 4: ascending attemptId.
  if (c.attemptId !== b.attemptId) return c.attemptId < b.attemptId;
  // Rule 5 (cross-assignment extension): ascending assignmentId.
  return candidate.assignmentId < incumbent.assignmentId;
}

// Pure lesson-summary aggregation over the matched owned assignments.
// Deterministic: identical inputs always yield identical output (set-based
// dedup, fixed selection, fixed rounding). Unique-student semantics
// (Blueprint §11):
//   - classesAssigned: distinct classId among matched assignments.
//   - students:        distinct recipient studentIds across all matched
//                      frozen recipient populations (union).
//   - studentsCompleted: distinct students in that population with >=1
//                      valid completed attempt in any matched assignment.
//   - completionPercentage: studentsCompleted / students, half-up; 0 when
//                      students === 0.
//   - averageBestPercentage: mean of each completed student's single best
//                      completed percentage across all matched assignments;
//                      denominator is distinct completed students; null
//                      when none.
//   - assignmentsConsidered: number of matched owned assignments.
export function aggregateLessonSummary(
  assignments: readonly LessonSummaryAssignmentInput[],
): LessonSummaryAggregate {
  const classIds = new Set<string>();
  const population = new Set<string>();
  for (const a of assignments) {
    if (isNonEmptyString(a.classId)) classIds.add(a.classId);
    for (const studentId of a.recipientStudentIds) {
      if (isNonEmptyString(studentId)) population.add(studentId);
    }
  }

  // Best completed attempt per distinct student, reduced across every
  // matched assignment. Only students in the frozen population contribute.
  const bestByStudent = new Map<
    string,
    { readonly sel: SelectedCompletedAttempt; readonly assignmentId: string }
  >();

  for (const a of assignments) {
    // Group this assignment's admitted attempts by student.
    const byStudent = new Map<
      string,
      Array<{ id: string; data: AssessmentAttemptRecord }>
    >();
    for (const attempt of a.attempts) {
      const studentId = attempt.data.studentId;
      if (!isNonEmptyString(studentId)) continue;
      if (!population.has(studentId)) continue;
      const bucket = byStudent.get(studentId) ?? [];
      bucket.push(attempt);
      byStudent.set(studentId, bucket);
    }
    for (const [studentId, attempts] of byStudent) {
      const sel = selectHighestCompletedAttempt(attempts);
      if (sel === null) continue;
      const candidate = { sel, assignmentId: a.assignmentId };
      const incumbent = bestByStudent.get(studentId);
      if (
        incumbent === undefined ||
        crossAssignmentIsBetter(candidate, incumbent)
      ) {
        bestByStudent.set(studentId, candidate);
      }
    }
  }

  const students = population.size;
  const studentsCompleted = bestByStudent.size;
  const completionPercentage =
    students === 0
      ? 0
      : roundPercentage((studentsCompleted / students) * 100);

  let averageBestPercentage: number | null = null;
  if (studentsCompleted > 0) {
    let sum = 0;
    for (const { sel } of bestByStudent.values()) sum += sel.percentage;
    averageBestPercentage = roundPercentage(sum / studentsCompleted);
  }

  return {
    classesAssigned: classIds.size,
    students,
    studentsCompleted,
    completionPercentage,
    averageBestPercentage,
    assignmentsConsidered: assignments.length,
  };
}

// Builds the ownership-validated frozen recipient population for one
// matched assignment. Every recipient row is re-checked against the loaded
// assignment and the verified caller context exactly as
// `assessmentAssignmentSummary` does (studentId non-empty, doc.id ===
// studentId, assignmentId/classId match, teacherId/schoolId/districtId ===
// caller, status === "assigned"). Malformed or cross-owner rows are
// silently dropped and never contribute to the population.
function buildRecipientPopulation(
  docs: ReadonlyArray<{ id: string; data: () => unknown }>,
  ctx: {
    readonly assignmentId: string;
    readonly classId: string;
    readonly uid: string;
    readonly schoolId: string;
    readonly districtId: string;
  },
): Set<string> {
  const population = new Set<string>();
  for (const doc of docs) {
    const data = doc.data() as AssignmentRecipientRecord | undefined;
    if (!data) continue;
    if (!isNonEmptyString(data.studentId)) continue;
    if (doc.id !== data.studentId) continue;
    if (data.assignmentId !== ctx.assignmentId) continue;
    if (data.classId !== ctx.classId) continue;
    if (data.teacherId !== ctx.uid) continue;
    if (data.schoolId !== ctx.schoolId) continue;
    if (data.districtId !== ctx.districtId) continue;
    if (data.status !== "assigned") continue;
    population.add(data.studentId);
  }
  return population;
}

// Admits the valid completed-attempt candidates for one matched
// assignment, restricted to that assignment's frozen recipient population.
// Every attempt is defense-in-depth-checked against the loaded assignment
// and caller context; a mismatch is silently dropped (the sole documented
// cause is a data-invariant violation the retrieval layer must not
// amplify). Attempts by students outside the frozen population are excluded
// so historical stability under roster churn is preserved.
function buildAdmittedAttempts(
  docs: ReadonlyArray<{ id: string; data: () => unknown }>,
  population: ReadonlySet<string>,
  ctx: {
    readonly assignmentId: string;
    readonly classId: string;
    readonly uid: string;
    readonly schoolId: string;
    readonly districtId: string;
  },
): Array<{ id: string; data: AssessmentAttemptRecord }> {
  const admitted: Array<{ id: string; data: AssessmentAttemptRecord }> = [];
  for (const doc of docs) {
    const data = doc.data() as AssessmentAttemptRecord | undefined;
    if (!data) continue;
    if (data.assignmentId !== ctx.assignmentId) continue;
    if (data.classId !== ctx.classId) continue;
    if (data.teacherId !== ctx.uid) continue;
    if (data.schoolId !== ctx.schoolId) continue;
    if (data.districtId !== ctx.districtId) continue;
    if (!isNonEmptyString(data.studentId)) continue;
    if (!population.has(data.studentId)) continue;
    admitted.push({ id: doc.id, data });
  }
  return admitted;
}

// assessmentLessonSummary
//
// Returns bounded lesson-level aggregate metrics across every
// published/closed assignment of the requested lesson that the
// authenticated teacher owns in the current verified school context.
//
// Authorization (Blueprint §10):
//   1. `requireDistrictContext(request)` gates authentication, active
//      status, canonical claims, and district agreement. Non-teacher
//      callers are refused `role-forbidden`.
//   2. Request shape: `lessonSlug` must be a canonical curriculum slug;
//      any owner-scoping, routing, or aggregation key is refused with
//      `assignments.invalidRequest`.
//   3. Ownership source is the verified caller context (uid, schoolId,
//      districtId), never a client identifier. The owned-assignment query
//      itself enforces `teacherId === uid` and `schoolId === schoolId`;
//      a belt-and-suspenders re-check drops any stale-index row. Every
//      recipient and attempt admitted is re-validated against the loaded
//      assignment's frozen ownership fields and the caller context.
//
// Query strategy (Blueprint §10, no new index):
//   1. `assignments.where(teacherId==uid).where(schoolId==schoolId)
//      .where(status in [published, closed])` - the exact existing
//      `assignmentsTeacherList` shape, served by auto single-field
//      indexes.
//   2. Filter in memory to `record.lessonSlug === lessonSlug` and the
//      ownership predicate.
//   3. For each matched assignment, read (in parallel, bounded by the
//      matched set) its `recipients` subcollection and its `attempts`.
//   4. Aggregate per Section 11 (unique-student semantics).
//
// A syntactically valid slug with no owned matching assignments yields a
// zero summary (never an error). No sessions are read: v1 metrics do not
// need an in-progress classification.
//
// Projection: only the fields on `AssessmentLessonSummaryResponse` cross
// the boundary. No student/attempt/recipient/class/session identifier,
// name, response, item result, or answer-key value is ever returned.
async function assessmentLessonSummaryHandler(
  request: CallableRequest<unknown>,
): Promise<AssessmentLessonSummaryResponse> {
  const actor = await assertActiveTeacherInDistrict(request);
  const input = validateRequest(request.data);

  const snapshot = await assignmentsCollectionRef()
    .where("teacherId", "==", actor.uid)
    .where("schoolId", "==", actor.schoolId)
    .where("status", "in", CONSIDERED_STATUSES as string[])
    .get();

  // Bounded owned-assignment set for this lesson. The status `in` clause
  // already excludes draft/archived; the lesson filter and the ownership
  // re-check are applied in memory. classId must be a non-empty string for
  // an assignment to be countable at all.
  const matched: Array<{ assignmentId: string; classId: string }> = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!data) continue;
    if (data.teacherId !== actor.uid || data.schoolId !== actor.schoolId) {
      continue;
    }
    if (data.status !== "published" && data.status !== "closed") continue;
    if (data.lessonSlug !== input.lessonSlug) continue;
    if (!isNonEmptyString(data.classId)) continue;
    matched.push({ assignmentId: doc.id, classId: data.classId });
  }

  // Per matched assignment, read the frozen recipients and attempts in
  // parallel. Reads scale with the number of the teacher's own
  // published/closed assignments of this one lesson (bounded, small in
  // v1); there is no fan-out over classes the teacher does not own.
  const perAssignment = await Promise.all(
    matched.map(async ({ assignmentId, classId }) => {
      const [recipientsSnapshot, attemptsSnapshot] = await Promise.all([
        assignmentRecipientsCollectionRef(assignmentId).get(),
        attemptsCollectionRef()
          .where("assignmentId", "==", assignmentId)
          .get(),
      ]);
      const ctx = {
        assignmentId,
        classId,
        uid: actor.uid,
        schoolId: actor.schoolId,
        districtId: actor.districtId,
      };
      const population = buildRecipientPopulation(
        recipientsSnapshot.docs,
        ctx,
      );
      const attempts = buildAdmittedAttempts(
        attemptsSnapshot.docs,
        population,
        ctx,
      );
      const item: LessonSummaryAssignmentInput = {
        assignmentId,
        classId,
        recipientStudentIds: Array.from(population),
        attempts,
      };
      return item;
    }),
  );

  const aggregate = aggregateLessonSummary(perAssignment);

  safeLog(() =>
    log.info("assessmentLesson.summarized", {
      actorUserId: actor.uid,
      lessonSlug: input.lessonSlug,
      classesAssigned: aggregate.classesAssigned,
      students: aggregate.students,
      studentsCompleted: aggregate.studentsCompleted,
      assignmentsConsidered: aggregate.assignmentsConsidered,
    }),
  );

  return {
    lessonSlug: input.lessonSlug,
    classesAssigned: aggregate.classesAssigned,
    students: aggregate.students,
    studentsCompleted: aggregate.studentsCompleted,
    completionPercentage: aggregate.completionPercentage,
    averageBestPercentage: aggregate.averageBestPercentage,
    assignmentsConsidered: aggregate.assignmentsConsidered,
  };
}

export const assessmentLessonSummary = platformCallable(
  assessmentLessonSummaryHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assessmentLessonSummaryHandler = assessmentLessonSummaryHandler;
