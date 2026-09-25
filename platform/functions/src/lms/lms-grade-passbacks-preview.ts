import { type CallableRequest } from "firebase-functions/v2/https";

import { platformCallable } from "../shared";

import {
  evaluateFamilyStudents,
  runFamilyPreflight,
  summarizeActions,
  type FamilyPreflight,
  type FamilyPreflightStatus,
  type FamilyStudentEvaluation,
} from "./grade-passback/family-evaluation";
import type { GradeReconciliationAction } from "./grade-passback/reconciliation-plan";
import {
  ensureGoogleClassroomProductionBindings,
  googleClassroomProductionSecrets,
} from "./providers/google-classroom/config-firebase";
import { assertAuthenticatedTeacherForLms } from "./shared/actor";
import { assertOwnedClass, parseFamilyRequest } from "./shared/coursework-family";

// lmsGradePassbacksPreview
//
// Teacher-facing, READ-ONLY preview of a Classroom grade sync for one
// class + lesson family: "if I synced grades to Classroom now, what would
// change?" It never writes. `lmsGradePassbacksApply` performs the
// teacher-confirmed writes, re-deciding each one from fresh state.
//
// Canonical rules (shared with every grade-writing route, not re-derived):
//   ASSIGNMENT RECORDS ARE HISTORICAL. CURRENT IS OPERATIONAL.
//   ATTEMPTS ARE CUMULATIVE. BEST PERFORMANCE IS CUMULATIVE.
//   CLASSROOM GRADE DESTINATION IS CURRENT.
// - Current: canonical occurrence grouping; valid Current required.
// - Destination: canonical live preflight (`resolveLiveGradeDestination`).
// - Target: canonical cumulative best (`cumulativeTargetFor`).
// - Decision: canonical `decideGradeAction` (never lower; protected zeros;
//   the approved narrow missing-work draft-zero rule).
//
// Reads only: class, assignments, publication, connection (plus the
// canonical credential refresh, the only incidental write), recipients,
// enrollments, attempts, users (display names), external identities, and
// two Classroom GETs (`courseWork.get`, `studentSubmissions.list`). Never
// calls the grade-passback engine and never writes a grade, Current
// pointer, assignment, publication, attempt, or passback record. Never
// returns or logs credential material or Classroom student account ids.

export type LmsGradePassbacksPreviewRequest = {
  readonly classId: string;
  readonly lessonSlug: string;
};

export type LmsGradePassbacksPreflightStatus = FamilyPreflightStatus;
export type LmsGradePassbacksPreflight = FamilyPreflight;
export type LmsGradePassbacksPreviewStudent = FamilyStudentEvaluation;

export type LmsGradePassbacksPreviewResponse = {
  readonly classId: string;
  readonly lessonSlug: string;
  readonly preflight: LmsGradePassbacksPreflight;
  readonly maxPoints: number | null;
  readonly students: readonly LmsGradePassbacksPreviewStudent[];
  readonly summary: {
    readonly byAction: Readonly<Partial<Record<GradeReconciliationAction, number>>>;
    readonly wouldWrite: number;
  };
};

async function handler(
  request: CallableRequest<unknown>,
): Promise<LmsGradePassbacksPreviewResponse> {
  ensureGoogleClassroomProductionBindings();
  const actor = await assertAuthenticatedTeacherForLms(request);
  const { classId, lessonSlug } = parseFamilyRequest(request.data);
  await assertOwnedClass(classId, actor);

  const result = await runFamilyPreflight(actor, classId, lessonSlug);
  if (!result.ready) {
    return {
      classId,
      lessonSlug,
      preflight: result.preflight,
      maxPoints: null,
      students: [],
      summary: { byAction: {}, wouldWrite: 0 },
    };
  }

  const students = await evaluateFamilyStudents(result, actor, classId);
  return {
    classId,
    lessonSlug,
    preflight: result.preflight,
    maxPoints: result.destination.maxPoints,
    students,
    summary: summarizeActions(students),
  };
}

export const lmsGradePassbacksPreview = platformCallable(
  { secrets: [...googleClassroomProductionSecrets] },
  handler,
);
export const __lmsGradePassbacksPreviewHandler = handler;
