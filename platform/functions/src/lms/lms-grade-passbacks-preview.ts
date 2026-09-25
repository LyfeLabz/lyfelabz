import { type CallableRequest } from "firebase-functions/v2/https";

import {
  attemptsCollectionRef,
  platformCallable,
  resolveActiveProviderAccountIdForUser,
  userRecordDocRef,
  type AssessmentAttemptRecord,
  type AssignmentRecord,
} from "../shared";
import {
  createClassAssignmentsLoader,
  resolveCurrentOccurrenceGroup,
  type AssignmentOccurrence,
} from "../assignments/current-occurrence-group";
import {
  loadActiveEnrolledStudentIds,
  loadExistingRecipientStudentIds,
} from "../assignments/assignment-recipients";

import {
  WRITE_ACTIONS,
  cumulativeTargetFor,
  decideGradeAction,
  readExistingClassroomGrade,
  type GradeReconciliationAction,
} from "./grade-passback/reconciliation-plan";
import {
  ensureGoogleClassroomProductionBindings,
  googleClassroomProductionSecrets,
} from "./providers/google-classroom/config-firebase";
import type {
  LmsAssignmentLiveState,
  LmsSubmissionGrade,
  LmsSubmissionState,
} from "./providers/provider";
import { getProviderAdapter } from "./providers/registry";
import { assertAuthenticatedTeacherForLms, type LmsAuthenticatedTeacher } from "./shared/actor";
import {
  assertOwnedClass,
  classifyUpstreamReadError,
  createConnectionAccessResolver,
  familyScopeFor,
  loadOwnedPublication,
  parseFamilyRequest,
  storedGradingOf,
  succeededCourseworkIdOf,
} from "./shared/coursework-family";

// lmsGradePassbacksPreview
//
// Teacher-facing, READ-ONLY preview of a Classroom grade sync for one
// class + lesson family. It answers "if I synced grades to Classroom now,
// what would change?" without writing anything. It is the dry-run half of
// a future teacher-confirmed reconciliation; there is no write path here.
//
// Canonical rules (shared with automatic passback, not re-derived):
//   ASSIGNMENT RECORDS ARE HISTORICAL. CURRENT IS OPERATIONAL.
//   ATTEMPTS ARE CUMULATIVE. BEST PERFORMANCE IS CUMULATIVE.
//   CLASSROOM GRADE DESTINATION IS CURRENT.
// - Family and Current come from `resolveCurrentOccurrenceGroup`; the
//   destination is ONLY Current's coursework. Historical coursework is
//   never read for grades and never proposed as a destination.
// - Target = `cumulativeTargetFor` (canonical best attempt across every
//   occurrence, graded or ungraded, scaled to Current's maxPoints).
// - Per-student classification is `decideGradeAction` (never lower, zero
//   and divergent grades go to teacher review).
//
// Live destination preflight (fails closed; no student rows when not
// `ready`): valid Current; Current graded; succeeded Classroom
// publication; caller's own active connection; live coursework exists, is
// PUBLISHED, is graded, and its live maxPoints equals Current's stored
// maxPoints; the submission list is readable.
//
// Roster boundary: a student is in scope when they are a canonical
// recipient of Current AND actively enrolled in the class (the same two
// canonical readers recipient reconciliation uses). Students with family
// attempts who are outside that boundary are reported as `outsideRoster`
// with no proposal and no Classroom lookup.
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

export type LmsGradePassbacksPreflightStatus =
  | "ready"
  | "currentUnresolved"
  | "currentInactive"
  | "currentUngraded"
  | "currentNotPublishedToClassroom"
  | "connectionUnavailable"
  | "courseworkNotFound"
  | "courseworkDeleted"
  | "courseworkNotPublished"
  | "courseworkUngraded"
  | "maxPointsMismatch"
  | "courseworkInaccessible"
  | "courseworkError"
  | "submissionsUnavailable";

export type LmsGradePassbacksPreflight = {
  readonly status: LmsGradePassbacksPreflightStatus;
  readonly currentAssignmentId: string | null;
  readonly lmsAssignmentId: string | null;
  readonly storedMaxPoints: number | null;
  readonly liveMaxPoints: number | null;
  readonly liveState: LmsAssignmentLiveState | null;
  readonly liveTitle: string | null;
  readonly errorCode: string | null;
};

