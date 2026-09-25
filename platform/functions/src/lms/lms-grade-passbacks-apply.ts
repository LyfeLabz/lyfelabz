import { type CallableRequest } from "firebase-functions/v2/https";

import { PlatformError, platformCallable, writeAuditEvent } from "../shared";

import {
  synchronizeGradePassback,
  type GradePassbackSyncOutcome,
} from "./grade-passback/engine";
import {
  evaluateFamilyStudents,
  runFamilyPreflight,
  type FamilyPreflight,
  type FamilyPreflightStatus,
} from "./grade-passback/family-evaluation";
import {
  WRITE_ACTIONS,
  type GradeReconciliationAction,
} from "./grade-passback/reconciliation-plan";
import {
  ensureGoogleClassroomProductionBindings,
  googleClassroomProductionSecrets,
} from "./providers/google-classroom/config-firebase";
import { assertAuthenticatedTeacherForLms } from "./shared/actor";
import { assertOwnedClass, parseFamilyRequest } from "./shared/coursework-family";

// lmsGradePassbacksApply
//
// Teacher-confirmed Classroom grade reconciliation for one class + lesson
// family. The teacher previews (`lmsGradePassbacksPreview`), then confirms;
// this callable writes ONLY what fresh state still permits.
//
// Trust model: the client supplies LyfeLabz identifiers (`classId`,
// `lessonSlug`), the destination it previewed (`expected`: Current
// assignment id, Classroom coursework id, maxPoints) purely as a staleness
// fence, and optionally which students to include. It never supplies a
// grade, a Classroom course/coursework id to write to, maxPoints to use, or
// a Classroom student id; any payload field outside the allowlist is
// refused. Every value written is recomputed server-side.
//
// Flow:
//   1. Teacher ownership (canonical LMS gate + owned class).
//   2. Fresh family preflight (valid Current + live destination +
//      readable submissions). Not ready -> nothing written.
//   3. Stale-preview fence: the fresh destination must equal `expected`
//      exactly, else `stalePreview` and nothing written (re-preview).
//   4. Fresh classification of every in-scope student (read-only) to pick
//      candidates: selected students whose fresh action is a write.
//   5. For each candidate, sequentially, the grade-passback engine with
//      `trigger: "teacher"` and the same `expected` fence. The engine
//      re-runs the live destination preflight, the roster check, the
//      cumulative best, and - under its per-(destination, student) lease -
//      re-reads the student's live Classroom grade and re-decides before any
//      PATCH. A student whose state changed is skipped with the fresh
//      reason; a destination-level change stops the batch (remaining
//      candidates `notAttempted`).
// Repeating an apply is safe: already-correct grades classify as
// `alreadyEqual` and are never re-written.

export type LmsGradePassbacksApplyRequest = {
  readonly classId: string;
  readonly lessonSlug: string;
  readonly expected: {
    readonly currentAssignmentId: string;
    readonly lmsAssignmentId: string;
    readonly maxPoints: number;
  };
  readonly studentIds?: readonly string[];
};

export type LmsGradePassbacksApplyOutcome =
  // A grade was written (action says fill / raise / missing-draft-zero).
  | "written"
  // Fresh classification required no write (equal, higher, protected,
  // no attempt, identity/submission problem, outside roster).
  | "noWrite"
  // Was a candidate, but the engine's fresh re-read under the lease found a
  // state that no longer permits the write.
  | "stateChanged"
  // Another sync for this student currently holds the lease.
  | "inProgress"
  | "writeFailed"
  // Not reached because the destination changed mid-batch.
  | "notAttempted";

export type LmsGradePassbacksApplyStudent = {
  readonly studentId: string;
  readonly displayName: string | null;
  readonly outcome: LmsGradePassbacksApplyOutcome;
  // The canonical action that determined the outcome (fresh).
  readonly action: GradeReconciliationAction | null;
  readonly writtenPoints: number | null;
  readonly reason: string | null;
};

export type LmsGradePassbacksApplyStatus =
  | "applied"
  | "stalePreview"
  | "destinationChangedDuringApply"
  | Exclude<FamilyPreflightStatus, "ready">;

export type LmsGradePassbacksApplyResponse = {
  readonly classId: string;
  readonly lessonSlug: string;
  readonly status: LmsGradePassbacksApplyStatus;
  readonly preflight: FamilyPreflight;
  readonly students: readonly LmsGradePassbacksApplyStudent[];
  readonly summary: {
    readonly written: number;
    readonly byOutcome: Readonly<Partial<Record<LmsGradePassbacksApplyOutcome, number>>>;
  };
};

