import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  assignmentDocRef,
  assignmentRecipientCreationDocRef,
  assignmentRecipientDocRef,
  classDocRef,
  enrollmentDocRef,
  log,
  requireDistrictContext,
  writeAuditEvent,
  type AssignmentRecord,
  type ClassRecord,
  type EnrollmentRecord,
} from "../shared";

import { enrollmentIdFor } from "../enrollments/enrollments-join-by-code";

import {
  buildRecipientCreationWrite,
  type RecipientOwnershipContext,
} from "./assignment-recipients";

// Client-supplied request payload for assignmentsRecipientAdd. A teacher
// authenticates and names the (assignmentId, studentId) pair to add.
// Ownership fields (classId, teacherId, schoolId, districtId), the
// recipient source, the recipient status, the recipient timestamp, and
// every LMS or window override are never carried on the request and are
// derived server-side from the assignment, the class, and the caller's
// district context.
export type AssignmentsRecipientAddRequest = {
  readonly assignmentId: string;
  readonly studentId: string;
};

// Return payload of a successful late-recipient-add call. `added` is
// `true` when this call wrote a new recipient document, and `false` when
// the recipient already existed and no mutation occurred (idempotent
// no-op).
export type AssignmentsRecipientAddResponse = {
  readonly assignmentId: string;
  readonly studentId: string;
  readonly added: boolean;
};

const ASSIGNMENT_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;
const STUDENT_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,126}[a-zA-Z0-9])?$/;

// Fields the client is not permitted to carry on the request. Every one is
// derived server-side; a client that supplies any of them is refused with a
// canonical invalid-request identifier so no laundering path can suggest
// cross-owner access, source override, timestamp override, or an LMS or
// window override.
const FORBIDDEN_REQUEST_KEYS: readonly string[] = [
  "classId",
  "teacherId",
  "schoolId",
  "districtId",
  "source",
  "status",
  "assignedAt",
  "assignedBy",
  "lmsCourseId",
  "lmsCourseworkId",
  "lmsPublicationRef",
  "windowClosesAt",
  "availableAt",
  "mode",
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function assertActiveTeacherInDistrict(
  request: CallableRequest<unknown>,
): Promise<{ readonly uid: string; readonly schoolId: string; readonly districtId: string }> {
  const context = await requireDistrictContext(request);
  if (context.role !== "teacher") {
    throw new PlatformError(
      "role-forbidden",
      "Caller must be an active teacher.",
    );
  }
  return { uid: context.uid, schoolId: context.schoolId, districtId: context.districtId };
}

function validateRequest(data: unknown): AssignmentsRecipientAddRequest {
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
  if (!("assignmentId" in payload) || !isNonEmptyString(payload.assignmentId)) {
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
  if (!("studentId" in payload) || !isNonEmptyString(payload.studentId)) {
    throw new PlatformError(
      "assignments.invalidStudentId",
      "studentId must be a non-empty string.",
    );
  }
  const studentId = payload.studentId.trim();
  if (!STUDENT_ID_PATTERN.test(studentId)) {
    throw new PlatformError(
      "assignments.invalidStudentId",
      "studentId must be a URL-safe token.",
    );
  }
  return { assignmentId, studentId };
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
    throw new PlatformError(
      "classes.notFound",
      "Class was not found.",
    );
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError(
      "classes.notFound",
      "Class record was empty.",
    );
  }
  return data;
}

async function loadEnrollment(
  classId: string,
  studentId: string,
): Promise<EnrollmentRecord> {
  const enrollmentId = enrollmentIdFor(classId, studentId);
  const snapshot = await enrollmentDocRef(enrollmentId).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "assignments.recipientEnrollmentMissing",
      "Target student is not enrolled in the assignment class.",
    );
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError(
      "assignments.recipientEnrollmentMissing",
      "Enrollment record was empty.",
    );
  }
  return data;
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