export type LmsGradePassbacksPreviewStudent = {
  readonly studentId: string;
  readonly displayName: string | null;
  readonly inRoster: boolean;
  readonly bestPercentage: number | null;
  readonly bestAssignmentId: string | null;
  readonly targetPoints: number | null;
  readonly classroom: {
    readonly state: LmsSubmissionState;
    readonly late: boolean;
    readonly assignedGrade: number | null;
    readonly draftGrade: number | null;
  } | null;
  readonly action: GradeReconciliationAction;
  readonly proposedPoints: number | null;
};

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

type PreflightResult =
  | {
      readonly ready: false;
      readonly preflight: LmsGradePassbacksPreflight;
    }
  | {
      readonly ready: true;
      readonly preflight: LmsGradePassbacksPreflight;
      readonly current: AssignmentOccurrence;
      readonly occurrences: readonly AssignmentOccurrence[];
      readonly maxPoints: number;
      readonly submissions: readonly LmsSubmissionGrade[];
    };

const EMPTY_PREFLIGHT: Omit<LmsGradePassbacksPreflight, "status"> = {
  currentAssignmentId: null,
  lmsAssignmentId: null,
  storedMaxPoints: null,
  liveMaxPoints: null,
  liveState: null,
  liveTitle: null,
  errorCode: null,
};

async function runPreflight(
  actor: LmsAuthenticatedTeacher,
  classId: string,
  lessonSlug: string,
): Promise<PreflightResult> {
  const scope = familyScopeFor({ classId, lessonSlug }, actor);
  const group = await resolveCurrentOccurrenceGroup(
    scope,
    actor.districtId,
    createClassAssignmentsLoader(),
  );
  if (group.resolution === "unresolved") {
    return { ready: false, preflight: { ...EMPTY_PREFLIGHT, status: "currentUnresolved" } };
  }
  if (group.resolution === "inactive") {
    return {
      ready: false,
      preflight: {
        ...EMPTY_PREFLIGHT,
        status: "currentInactive",
        currentAssignmentId: group.currentAssignmentId,
      },
    };
  }

  const current = group.current;
  let preflight: LmsGradePassbacksPreflight = {
    ...EMPTY_PREFLIGHT,
    status: "ready",
    currentAssignmentId: current.assignmentId,
  };
  const fail = (
    status: LmsGradePassbacksPreflightStatus,
    extra: Partial<LmsGradePassbacksPreflight> = {},
  ): PreflightResult => ({ ready: false, preflight: { ...preflight, ...extra, status } });

  const publication = await loadOwnedPublication(
    current.assignmentId,
    current.record,
    actor.uid,
  );
  const stored = storedGradingOf(publication, current.record);
  preflight = { ...preflight, storedMaxPoints: stored.maxPoints };
  if (!stored.graded || stored.maxPoints === null) return fail("currentUngraded");

  const lmsAssignmentId = succeededCourseworkIdOf(publication);
  if (publication === undefined || lmsAssignmentId === null) {
    return fail("currentNotPublishedToClassroom");
  }
  preflight = { ...preflight, lmsAssignmentId };

  const access = await createConnectionAccessResolver(actor.uid)(publication.connectionId);
  if (!access.ok) return fail("connectionUnavailable");
  const adapter = getProviderAdapter(access.providerId);

  let snapshot;
  try {
    snapshot = await adapter.fetchAssignment({
      accessToken: access.accessToken,
      lmsClassId: publication.lmsClassId,
      lmsAssignmentId,
    });
  } catch (err) {
    const { kind, errorCode } = classifyUpstreamReadError(err);
    return fail(
      kind === "notFound"
        ? "courseworkNotFound"
        : kind === "inaccessible"
          ? "courseworkInaccessible"
          : "courseworkError",
      { errorCode },
    );
  }
  preflight = {
    ...preflight,
    liveState: snapshot.state,
    liveTitle: snapshot.title ?? null,
    liveMaxPoints: snapshot.maxPoints ?? null,
  };
  if (snapshot.state === "deleted") return fail("courseworkDeleted");
  if (snapshot.state !== "published") return fail("courseworkNotPublished");
  if (snapshot.maxPoints === undefined) return fail("courseworkUngraded");
  if (snapshot.maxPoints !== stored.maxPoints) return fail("maxPointsMismatch");

  let submissions: readonly LmsSubmissionGrade[];
  try {
    submissions = await adapter.listSubmissionGrades({
      accessToken: access.accessToken,
      lmsClassId: publication.lmsClassId,
      lmsAssignmentId,
    });
  } catch (err) {
    return fail("submissionsUnavailable", {
      errorCode: classifyUpstreamReadError(err).errorCode,
    });
  }

  return {
    ready: true,
    preflight,
    current,
    occurrences: group.occurrences,
    maxPoints: stored.maxPoints,
    submissions,
  };
}

