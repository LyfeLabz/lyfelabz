import { FieldValue } from "firebase-admin/firestore";
import { onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  classDocRef,
  enrollmentCreationDocRef,
  enrollmentDocRef,
  log,
  requireDistrictContext,
  userRecordDocRef,
  writeAuditEvent,
  type ClassRecord,
  type EnrollmentCreationWrite,
  type UserRecord,
} from "../shared";

import { enrollmentIdFor } from "./enrollments-join-by-code";

// Client-supplied request payload for enrollmentsTeacherAdd. A teacher
// authenticates and names the (classId, studentId) pair to enroll. Ownership
// fields are never carried on the request: the caller's uid must match the
// class's teacherId, and schoolId is derived server-side from the class
// record so it cannot be spoofed.
export type EnrollmentsTeacherAddRequest = {
  readonly classId: string;
  readonly studentId: string;
  readonly displayNameOverride?: string;
};

// Return payload of a successful teacher-add call. `alreadyEnrolled` is
// `true` when the target student is already actively enrolled in the class
// and no write is required; `false` when this call wrote the canonical
// enrollments/{enrollmentId} document.
export type EnrollmentsTeacherAddResponse = {
  readonly enrollmentId: string;
  readonly classId: string;
  readonly studentId: string;
  readonly alreadyEnrolled: boolean;
};

const CLASS_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;
const STUDENT_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,126}[a-zA-Z0-9])?$/;

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

function validateRequest(data: unknown): EnrollmentsTeacherAddRequest {
  if (data === null || typeof data !== "object") {
    throw new PlatformError(
      "enrollments.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;

  if (!isNonEmptyString(payload.classId)) {
    throw new PlatformError(
      "enrollments.invalidClassId",
      "classId must be a non-empty string.",
    );
  }
  const classId = payload.classId.trim();
  if (!CLASS_ID_PATTERN.test(classId)) {
    throw new PlatformError(
      "enrollments.invalidClassId",
      "classId must be a URL-safe token.",
    );
  }

  if (!isNonEmptyString(payload.studentId)) {
    throw new PlatformError(
      "enrollments.invalidStudentId",
      "studentId must be a non-empty string.",
    );
  }
  const studentId = payload.studentId.trim();
  if (!STUDENT_ID_PATTERN.test(studentId)) {
    throw new PlatformError(
      "enrollments.invalidStudentId",
      "studentId must be a URL-safe token.",
    );
  }

  const out: {
    classId: string;
    studentId: string;
    displayNameOverride?: string;
  } = { classId, studentId };

  if (payload.displayNameOverride !== undefined) {
    if (!isNonEmptyString(payload.displayNameOverride)) {
      throw new PlatformError(
        "enrollments.invalidDisplayNameOverride",
        "displayNameOverride, when supplied, must be a non-empty string.",
      );
    }
    out.displayNameOverride = payload.displayNameOverride.trim();
  }

  return out;
}

async function loadClass(classId: string): Promise<ClassRecord> {
  const snapshot = await classDocRef(classId).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "enrollments.classNotFound",
      "Class was not found.",
    );
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError(
      "enrollments.classNotFound",
      "Class record was empty.",
    );
  }
  return data;
}

