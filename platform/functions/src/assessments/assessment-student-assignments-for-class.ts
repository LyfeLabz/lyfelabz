import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  assignmentDocRef,
  assignmentRecipientsCollectionGroupRef,
  assessmentSessionsCollectionRef,
  classDocRef,
  log,
  requireDistrictContext,
  type AssessmentSessionRecord,
  type AssignmentRecipientRecord,
  type ClassRecord,
} from "../shared";

// Student Progress & Assignment Membership, Phase A Slice 4: certified
// enumeration of the assignment instances one specific, teacher-owned
// student is an expected recipient of within one teacher-owned class, plus
// whether each currently has a live (in-progress) assessment session.
//
// Purpose: the teacher-facing Student Detail surface previously derived its
// entire display from `assessmentAttemptsListForClass`, which is blind to
// any assignment a student has never attempted. A student with assigned but
// unstarted work therefore looked identical to a student with no assigned
// work at all. This callable supplies the missing half: the set of
// assignments the student is actually expected to complete, independent of
// whether they have attempted anything.
//
// Confidentiality boundary (intentionally the narrowest surface that
// answers the question): the response carries only `assignmentId` and a
// boolean `hasLiveSession`. No score, percentage, answer, session content,
// title, Google/Classroom identifier, or any other PII crosses this
// boundary. "Completed" is deliberately NOT computed or asserted here — the
// client already derives completion from the certified
// `assessmentAttemptsListForClass` result it separately fetches, so this
// callable never invents a second, competing definition of "completed."
//
// Authorization mirrors `assessmentAttemptsListForClass` /
// `enrollmentsListForClass`: active-teacher role, owning teacher, same
// school, district boundary via `requireDistrictContext`, then explicit
// class ownership verification before any recipient or session data is
// read. `studentId` is a required input (unlike the class-scoped siblings,
// which forbid it) because this callable is one of the few that legitimately
// names a specific student on behalf of the owning teacher, exactly as
// `assignmentsRecipientAdd` and `assignmentsRecipientCandidatesList` already
// do. A `studentId` outside this teacher's class yields an empty result,
// never an error, so no cross-owner existence information leaks.
//
// Query shape: a single collection-group query on `recipients` filtered by
// `studentId`, reusing the collection-group index already declared in
// `firestore.indexes.json` for the certified student-facing
// `assignmentsListForStudent` callable — no new index is introduced. Session
// liveness is read with a single `classId`-scoped query on
// `assessmentSessions`, the same single-field-equality shape
// `assessmentAttemptsListForClass` already uses against `attempts`. Every
// candidate assignment is additionally re-loaded and cross-checked against
// its own record (mirrors `assignments-list-for-student.ts`'s
// `loadAssignmentIfVisible`) so a stale or malformed recipient row can never
// be amplified into a client-visible result.

export type AssessmentStudentAssignmentsForClassRequest = {
  readonly classId: string;
  readonly studentId: string;
};

export type AssessmentStudentExpectedAssignment = {
  readonly assignmentId: string;
  readonly hasLiveSession: boolean;
};

export type AssessmentStudentAssignmentsForClassResponse = {
  readonly classId: string;
  readonly studentId: string;
  readonly assignments: readonly AssessmentStudentExpectedAssignment[];
};

const TOKEN_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;