// Attempts across the whole family, grouped by student. Attempts are kept
// only when their own frozen ownership matches the family (defensive; the
// query is already scoped by assignment id).
async function loadFamilyAttempts(
  occurrences: readonly AssignmentOccurrence[],
  scope: { readonly classId: string; readonly schoolId: string },
): Promise<Map<string, { id: string; data: AssessmentAttemptRecord }[]>> {
  const byStudent = new Map<string, { id: string; data: AssessmentAttemptRecord }[]>();
  for (const { assignmentId } of occurrences) {
    const snapshot = await attemptsCollectionRef()
      .where("assignmentId", "==", assignmentId)
      .get();
    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (
        !data ||
        data.assignmentId !== assignmentId ||
        data.classId !== scope.classId ||
        data.schoolId !== scope.schoolId ||
        typeof data.studentId !== "string" ||
        data.studentId.length === 0
      ) {
        continue;
      }
      const list = byStudent.get(data.studentId) ?? [];
      list.push({ id: doc.id, data });
      byStudent.set(data.studentId, list);
    }
  }
  return byStudent;
}

async function loadRoster(
  current: AssignmentOccurrence,
  actor: LmsAuthenticatedTeacher,
): Promise<ReadonlySet<string>> {
  const record: AssignmentRecord = current.record;
  const [recipients, enrolled] = await Promise.all([
    loadExistingRecipientStudentIds({
      assignmentId: current.assignmentId,
      classId: record.classId,
      teacherId: record.teacherId,
      schoolId: record.schoolId,
      districtId: actor.districtId,
      assignedBy: actor.uid,
    }),
    loadActiveEnrolledStudentIds(record.classId, record.schoolId),
  ]);
  return new Set([...recipients].filter((id) => enrolled.has(id)));
}

