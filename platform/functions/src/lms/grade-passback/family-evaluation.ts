import {
  attemptsCollectionRef,
  resolveActiveProviderAccountIdForUser,
  userRecordDocRef,
  type AssessmentAttemptRecord,
} from "../../shared";
import {
  createClassAssignmentsLoader,
  resolveCurrentOccurrenceGroup,
  type AssignmentOccurrence,
} from "../../assignments/current-occurrence-group";
import {
  loadActiveEnrolledStudentIds,
  loadExistingRecipientStudentIds,
} from "../../assignments/assignment-recipients";

import type {
  LmsAssignmentLiveState,
  LmsSubmissionGrade,
  LmsSubmissionState,
} from "../providers/provider";
import type { LmsAuthenticatedTeacher } from "../shared/actor";
import { classifyUpstreamReadError, familyScopeFor } from "../shared/coursework-family";

import {
  resolveLiveGradeDestination,
  type GradeDestinationFailureStatus,
  type LiveGradeDestination,
} from "./destination";
import {
  WRITE_ACTIONS,
  cumulativeTargetFor,
  decideGradeAction,
  type GradeReconciliationAction,
} from "./reconciliation-plan";

// Class + lesson family grade evaluation shared by the teacher
// reconciliation preview and apply callables. Read-only: resolves Current,
// runs the canonical live destination preflight, reads the whole
// destination submission list once, and classifies every in-scope student
// with the canonical decision. Apply uses this only to choose candidates;
// every actual write re-reads and re-decides inside the grade-passback
// engine under its lease.
//
// Roster boundary: canonical recipient of Current AND actively enrolled in
// the class. Students with family attempts outside it are `outsideRoster`.

export type FamilyPreflightStatus =
  | "ready"
  | "currentUnresolved"
  | "currentInactive"
  | GradeDestinationFailureStatus
  | "submissionsUnavailable";

export type FamilyPreflight = {
  readonly status: FamilyPreflightStatus;
  readonly currentAssignmentId: string | null;
  readonly lmsAssignmentId: string | null;
  readonly storedMaxPoints: number | null;
  readonly liveMaxPoints: number | null;
  readonly liveState: LmsAssignmentLiveState | null;
  readonly liveTitle: string | null;
  readonly errorCode: string | null;
};

export type FamilyPreflightResult =
  | { readonly ready: false; readonly preflight: FamilyPreflight }
  | {
      readonly ready: true;
      readonly preflight: FamilyPreflight;
      readonly current: AssignmentOccurrence;
      readonly occurrences: readonly AssignmentOccurrence[];
      readonly destination: LiveGradeDestination;
      readonly submissions: readonly LmsSubmissionGrade[];
    };

const EMPTY_PREFLIGHT: Omit<FamilyPreflight, "status"> = {
  currentAssignmentId: null,
  lmsAssignmentId: null,
  storedMaxPoints: null,
  liveMaxPoints: null,
  liveState: null,
  liveTitle: null,
  errorCode: null,
};

// Fails closed: anything but a valid Current whose live destination passes
// the canonical preflight and whose submission list is readable returns
// `ready: false` with the reason.
export async function runFamilyPreflight(
  actor: LmsAuthenticatedTeacher,
  classId: string,
  lessonSlug: string,
): Promise<FamilyPreflightResult> {
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
  const resolved = await resolveLiveGradeDestination(current.assignmentId, current.record);
  const preflight: FamilyPreflight = {
    ...EMPTY_PREFLIGHT,
    ...resolved.observed,
    currentAssignmentId: current.assignmentId,
    status: resolved.ok ? "ready" : resolved.status,
  };
  if (!resolved.ok) return { ready: false, preflight };
  const destination = resolved.destination;

  let submissions: readonly LmsSubmissionGrade[];
  try {
    submissions = await destination.adapter.listSubmissionGrades({
      accessToken: destination.accessToken,
      lmsClassId: destination.lmsClassId,
      lmsAssignmentId: destination.lmsAssignmentId,
    });
  } catch (err) {
    return {
      ready: false,
      preflight: {
        ...preflight,
        status: "submissionsUnavailable",
        errorCode: classifyUpstreamReadError(err).errorCode,
      },
    };
  }

  return {
    ready: true,
    preflight,
    current,
    occurrences: group.occurrences,
    destination,
    submissions,
  };
}

export type FamilyStudentEvaluation = {
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
  const record = current.record;
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

export async function evaluateFamilyStudents(
  ready: Extract<FamilyPreflightResult, { ready: true }>,
  actor: LmsAuthenticatedTeacher,
  classId: string,
): Promise<FamilyStudentEvaluation[]> {
  const { current, occurrences, destination, submissions } = ready;
  const maxPoints = destination.maxPoints;
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
  const students: FamilyStudentEvaluation[] = [];
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
        classroom: FamilyStudentEvaluation["classroom"] = null,
        proposedPoints: number | null = null,
      ): FamilyStudentEvaluation => ({
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
      const decision = decideGradeAction(target.targetPoints, submission);
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
  return students;
}

export function summarizeActions(
  students: readonly { readonly action: GradeReconciliationAction }[],
): {
  readonly byAction: Readonly<Partial<Record<GradeReconciliationAction, number>>>;
  readonly wouldWrite: number;
} {
  const byAction: Partial<Record<GradeReconciliationAction, number>> = {};
  let wouldWrite = 0;
  for (const s of students) {
    byAction[s.action] = (byAction[s.action] ?? 0) + 1;
    if (WRITE_ACTIONS.has(s.action)) wouldWrite += 1;
  }
  return { byAction, wouldWrite };
}