async function loadStudent(studentId: string): Promise<UserRecord> {
  const snapshot = await userRecordDocRef(studentId).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "enrollments.studentNotFound",
      "Target student user was not found.",
    );
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError(
      "enrollments.studentNotFound",
      "Target student user record was empty.",
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

// enrollmentsTeacherAdd
//
// Canonical teacher-mediated creation of an enrollments/{enrollmentId}
// document per Data Model §3.4 and Security Model §4.4 (owning-teacher
// editor).
//
// Callable by an authenticated teacher whose canonical custom claims
// (`{ role: "teacher", schoolId }`) match the class record's schoolId and
// whose uid matches the class record's teacherId. Cross-teacher or
// cross-school adds are rejected with `enrollments.forbidden`. The target
// student must exist and belong to the same school; otherwise the request
// is rejected with `enrollments.studentNotFound` or
// `enrollments.forbidden` to prevent cross-school leakage.
//
// Every side effect flows through the canonical shared helpers:
//   - class read via `classDocRef(classId).get()`
//   - student read via `userRecordDocRef(studentId).get()`
//   - existing-record read via `enrollmentDocRef(enrollmentId).get()`
//   - creation write via `enrollmentCreationDocRef(enrollmentId).set(...)`
//   - audit event via `writeAuditEvent({...})`                   (§5 helper)
//
// Idempotency: an existing active enrollment for this (student, class) pair
// returns `alreadyEnrolled: true` with no second write and no second audit
// event. Prior enrollments in a terminal status are rejected with
// `enrollments.conflict`.
async function enrollmentsTeacherAddHandler(
  request: CallableRequest<unknown>,
): Promise<EnrollmentsTeacherAddResponse> {
  const actor = await assertActiveTeacherInDistrict(request);
  const input = validateRequest(request.data);

  const classRecord = await loadClass(input.classId);
  if (
    classRecord.teacherId !== actor.uid ||
    classRecord.schoolId !== actor.schoolId
  ) {
    throw new PlatformError(
      "enrollments.forbidden",
      "Caller does not own this class.",
    );
  }
  if (classRecord.status !== "active") {
    throw new PlatformError(
      "enrollments.invalidClassStatus",
      "Enrollments may only be added to an active class.",
    );
  }

  const student = await loadStudent(input.studentId);
  if (student.role !== "student") {
    throw new PlatformError(
      "enrollments.invalidTargetRole",
      "Target user is not a student.",
    );
  }
  if (student.schoolId !== classRecord.schoolId) {
    throw new PlatformError(
      "enrollments.forbidden",
      "Target student belongs to a different school.",
    );
  }
  if (student.status !== "active") {
    throw new PlatformError(
      "enrollments.invalidTargetStatus",
      "Target student account is not active.",
    );
  }

  const id = enrollmentIdFor(input.classId, input.studentId);
  const existing = await enrollmentDocRef(id).get();
  if (existing.exists) {
    const data = existing.data();
    if (
      data &&
      data.studentId === input.studentId &&
      data.classId === input.classId &&
      data.schoolId === classRecord.schoolId &&
      data.status === "active"
    ) {
      safeLog(() =>
        log.info("enrollments.teacherAddIdempotent", {
          actorUserId: actor.uid,
          classId: input.classId,
          studentId: input.studentId,
        }),
      );
      return {
        enrollmentId: id,
        classId: input.classId,
        studentId: input.studentId,
        alreadyEnrolled: true,
      };
    }
    throw new PlatformError(
      "enrollments.conflict",
      "An enrollment record already exists for this student and class.",
    );
  }

  const creation: EnrollmentCreationWrite = {
    studentId: input.studentId,
    classId: input.classId,
    schoolId: classRecord.schoolId,
    status: "active",
    enrolledAt: FieldValue.serverTimestamp(),
    ...(input.displayNameOverride !== undefined
      ? { displayNameOverride: input.displayNameOverride }
      : {}),
  };

  await enrollmentCreationDocRef(id).set(creation);

  await writeAuditEvent({
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "enrollments.created",
    targetType: "enrollment",
    targetId: id,
    schoolId: classRecord.schoolId,
    payload: {
      classId: input.classId,
      studentId: input.studentId,
      source: "teacherAdd",
    },
  });

  safeLog(() =>
    log.info("enrollments.created", {
      actorUserId: actor.uid,
      classId: input.classId,
      studentId: input.studentId,
      enrollmentId: id,
    }),
  );

  return {
    enrollmentId: id,
    classId: input.classId,
    studentId: input.studentId,
    alreadyEnrolled: false,
  };
}

export const enrollmentsTeacherAdd = onCall(enrollmentsTeacherAddHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __enrollmentsTeacherAddHandler = enrollmentsTeacherAddHandler;