async function displayNameOf(studentId: string): Promise<string | null> {
  try {
    const snapshot = await userRecordDocRef(studentId).get();
    const name = snapshot.exists ? snapshot.data()?.displayName : undefined;
    return typeof name === "string" && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

async function handler(
  request: CallableRequest<unknown>,
): Promise<LmsGradePassbacksPreviewResponse> {
  ensureGoogleClassroomProductionBindings();
  const actor = await assertAuthenticatedTeacherForLms(request);
  const { classId, lessonSlug } = parseFamilyRequest(request.data);
  await assertOwnedClass(classId, actor);

  const result = await runPreflight(actor, classId, lessonSlug);
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

  const { current, occurrences, maxPoints, submissions } = result;
  const [roster, attemptsByStudent] = await Promise.all([
    loadRoster(current, actor),
    loadFamilyAttempts(occurrences, { classId, schoolId: actor.schoolId }),
  ]);

  // Submissions by upstream account id. More than one submission for the
  // same account is ambiguous and never guessed at.
  const submissionsByAccount = new Map<string, LmsSubmissionGrade[]>();
  for (const submission of submissions) {
    const list = submissionsByAccount.get(submission.studentProviderAccountId) ?? [];
    list.push(submission);
    submissionsByAccount.set(submission.studentProviderAccountId, list);
  }

  // Resolve every in-roster student's upstream identity first so an
  // upstream account claimed by two LyfeLabz students is detected.
  const accountByStudent = new Map<string, string | null | Error>();
  for (const studentId of roster) {
    try {
      accountByStudent.set(
        studentId,
        await resolveActiveProviderAccountIdForUser(studentId, "google.com"),
      );
    } catch (err) {
      accountByStudent.set(studentId, err instanceof Error ? err : new Error("identity"));
    }
  }
  const accountClaims = new Map<string, number>();
  for (const account of accountByStudent.values()) {
    if (typeof account === "string") {
      accountClaims.set(account, (accountClaims.get(account) ?? 0) + 1);
    }
  }

  const studentIds = [...new Set([...roster, ...attemptsByStudent.keys()])];
  const students: LmsGradePassbacksPreviewStudent[] = [];
  for (const studentId of studentIds) {
    const displayName = await displayNameOf(studentId);
    const inRoster = roster.has(studentId);
    let target: ReturnType<typeof cumulativeTargetFor> = null;
    let bestAssignmentId: string | null = null;
    const base = { studentId, displayName, inRoster };
    try {
      const attempts = attemptsByStudent.get(studentId) ?? [];
      target = cumulativeTargetFor(attempts, maxPoints);
      bestAssignmentId =
        target === null
          ? null
          : (attempts.find((a) => a.id === target?.bestAttemptId)?.data.assignmentId ?? null);
      const scored = {
        bestPercentage: target?.bestPercentage ?? null,
        bestAssignmentId,
        targetPoints: target?.targetPoints ?? null,
      };
      const row = (
        action: GradeReconciliationAction,
        classroom: LmsGradePassbacksPreviewStudent["classroom"] = null,
        proposedPoints: number | null = null,
      ): LmsGradePassbacksPreviewStudent => ({
        ...base,
        ...scored,
        classroom,
        action,
        proposedPoints,
      });

      if (!inRoster) {
        students.push(row("outsideRoster"));
        continue;
      }
      const account = accountByStudent.get(studentId);
      const identityProblem: GradeReconciliationAction | null =
        account instanceof Error
          ? "error"
          : account === null || account === undefined
            ? "identityUnresolved"
            : (accountClaims.get(account) ?? 0) > 1
              ? "identityConflict"
              : null;
      const matches =
        identityProblem === null && typeof account === "string"
          ? (submissionsByAccount.get(account) ?? [])
          : [];
      const submission = matches.length === 1 ? matches[0] : undefined;
      const classroom = submission
        ? {
            state: submission.state,
            late: submission.late,
            assignedGrade: submission.assignedGrade,
            draftGrade: submission.draftGrade,
          }
        : null;
      // No LyfeLabz attempt: nothing would ever be written, whatever the
      // identity or submission state; show the Classroom grade when known.
      if (target === null) {
        students.push(row("noLyfeLabzAttempt", classroom));
        continue;
      }
      if (identityProblem !== null) {
        students.push(row(identityProblem));
        continue;
      }
      if (matches.length > 1) {
        students.push(row("submissionAmbiguous"));
        continue;
      }
      if (!submission) {
        students.push(row("submissionUnavailable"));
        continue;
      }
      const decision = decideGradeAction(
        target.targetPoints,
        readExistingClassroomGrade(submission.assignedGrade, submission.draftGrade),
      );
      students.push(row(decision.action, classroom, decision.proposedPoints));
    } catch {
      students.push({
        ...base,
        bestPercentage: target?.bestPercentage ?? null,
        bestAssignmentId,
        targetPoints: target?.targetPoints ?? null,
        classroom: null,
        action: "error",
        proposedPoints: null,
      });
    }
  }

  students.sort((a, b) => {
    const an = a.displayName ?? "";
    const bn = b.displayName ?? "";
    return an !== bn ? an.localeCompare(bn) : a.studentId.localeCompare(b.studentId);
  });

  const byAction: Partial<Record<GradeReconciliationAction, number>> = {};
  let wouldWrite = 0;
  for (const s of students) {
    byAction[s.action] = (byAction[s.action] ?? 0) + 1;
    if (WRITE_ACTIONS.has(s.action)) wouldWrite += 1;
  }

  return {
    classId,
    lessonSlug,
    preflight: result.preflight,
    maxPoints,
    students,
    summary: { byAction, wouldWrite },
  };
}

export const lmsGradePassbacksPreview = platformCallable(
  { secrets: [...googleClassroomProductionSecrets] },
  handler,
);
export const __lmsGradePassbacksPreviewHandler = handler;