const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "classId",
  "lessonSlug",
  "expected",
  "studentIds",
]);
const EXPECTED_KEYS: ReadonlySet<string> = new Set([
  "currentAssignmentId",
  "lmsAssignmentId",
  "maxPoints",
]);
const ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,254}[a-zA-Z0-9])?$/;
const MAX_STUDENT_IDS = 500;

function invalid(message: string): PlatformError {
  return new PlatformError("lms.invalidRequest", message);
}

function parseApplyRequest(data: unknown): LmsGradePassbacksApplyRequest {
  const { classId, lessonSlug } = parseFamilyRequest(data);
  const payload = data as Record<string, unknown>;
  for (const key of Object.keys(payload)) {
    if (!ALLOWED_KEYS.has(key)) throw invalid(`Unsupported field: ${key}.`);
  }
  const expected = payload.expected;
  if (expected === null || typeof expected !== "object" || Array.isArray(expected)) {
    throw invalid("expected must describe the previewed destination.");
  }
  const e = expected as Record<string, unknown>;
  for (const key of Object.keys(e)) {
    if (!EXPECTED_KEYS.has(key)) throw invalid(`Unsupported expected field: ${key}.`);
  }
  if (typeof e.currentAssignmentId !== "string" || !ID_PATTERN.test(e.currentAssignmentId)) {
    throw invalid("expected.currentAssignmentId is malformed.");
  }
  if (typeof e.lmsAssignmentId !== "string" || !ID_PATTERN.test(e.lmsAssignmentId)) {
    throw invalid("expected.lmsAssignmentId is malformed.");
  }
  if (
    typeof e.maxPoints !== "number" ||
    !Number.isInteger(e.maxPoints) ||
    e.maxPoints <= 0
  ) {
    throw invalid("expected.maxPoints is malformed.");
  }
  let studentIds: string[] | undefined;
  if (payload.studentIds !== undefined) {
    if (!Array.isArray(payload.studentIds) || payload.studentIds.length > MAX_STUDENT_IDS) {
      throw invalid("studentIds must be an array of at most 500 ids.");
    }
    studentIds = [];
    for (const id of payload.studentIds as unknown[]) {
      if (typeof id !== "string" || !ID_PATTERN.test(id)) {
        throw invalid("studentIds contains a malformed id.");
      }
      studentIds.push(id);
    }
  }
  return {
    classId,
    lessonSlug,
    expected: {
      currentAssignmentId: e.currentAssignmentId,
      lmsAssignmentId: e.lmsAssignmentId,
      maxPoints: e.maxPoints,
    },
    ...(studentIds !== undefined ? { studentIds } : {}),
  };
}

function fromEngine(
  result: GradePassbackSyncOutcome,
): Pick<LmsGradePassbacksApplyStudent, "outcome" | "action" | "writtenPoints" | "reason"> {
  switch (result.outcome) {
    case "synced":
      return {
        outcome: "written",
        action: result.action,
        writtenPoints: result.earnedPoints,
        reason: null,
      };
    case "noChange":
    case "protected":
      return { outcome: "stateChanged", action: result.action, writtenPoints: null, reason: null };
    case "deferred":
      return { outcome: "inProgress", action: null, writtenPoints: null, reason: null };
    case "failed":
      return { outcome: "writeFailed", action: null, writtenPoints: null, reason: result.errorCode };
    case "destinationUnavailable":
      return { outcome: "notAttempted", action: null, writtenPoints: null, reason: result.status };
    default:
      // alreadySynced cannot occur for a teacher trigger; outsideRoster,
      // noAttempts, notApplicable, noPublication, destinationChanged: the
      // fresh engine state no longer permits a write.
      return { outcome: "stateChanged", action: null, writtenPoints: null, reason: result.outcome };
  }
}

