import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  attemptsCollectionRef,
  log,
  requireDistrictContext,
  type AssessmentAttemptRecord,
} from "../shared";
import { createRosterDisplayNameResolver } from "../enrollments/resolve-roster-display-name";
import { authorizeStudentScopedRead } from "../supportAccess/authorize";
import {
  projectTeacherClassAttemptSummary,
  type TeacherClassAttemptSummary,
} from "./assessment-attempts-list-for-class";

// assessmentAttemptsListForStudent { classId, studentId }
//
// Student Support Access (PDR-032, docs/platform/STUDENT_SUPPORT_ACCESS.md
// section 5): completed attempt summaries for ONE student in ONE class. It is
// the student-scoped sibling of `assessmentAttemptsListForClass`, which stays
// owner-only and class-wide. It never returns a classmate's record.
//
// Authorization: `requireDistrictContext` (authenticated, active, canonical
// claims, district agreement), role teacher, then the shared
// `authorizeStudentScopedRead` (class owner, or a grantee with an active grant
// for exactly this class and student). Any owner-scoping key on the request is
// refused.
//
// Query: equality on `studentId` and `classId` (merged single-field indexes,
// the same shape the passback engine already uses); no composite index. Every
// document is re-checked against the class OWNER's frozen ownership and the
// requested student before projection.
//
// Projection and display names reuse `projectTeacherClassAttemptSummary` and
// the canonical roster display-name resolver, and the sort matches the
// class-wide list, so Student Detail renders identically from either source.

export type AssessmentAttemptsListForStudentRequest = {
  readonly classId: string;
  readonly studentId: string;
};

export type AssessmentAttemptsListForStudentResponse = {
  readonly classId: string;
  readonly studentId: string;
  readonly attempts: readonly TeacherClassAttemptSummary[];
};

const FORBIDDEN_REQUEST_KEYS: readonly string[] = [
  "uid",
  "userId",
  "districtId",
  "schoolId",
  "teacherId",
];

const TOKEN_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,254}[a-zA-Z0-9])?$/;

function validateRequest(data: unknown): AssessmentAttemptsListForStudentRequest {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new PlatformError(
      "assessmentAttempts.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;
  for (const key of FORBIDDEN_REQUEST_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      throw new PlatformError(
        "assessmentAttempts.invalidRequest",
        `Field "${key}" is not permitted on the request.`,
      );
    }
  }
  const classId = typeof payload.classId === "string" ? payload.classId.trim() : "";
  if (!TOKEN_PATTERN.test(classId)) {
    throw new PlatformError("classes.invalidClassId", "classId must be a URL-safe token.");
  }
  const studentId = typeof payload.studentId === "string" ? payload.studentId.trim() : "";
  if (!TOKEN_PATTERN.test(studentId)) {
    throw new PlatformError(
      "assessmentAttempts.invalidStudentId",
      "studentId must be a URL-safe token.",
    );
  }
  return { classId, studentId };
}

async function assessmentAttemptsListForStudentHandler(
  request: CallableRequest<unknown>,
): Promise<AssessmentAttemptsListForStudentResponse> {
  const context = await requireDistrictContext(request);
  if (context.role !== "teacher") {
    throw new PlatformError("role-forbidden", "Caller must be an active teacher.");
  }
  const actor = { uid: context.uid, schoolId: context.schoolId, districtId: context.districtId };
  const input = validateRequest(request.data);

  const access = await authorizeStudentScopedRead(actor, input.classId, input.studentId);

  const snapshot = await attemptsCollectionRef()
    .where("studentId", "==", input.studentId)
    .where("classId", "==", input.classId)
    .get();

  const admitted: Array<{ id: string; data: AssessmentAttemptRecord }> = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!data) continue;
    if (data.studentId !== input.studentId) continue;
    if (data.classId !== input.classId) continue;
    if (data.teacherId !== access.ownerTeacherId) continue;
    if (data.schoolId !== actor.schoolId) continue;
    if (data.districtId !== actor.districtId) continue;
    admitted.push({ id: doc.id, data });
  }

  const resolveDisplayName = createRosterDisplayNameResolver({
    classId: input.classId,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
  });
  const attempts: TeacherClassAttemptSummary[] = await Promise.all(
    admitted.map(async (entry) =>
      projectTeacherClassAttemptSummary(
        entry.id,
        entry.data,
        await resolveDisplayName(entry.data.studentId),
      ),
    ),
  );
  attempts.sort((a, b) => {
    if (b.submittedAt !== a.submittedAt) return b.submittedAt - a.submittedAt;
    return a.attemptId < b.attemptId ? -1 : a.attemptId > b.attemptId ? 1 : 0;
  });

  try {
    log.info("assessmentAttempts.listedForStudent", {
      actorUserId: actor.uid,
      classId: input.classId,
      studentId: input.studentId,
      via: access.via,
      count: attempts.length,
    });
  } catch {
    // Logging is observability, not lifecycle.
  }

  return { classId: input.classId, studentId: input.studentId, attempts };
}

export const assessmentAttemptsListForStudent = platformCallable(
  assessmentAttemptsListForStudentHandler,
);

// Exported for direct unit testing without going through the callable wrapper.
export const __assessmentAttemptsListForStudentHandler =
  assessmentAttemptsListForStudentHandler;
