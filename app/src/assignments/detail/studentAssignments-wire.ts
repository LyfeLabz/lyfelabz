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

// Reassignment model: the student's work grouped by class + lesson through
// the server's canonical Current occurrence grouping (the client never
// resolves Current itself). See the server's
// `AssessmentStudentAssignmentGroup` for the full contract:
//   - "valid"      one card; operational = Current; `assignmentIds` = every
//                  occurrence in the group (attempts on any are cumulative);
//   - "inactive"   one history-only ("Closed") card; no operational assignment;
//   - "unresolved" legacy: one entry per assignment (never grouped).
export type StudentAssignmentGroup = {
  readonly resolution: "valid" | "inactive" | "unresolved";
  readonly lessonSlug: string;
  readonly operationalAssignmentId: string | null;
  readonly assignmentIds: ReadonlyArray<string>;
  readonly title: string | null;
  readonly status: string | null;
  readonly publishedAt: number | null;
  readonly hasLiveSession: boolean;
  readonly isOperationalRecipient: boolean;
};

export type AssessmentStudentAssignmentsForClassCallable = (input: {
  readonly classId: string;
  readonly studentId: string;
}) => Promise<{
  readonly classId: string;
  readonly studentId: string;
  readonly assignments: ReadonlyArray<StudentExpectedAssignment>;
  // Absent when the server predates occurrence grouping (the client then
  // keeps its per-assignment rendering).
  readonly groups?: ReadonlyArray<StudentAssignmentGroup>;
}>;

// Strict per-entry parse: a malformed entry is dropped (its attempts then
// fall back to their own per-assignment card - never hidden).
function parseGroup(raw: unknown): StudentAssignmentGroup | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as CallableRecord;
  const resolution = r.resolution;
  if (resolution !== "valid" && resolution !== "inactive" && resolution !== "unresolved") {
    return null;
  }
  if (!isNonEmptyString(r.lessonSlug)) return null;
  if (!Array.isArray(r.assignmentIds)) return null;
  const assignmentIds = r.assignmentIds.filter(isNonEmptyString);
  if (assignmentIds.length === 0 || assignmentIds.length !== r.assignmentIds.length) {
    return null;
  }
  const operational = r.operationalAssignmentId;
  if (resolution === "inactive") {
    if (operational !== null) return null;
  } else if (!isNonEmptyString(operational) || !assignmentIds.includes(operational)) {
    return null;
  }
  return {
    resolution,
    lessonSlug: r.lessonSlug,
    operationalAssignmentId: resolution === "inactive" ? null : (operational as string),
    assignmentIds,
    title: isNonEmptyString(r.title) ? r.title : null,
    status: isNonEmptyString(r.status) ? r.status : null,
    publishedAt:
      typeof r.publishedAt === "number" && Number.isFinite(r.publishedAt)
        ? r.publishedAt
        : null,
    hasLiveSession: r.hasLiveSession === true,
    isOperationalRecipient: r.isOperationalRecipient === true,
  };
}

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
    const groups = Array.isArray(data.groups)
      ? data.groups
          .map(parseGroup)
          .filter((g): g is StudentAssignmentGroup => g !== null)
      : undefined;
    return {
      classId: isNonEmptyString(data.classId) ? data.classId : input.classId,
      studentId: isNonEmptyString(data.studentId)
        ? data.studentId
        : input.studentId,
      assignments: parsed,
      ...(groups !== undefined ? { groups } : {}),
    };
  };
}