async function handler(
  request: CallableRequest<unknown>,
): Promise<LmsGradePassbacksApplyResponse> {
  ensureGoogleClassroomProductionBindings();
  const actor = await assertAuthenticatedTeacherForLms(request);
  const input = parseApplyRequest(request.data);
  const { classId, lessonSlug, expected } = input;
  await assertOwnedClass(classId, actor);

  const empty = (
    status: LmsGradePassbacksApplyStatus,
    preflight: FamilyPreflight,
  ): LmsGradePassbacksApplyResponse => ({
    classId,
    lessonSlug,
    status,
    preflight,
    students: [],
    summary: { written: 0, byOutcome: {} },
  });

  const ready = await runFamilyPreflight(actor, classId, lessonSlug);
  if (!ready.ready) {
    return empty(ready.preflight.status as Exclude<FamilyPreflightStatus, "ready">, ready.preflight);
  }
  if (
    ready.current.assignmentId !== expected.currentAssignmentId ||
    ready.destination.lmsAssignmentId !== expected.lmsAssignmentId ||
    ready.destination.maxPoints !== expected.maxPoints
  ) {
    return empty("stalePreview", ready.preflight);
  }

  const evaluations = await evaluateFamilyStudents(ready, actor, classId);
  const selected =
    input.studentIds === undefined ? undefined : new Set(input.studentIds);
  const known = new Set(evaluations.map((e) => e.studentId));

  const students: LmsGradePassbacksApplyStudent[] = [];
  const expectedDestination = {
    assignmentId: expected.currentAssignmentId,
    lmsAssignmentId: expected.lmsAssignmentId,
    maxPoints: expected.maxPoints,
  };
  let destinationChanged = false;

  for (const evaluation of evaluations) {
    if (selected !== undefined && !selected.has(evaluation.studentId)) continue;
    const base = { studentId: evaluation.studentId, displayName: evaluation.displayName };
    if (!WRITE_ACTIONS.has(evaluation.action)) {
      students.push({
        ...base,
        outcome: "noWrite",
        action: evaluation.action,
        writtenPoints: null,
        reason: null,
      });
      continue;
    }
    if (destinationChanged) {
      students.push({
        ...base,
        outcome: "notAttempted",
        action: evaluation.action,
        writtenPoints: null,
        reason: "destinationChanged",
      });
      continue;
    }
    let result: GradePassbackSyncOutcome;
    try {
      result = await synchronizeGradePassback({
        assignmentId: expected.currentAssignmentId,
        studentId: evaluation.studentId,
        districtId: actor.districtId,
        trigger: "teacher",
        expectedDestination,
      });
    } catch (err) {
      result = {
        outcome: "failed",
        errorCode: err instanceof PlatformError ? err.code : "gradePassback.syncFailed",
      };
    }
    if (result.outcome === "destinationChanged" || result.outcome === "destinationUnavailable") {
      destinationChanged = true;
      students.push({
        ...base,
        outcome: "notAttempted",
        action: evaluation.action,
        writtenPoints: null,
        reason:
          result.outcome === "destinationUnavailable" ? result.status : "destinationChanged",
      });
      continue;
    }
    students.push({ ...base, ...fromEngine(result) });
  }

  // Requested students outside the family's in-scope evaluation: never
  // written, reported so a caller cannot probe silently.
  if (selected !== undefined) {
    for (const studentId of selected) {
      if (!known.has(studentId)) {
        students.push({
          studentId,
          displayName: null,
          outcome: "noWrite",
          action: "outsideRoster",
          writtenPoints: null,
          reason: null,
        });
      }
    }
  }

  const byOutcome: Partial<Record<LmsGradePassbacksApplyOutcome, number>> = {};
  for (const s of students) byOutcome[s.outcome] = (byOutcome[s.outcome] ?? 0) + 1;
  const written = byOutcome.written ?? 0;

  try {
    await writeAuditEvent({
      actorUserId: actor.uid,
      actorRole: "teacher",
      action: "lms.gradeReconciliationApplied",
      targetType: "assignment",
      targetId: expected.currentAssignmentId,
      schoolId: actor.schoolId,
      districtId: actor.districtId,
      payload: {
        classId,
        lessonSlug,
        written,
        byOutcome,
        destinationChanged,
      },
    });
  } catch {
    // Audit failure is non-blocking, matching the existing lms.* convention.
  }

  return {
    classId,
    lessonSlug,
    status: destinationChanged ? "destinationChangedDuringApply" : "applied",
    preflight: ready.preflight,
    students,
    summary: { written, byOutcome },
  };
}

export const lmsGradePassbacksApply = platformCallable(
  { secrets: [...googleClassroomProductionSecrets] },
  handler,
);
export const __lmsGradePassbacksApplyHandler = handler;
