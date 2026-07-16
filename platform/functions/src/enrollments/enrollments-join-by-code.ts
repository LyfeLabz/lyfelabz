import { FieldValue } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  classesCollectionRef,
  enrollmentCreationDocRef,
  enrollmentDocRef,
  log,
  requireDistrictContext,
  writeAuditEvent,
  type ClassRecord,
  type EnrollmentCreationWrite,
} from "../shared";

// Client-supplied request payload for enrollmentsJoinByCode. A student
// authenticates and submits a join code the teacher has shared with the
// class. Ownership fields are never carried on the request: studentId is
// derived from the authenticated caller, and classId/schoolId are resolved
// server-side from the class record the join code matches.
export type EnrollmentsJoinByCodeRequest = {
  readonly joinCode: string;
  readonly displayNameOverride?: string;
};

// Return payload of a successful join call. `alreadyEnrolled` is `true`
// when the call is a no-op idempotent replay of a previously successful
// active enrollment for this (student, class) pair, and `false` when this
// call wrote the canonical enrollments/{enrollmentId} document.
export type EnrollmentsJoinByCodeResponse = {
  readonly enrollmentId: string;
  readonly classId: string;
  readonly alreadyEnrolled: boolean;
};

// Join codes are 8 uppercase hex characters per the classesCreate generator
// in Sprint 4B. The pattern is intentionally strict so a client cannot
// probe the class collection with wildcard values.
const JOIN_CODE_PATTERN = /^[A-F0-9]{8}$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function assertActiveStudentInDistrict(
  request: CallableRequest<unknown>,
): Promise<{ readonly uid: string; readonly schoolId: string; readonly districtId: string }> {
  const context = await requireDistrictContext(request);
  if (context.role !== "student") {
    throw new PlatformError(
      "role-forbidden",
      "Caller must be an active student.",
    );
  }
  return { uid: context.uid, schoolId: context.schoolId, districtId: context.districtId };
}

function validateRequest(data: unknown): EnrollmentsJoinByCodeRequest {
  if (data === null || typeof data !== "object") {
    throw new PlatformError(
      "enrollments.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;

  if (!isNonEmptyString(payload.joinCode)) {
    throw new PlatformError(
      "enrollments.invalidJoinCode",
      "joinCode must be a non-empty string.",
    );
  }
  const joinCode = payload.joinCode.trim().toUpperCase();
  if (!JOIN_CODE_PATTERN.test(joinCode)) {
    throw new PlatformError(
      "enrollments.invalidJoinCode",
      "joinCode must be an eight-character hex token.",
    );
  }

  const out: { joinCode: string; displayNameOverride?: string } = { joinCode };

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

// Deterministic enrollment document ID for the (classId, studentId) pair.
// Enforces the §3.4 uniqueness invariant at the write boundary without a
// transactional query and without a hot document. The composite is not a
// semantic identifier that ever leaks to a user surface; it is an internal
// stability contract, consistent with the archive-and-create ownership
// pattern in §12.3.
export function enrollmentIdFor(classId: string, studentId: string): string {
  return `${classId}__${studentId}`;
}

async function resolveClassByJoinCode(
  joinCode: string,
  schoolId: string,
): Promise<{ readonly classId: string; readonly record: ClassRecord }> {
  const snapshot = await classesCollectionRef()
    .where("joinCode", "==", joinCode)
    .where("schoolId", "==", schoolId)
    .limit(1)
    .get();
  if (snapshot.empty) {
    throw new PlatformError(
      "enrollments.joinCodeNotFound",
      "No active class matches the supplied join code.",
    );
  }
  const doc = snapshot.docs[0];
  const record = doc.data();
  if (record.status !== "active") {
    throw new PlatformError(
      "enrollments.joinCodeNotFound",
      "No active class matches the supplied join code.",
    );
  }
  return { classId: doc.id, record };
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

// enrollmentsJoinByCode
//
// Canonical creation of an enrollments/{enrollmentId} document via student
// self-service, per Data Model §3.4 and Cloud Function Charter §2 ("Join
// code validation").
//
// Callable by an authenticated student whose canonical custom claims
// (`{ role: "student", schoolId }`) were issued by studentsCompleteOnboarding
// in Sprint 2. The class is resolved server-side by (joinCode, schoolId);
// the client never learns which classes exist beyond whether its specific
// request succeeded (Charter §2).
//
// Every side effect flows through the canonical shared helpers:
//   - class lookup via `classesCollectionRef().where(...).get()`
//   - existing-record read via `enrollmentDocRef(enrollmentId).get()`
//   - creation write via `enrollmentCreationDocRef(enrollmentId).set(...)`
//   - audit event via `writeAuditEvent({...})`                   (§5 helper)
//
// Idempotency: an existing active enrollment for this (student, class) pair
// returns `alreadyEnrolled: true` with no second write and no second audit
// event. A prior enrollment in `transferred`, `withdrawn`, or `archived`
// status is rejected with `enrollments.conflict` so re-enrollment cannot
// silently overwrite closed history; teacher-mediated reactivation is the
// documented path.
async function enrollmentsJoinByCodeHandler(
  request: CallableRequest<unknown>,
): Promise<EnrollmentsJoinByCodeResponse> {
  const actor = await assertActiveStudentInDistrict(request);
  const input = validateRequest(request.data);

  const { classId, record: classRecord } = await resolveClassByJoinCode(
    input.joinCode,
    actor.schoolId,
  );

  if (classRecord.schoolId !== actor.schoolId) {
    // Defense in depth: the query already scoped to schoolId, but the
    // record's schoolId is the authoritative field per §1.2 and any
    // mismatch is treated as an ownership violation.
    throw new PlatformError(
      "enrollments.joinCodeNotFound",
      "No active class matches the supplied join code.",
    );
  }

  const id = enrollmentIdFor(classId, actor.uid);
  const existing = await enrollmentDocRef(id).get();
  if (existing.exists) {
    const data = existing.data();
    if (
      data &&
      data.studentId === actor.uid &&
      data.classId === classId &&
      data.schoolId === actor.schoolId &&
      data.status === "active"
    ) {
      safeLog(() =>
        log.info("enrollments.joinIdempotent", {
          actorUserId: actor.uid,
          classId,
        }),
      );
      return { enrollmentId: id, classId, alreadyEnrolled: true };
    }
    throw new PlatformError(
      "enrollments.conflict",
      "An enrollment record already exists for this student and class.",
    );
  }

  const creation: EnrollmentCreationWrite = {
    studentId: actor.uid,
    classId,
    schoolId: actor.schoolId,
    status: "active",
    enrolledAt: FieldValue.serverTimestamp(),
    ...(input.displayNameOverride !== undefined
      ? { displayNameOverride: input.displayNameOverride }
      : {}),
  };

  await enrollmentCreationDocRef(id).set(creation);

  await writeAuditEvent({
    actorUserId: actor.uid,
    actorRole: "student",
    action: "enrollments.created",
    targetType: "enrollment",
    targetId: id,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
    payload: { classId, source: "joinByCode" },
  });

  safeLog(() =>
    log.info("enrollments.created", {
      actorUserId: actor.uid,
      classId,
      enrollmentId: id,
    }),
  );

  return { enrollmentId: id, classId, alreadyEnrolled: false };
}

export const enrollmentsJoinByCode = platformCallable(enrollmentsJoinByCodeHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __enrollmentsJoinByCodeHandler = enrollmentsJoinByCodeHandler;