// assignmentsRecipientAdd
//
// Canonical late-recipient add for the frozen recipient population of an
// already-published assignment per PDR-029j. Creates exactly one
// `assignments/{assignmentId}/recipients/{studentId}` document with
// `source: "manualAddition"`. Callable by the owning teacher only.
//
// Every side effect flows through the canonical shared helpers:
//   - assignment read via `assignmentDocRef(...).get()`            (typed ref)
//   - class read via `classDocRef(...).get()`                      (typed ref)
//   - enrollment read via `enrollmentDocRef(...).get()`            (typed ref)
//   - existing-recipient read via `assignmentRecipientDocRef(...).get()`
//                                                                  (typed ref)
//   - creation write via `assignmentRecipientCreationDocRef(...).set(...)`
//                                                                  (typed ref)
//   - audit event via `writeAuditEvent({...})`                     (§5 helper)
//
// Authorization (PDR-029j):
//   1. Caller is authenticated with a district context.
//   2. Caller is an active teacher.
//   3. Assignment exists.
//   4. Assignment's frozen `teacherId` equals caller uid.
//   5. Assignment's frozen `schoolId` equals caller schoolId.
//   6. Assignment's referenced class exists.
//   7. Class's frozen `teacherId` equals caller uid.
//   8. Class's frozen `schoolId` equals caller schoolId.
//   9. Assignment and class ownership are internally consistent.
//   10. Assignment lifecycle is `published`. `draft`, `closed`, and
//       `archived` are refused per PDR-029j (draft has no frozen
//       population yet; closed and archived MUST NOT gain recipients).
//   11. Target student has an active enrollment in the assignment's
//       frozen class and school. Every other enrollment status is refused.
//   12. Enrollment ownership fields are internally consistent with the
//       assignment and the class.
//
// Idempotency: if a recipient document already exists for this
// (assignmentId, studentId) pair, the callable returns
// `added: false`, does not overwrite the existing record, does not
// change its `source` or `assignedAt`, and does not emit a second audit
// event.
async function assignmentsRecipientAddHandler(
  request: CallableRequest<unknown>,
): Promise<AssignmentsRecipientAddResponse> {
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
      "assignments.invalidState",
      "Assignment record is missing its class reference.",
    );
  }

  if (assignment.status !== "published") {
    throw new PlatformError(
      "assignments.invalidTransition",
      `Recipients may only be added to a published assignment; current status is "${assignment.status}".`,
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

  const enrollment = await loadEnrollment(assignment.classId, input.studentId);
  if (
    enrollment.classId !== assignment.classId ||
    enrollment.schoolId !== assignment.schoolId ||
    enrollment.studentId !== input.studentId
  ) {
    throw new PlatformError(
      "assignments.recipientEnrollmentMissing",
      "Enrollment record does not match the assignment class or student.",
    );
  }
  if (enrollment.status !== "active") {
    throw new PlatformError(
      "assignments.recipientEnrollmentInactive",
      `Target enrollment status must be "active"; current status is "${enrollment.status}".`,
    );
  }

  const existing = await assignmentRecipientDocRef(
    input.assignmentId,
    input.studentId,
  ).get();
  if (existing.exists) {
    safeLog(() =>
      log.info("assignments.recipientAddIdempotent", {
        actorUserId: actor.uid,
        assignmentId: input.assignmentId,
        studentId: input.studentId,
      }),
    );
    return {
      assignmentId: input.assignmentId,
      studentId: input.studentId,
      added: false,
    };
  }

  const context: RecipientOwnershipContext = {
    assignmentId: input.assignmentId,
    classId: assignment.classId,
    teacherId: assignment.teacherId,
    schoolId: assignment.schoolId,
    districtId: actor.districtId,
    assignedBy: actor.uid,
  };

  await assignmentRecipientCreationDocRef(
    input.assignmentId,
    input.studentId,
  ).set(buildRecipientCreationWrite(context, input.studentId, "manualAddition"));

  await writeAuditEvent({
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "assignments.recipientAdded",
    targetType: "assignmentRecipient",
    targetId: `${input.assignmentId}/${input.studentId}`,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
    payload: {
      assignmentId: input.assignmentId,
      studentId: input.studentId,
      classId: assignment.classId,
      source: "manualAddition",
    },
  });

  safeLog(() =>
    log.info("assignments.recipientAdded", {
      actorUserId: actor.uid,
      assignmentId: input.assignmentId,
      studentId: input.studentId,
    }),
  );

  return {
    assignmentId: input.assignmentId,
    studentId: input.studentId,
    added: true,
  };
}

export const assignmentsRecipientAdd = platformCallable(
  assignmentsRecipientAddHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assignmentsRecipientAddHandler = assignmentsRecipientAddHandler;
