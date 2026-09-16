import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

// Student Progress & Assignment Membership Phase A, Slice 4: entry-point
// wire for the certified `assessmentStudentAssignmentsForClass` callable.
// Isolated from the pure Student Detail surface so tests can inject an
// in-memory fake and the surface stays firebase-free. Confidentiality: the
// callable returns only the assignment instances a student is an expected
// recipient of, plus whether each currently has a live assessment session -
// no score, percentage, answer, session content, or PII beyond assignmentId
// crosses this boundary.

export type StudentExpectedAssignment = {
  readonly assignmentId: string;
  readonly hasLiveSession: boolean;
};

export type AssessmentStudentAssignmentsForClassCallable = (input: {
  readonly classId: string;
  readonly studentId: string;
}) => Promise<{
  readonly classId: string;
  readonly studentId: string;
  readonly assignments: ReadonlyArray<StudentExpectedAssignment>;
}>;

type CallableRecord = Readonly<Record<string, unknown>>;

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

export function createAssessmentStudentAssignmentsForClassCallable(
  functions: Functions,
): AssessmentStudentAssignmentsForClassCallable {
  const callable = httpsCallable(
    functions,
    "assessmentStudentAssignmentsForClass",
  );
  return async (input) => {
    const res = await callable({
      classId: input.classId,
      studentId: input.studentId,
    });
    const data = (res.data ?? {}) as CallableRecord;
    const rawList = Array.isArray(data.assignments) ? data.assignments : [];
    const parsed: StudentExpectedAssignment[] = [];
    for (const raw of rawList) {
      if (raw === null || typeof raw !== "object") continue;
      const r = raw as CallableRecord;
      if (!isNonEmptyString(r.assignmentId)) continue;
      parsed.push({
        assignmentId: r.assignmentId,
        hasLiveSession: r.hasLiveSession === true,
      });
    }
    return {
      classId: isNonEmptyString(data.classId) ? data.classId : input.classId,
      studentId: isNonEmptyString(data.studentId)
        ? data.studentId
        : input.studentId,
      assignments: parsed,
    };
  };
}