// Every one of these is derived server-side from the class record, the
// recipient population, or the verified district context; a client that
// supplies any of them is refused so no laundering path can suggest
// cross-owner access or a spoofed scope. `studentId` is intentionally NOT
// forbidden here - see the header comment.
const FORBIDDEN_REQUEST_KEYS: readonly string[] = [
  "uid",
  "userId",
  "districtId",
  "schoolId",
  "teacherId",
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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

function validateRequest(
  data: unknown,
): AssessmentStudentAssignmentsForClassRequest {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new PlatformError(
      "assessmentStudentAssignments.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;
  for (const key of FORBIDDEN_REQUEST_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      throw new PlatformError(
        "assessmentStudentAssignments.invalidRequest",
        `Request payload must not include ${key}.`,
      );
    }
  }
  if (!isNonEmptyString(payload.classId)) {
    throw new PlatformError(
      "classes.invalidClassId",
      "classId must be a non-empty string.",
    );
  }
  const classId = payload.classId.trim();
  if (!TOKEN_PATTERN.test(classId)) {
    throw new PlatformError(
      "classes.invalidClassId",
      "classId must be a URL-safe token.",
    );
  }
  if (!isNonEmptyString(payload.studentId)) {
    throw new PlatformError(
      "assessmentStudentAssignments.invalidStudentId",
      "studentId must be a non-empty string.",
    );
  }
  const studentId = payload.studentId.trim();
  if (!TOKEN_PATTERN.test(studentId)) {
    throw new PlatformError(
      "assessmentStudentAssignments.invalidStudentId",
      "studentId must be a URL-safe token.",
    );
  }
  return { classId, studentId };
}

async function loadOwnedClass(
  classId: string,
  actor: { readonly uid: string; readonly schoolId: string },
): Promise<ClassRecord> {
  const snapshot = await classDocRef(classId).get();
  if (!snapshot.exists) {
    throw new PlatformError("classes.forbidden", "Class was not found.");
  }
  const data = snapshot.data();
  if (
    !data ||
    data.teacherId !== actor.uid ||
    data.schoolId !== actor.schoolId
  ) {
    throw new PlatformError(
      "classes.forbidden",
      "Caller does not own this class.",
    );
  }
  return data;
}

// A minimal internal projection of the recipient record used to gate the
// candidate assignment set. Every field is required and cross-checked
// against the verified district context and the loaded class's ownership;
// any mismatch is a silent drop consistent with the defense-in-depth
// filtering pattern used throughout this domain.
function isVisibleRecipient(
  doc: { readonly id: string },
  record: AssignmentRecipientRecord | undefined,
  input: { readonly classId: string; readonly studentId: string },
  actor: {
    readonly uid: string;
    readonly schoolId: string;
    readonly districtId: string;
  },
): record is AssignmentRecipientRecord {
  if (!record) return false;
  if (doc.id !== record.studentId) return false;
  if (record.studentId !== input.studentId) return false;
  if (record.classId !== input.classId) return false;
  if (record.teacherId !== actor.uid) return false;
  if (record.schoolId !== actor.schoolId) return false;
  if (record.districtId !== actor.districtId) return false;
  if (record.status !== "assigned") return false;
  if (!isNonEmptyString(record.assignmentId)) return false;
  return true;
}

// Defense-in-depth re-verification of a candidate assignment against its own
// record, mirroring `loadAssignmentIfVisible` in
// `assignments-list-for-student.ts`. A divergence between the recipient
// snapshot and the live assignment record indicates a data-invariant
// violation the retrieval layer must not amplify, so it is a silent drop.
async function isAssignmentStillOwned(
  assignmentId: string,
  input: { readonly classId: string },
  actor: { readonly uid: string; readonly schoolId: string },
): Promise<boolean> {
  let snap: Awaited<ReturnType<ReturnType<typeof assignmentDocRef>["get"]>>;
  try {
    snap = await assignmentDocRef(assignmentId).get();
  } catch {
    return false;
  }
  if (!snap.exists) return false;
  const data = snap.data();
  if (!data) return false;
  if (data.classId !== input.classId) return false;
  if (data.teacherId !== actor.uid) return false;
  if (data.schoolId !== actor.schoolId) return false;
  return true;
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

async function assessmentStudentAssignmentsForClassHandler(
  request: CallableRequest<unknown>,
): Promise<AssessmentStudentAssignmentsForClassResponse> {
  const actor = await assertActiveTeacherInDistrict(request);
  const input = validateRequest(request.data);

  await loadOwnedClass(input.classId, actor);

  // Canonical query: enumerate every recipient document for the requested
  // student across every assignment, scoped to this class and this
  // teacher's ownership after the read. Reuses the collection-group index
  // already declared for `assignmentsListForStudent`; no new index is
  // introduced.
  const recipientSnapshot = await assignmentRecipientsCollectionGroupRef()
    .where("studentId", "==", input.studentId)
    .get();

  const candidateAssignmentIds = new Set<string>();
  for (const doc of recipientSnapshot.docs) {
    const data = doc.data() as AssignmentRecipientRecord | undefined;
    if (!isVisibleRecipient(doc, data, input, actor)) continue;
    candidateAssignmentIds.add(data.assignmentId);
  }

  const verified: string[] = [];
  await Promise.all(
    Array.from(candidateAssignmentIds).map(async (assignmentId) => {
      const ok = await isAssignmentStillOwned(assignmentId, input, actor);
      if (ok) verified.push(assignmentId);
    }),
  );

  // Single-field equality query on `classId`, the same shape
  // `assessmentAttemptsListForClass` already uses against `attempts` - no
  // new composite index required. Session content (responses, timestamps)
  // is never read into the response; only existence of a `live` session for
  // this student, scoped to a verified candidate assignment, is retained.
  const sessionsSnapshot = await assessmentSessionsCollectionRef()
    .where("classId", "==", input.classId)
    .get();

  const verifiedSet = new Set(verified);
  const liveSessionAssignmentIds = new Set<string>();
  for (const doc of sessionsSnapshot.docs) {
    const data = doc.data() as AssessmentSessionRecord | undefined;
    if (!data) continue;
    if (data.status !== "live") continue;
    if (data.studentId !== input.studentId) continue;
    if (data.classId !== input.classId) continue;
    if (data.teacherId !== actor.uid) continue;
    if (data.schoolId !== actor.schoolId) continue;
    if (data.districtId !== actor.districtId) continue;
    if (!isNonEmptyString(data.assignmentId)) continue;
    if (!verifiedSet.has(data.assignmentId)) continue;
    liveSessionAssignmentIds.add(data.assignmentId);
  }

  const assignments: AssessmentStudentExpectedAssignment[] = verified
    .slice()
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((assignmentId) => ({
      assignmentId,
      hasLiveSession: liveSessionAssignmentIds.has(assignmentId),
    }));

  safeLog(() =>
    log.info("assessmentStudentAssignments.listedForClass", {
      actorUserId: actor.uid,
      classId: input.classId,
      studentId: input.studentId,
      count: assignments.length,
    }),
  );

  return { classId: input.classId, studentId: input.studentId, assignments };
}

export const assessmentStudentAssignmentsForClass = platformCallable(
  assessmentStudentAssignmentsForClassHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assessmentStudentAssignmentsForClassHandler =
  assessmentStudentAssignmentsForClassHandler;
