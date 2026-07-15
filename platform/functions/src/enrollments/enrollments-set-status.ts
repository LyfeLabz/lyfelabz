import { FieldValue } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  classDocRef,
  enrollmentDocRef,
  enrollmentStatusChangeDocRef,
  log,
  requireDistrictContext,
  writeAuditEvent,
  type ClassRecord,
  type EnrollmentRecord,
  type EnrollmentStatus,
  type EnrollmentStatusChangeWrite,
} from "../shared";

// Client-supplied request payload for enrollmentsSetStatus. A teacher
// authenticates and names the target enrollmentId together with the desired
// next `status`. Ownership fields are never carried on the request; they
// are verified server-side against the enrollment's canonical §3.4 fields
// and the referenced class record.
export type EnrollmentsSetStatusRequest = {
  readonly enrollmentId: string;
  readonly status: EnrollmentStatus;
};

// Return payload of a successful status-change call. `alreadyInStatus` is
// `true` when the enrollment is already in the requested status and no
// write is required; `false` when this call advanced the lifecycle field.
export type EnrollmentsSetStatusResponse = {
  readonly enrollmentId: string;
  readonly status: EnrollmentStatus;
  readonly alreadyInStatus: boolean;
};

const ENROLLMENT_ID_PATTERN =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,254}[a-zA-Z0-9])?$/;

// Allowed status transitions per Data Model §3.4 lifecycle enumeration.
// `active` may transition to `transferred`, `withdrawn`, or `archived`.
// `transferred` and `withdrawn` may only advance to the terminal `archived`
// state so historical enrollments do not accidentally re-enter the roster.
// `archived` is terminal and cannot transition further.
const ALLOWED_TRANSITIONS: Readonly<
  Record<EnrollmentStatus, readonly EnrollmentStatus[]>
> = {
  active: ["transferred", "withdrawn", "archived"],
  transferred: ["archived"],
  withdrawn: ["archived"],
  archived: [],
};

const VALID_STATUSES: readonly EnrollmentStatus[] = [
  "active",
  "transferred",
  "withdrawn",
  "archived",
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

function validateRequest(data: unknown): EnrollmentsSetStatusRequest {
  if (data === null || typeof data !== "object") {
    throw new PlatformError(
      "enrollments.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;

  if (!isNonEmptyString(payload.enrollmentId)) {
    throw new PlatformError(
      "enrollments.invalidEnrollmentId",
      "enrollmentId must be a non-empty string.",
    );
  }
  const enrollmentId = payload.enrollmentId.trim();
  if (!ENROLLMENT_ID_PATTERN.test(enrollmentId)) {
    throw new PlatformError(
      "enrollments.invalidEnrollmentId",
      "enrollmentId must be a URL-safe token.",
    );
  }

  if (
    typeof payload.status !== "string" ||
    !(VALID_STATUSES as readonly string[]).includes(payload.status)
  ) {
    throw new PlatformError(
      "enrollments.invalidStatus",
      `status must be one of: ${VALID_STATUSES.join(", ")}.`,
    );
  }

  return { enrollmentId, status: payload.status as EnrollmentStatus };
}

async function loadEnrollment(
  enrollmentId: string,
): Promise<EnrollmentRecord> {
  const snapshot = await enrollmentDocRef(enrollmentId).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "enrollments.notFound",
      "Enrollment was not found.",
    );
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError(
      "enrollments.notFound",
      "Enrollment record was empty.",
    );
  }
  return data;
}

async function loadClass(classId: string): Promise<ClassRecord> {
  const snapshot = await classDocRef(classId).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "enrollments.classNotFound",
      "Referenced class was not found.",
    );
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError(
      "enrollments.classNotFound",
      "Referenced class record was empty.",
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

// enrollmentsSetStatus
//
// Canonical status transition for enrollments/{enrollmentId} per Data Model
// §3.4 lifecycle and Security Model §4.4. Callable by the teacher of the
// referenced class only. Ownership is enforced by loading the enrollment
// and its parent class record and comparing the class's `teacherId` to the
// authenticated caller and the class's `schoolId` to the caller's canonical
// `schoolId` claim. This prevents a cross-teacher or cross-school status
// transition even when the caller knows the enrollment ID.
//
// Every side effect flows through the canonical shared helpers:
//   - enrollment read via `enrollmentDocRef(...).get()`           (typed ref)
//   - class read via `classDocRef(...).get()`                     (typed ref)
//   - narrow status write via `enrollmentStatusChangeDocRef(...).update(...)`
//                                                                 (typed ref)
//   - audit event via `writeAuditEvent({...})`                    (§5 helper)
//
// Idempotency: an enrollment already in the requested status returns
// `alreadyInStatus: true` with no second write and no second audit event.
// Disallowed transitions (per the §3.4 lifecycle table below) are rejected
// with `enrollments.invalidTransition` and never emit an audit event.
async function enrollmentsSetStatusHandler(
  request: CallableRequest<unknown>,
): Promise<EnrollmentsSetStatusResponse> {
  const actor = await assertActiveTeacherInDistrict(request);
  const input = validateRequest(request.data);

  const enrollment = await loadEnrollment(input.enrollmentId);
  const classRecord = await loadClass(enrollment.classId);

  if (
    classRecord.teacherId !== actor.uid ||
    classRecord.schoolId !== actor.schoolId ||
    enrollment.schoolId !== actor.schoolId
  ) {
    throw new PlatformError(
      "enrollments.forbidden",
      "Caller does not own the class this enrollment belongs to.",
    );
  }

  if (enrollment.status === input.status) {
    safeLog(() =>
      log.info("enrollments.setStatusIdempotent", {
        actorUserId: actor.uid,
        enrollmentId: input.enrollmentId,
        status: input.status,
      }),
    );
    return {
      enrollmentId: input.enrollmentId,
      status: input.status,
      alreadyInStatus: true,
    };
  }

  const allowed = ALLOWED_TRANSITIONS[enrollment.status];
  if (!allowed.includes(input.status)) {
    throw new PlatformError(
      "enrollments.invalidTransition",
      `Cannot transition from "${enrollment.status}" to "${input.status}".`,
    );
  }

  // Exit timestamp policy per §3.4: stamp `exitedAt` on transitions to
  // `transferred` or `withdrawn`, and on the terminal `archived` state
  // when it is reached directly from `active`. Not stamped when `archived`
  // is reached from an already-exited state because a canonical exit
  // timestamp is already present on the record.
  const stampsExitedAt =
    input.status === "transferred" ||
    input.status === "withdrawn" ||
    (input.status === "archived" && enrollment.status === "active");

  const write: EnrollmentStatusChangeWrite = {
    status: input.status,
    ...(stampsExitedAt ? { exitedAt: FieldValue.serverTimestamp() } : {}),
  };

  await enrollmentStatusChangeDocRef(input.enrollmentId).update(write);

  await writeAuditEvent({
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "enrollments.statusChanged",
    targetType: "enrollment",
    targetId: input.enrollmentId,
    schoolId: actor.schoolId,
    payload: {
      classId: enrollment.classId,
      studentId: enrollment.studentId,
      previousStatus: enrollment.status,
      status: input.status,
    },
  });

  safeLog(() =>
    log.info("enrollments.statusChanged", {
      actorUserId: actor.uid,
      enrollmentId: input.enrollmentId,
      status: input.status,
    }),
  );

  return {
    enrollmentId: input.enrollmentId,
    status: input.status,
    alreadyInStatus: false,
  };
}

export const enrollmentsSetStatus = platformCallable(enrollmentsSetStatusHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __enrollmentsSetStatusHandler = enrollmentsSetStatusHandler;
