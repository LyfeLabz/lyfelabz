import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  classDocRef,
  enrollmentsCollectionRef,
  log,
  requireDistrictContext,
  type EnrollmentRecord,
} from "../shared";
import { createRosterDisplayNameResolver } from "./resolve-roster-display-name";

// Sprint 29G.5P (Sprint 29 closeout) - teacher Students-tab roster read.
//
// Certified enumeration of the ACTIVE canonical LyfeLabz enrollments in an
// owned class, projected as the minimum teacher-visible identity
// (`studentId` + resolved display name). This is the read the teacher
// Students tab consumes so it shows the real enrolled students instead of a
// permanent placeholder.
//
// This callable is intentionally NOT a roster-management or analytics
// surface, and it is deliberately NOT sourced from `lmsRosterMemberships`
// (which is a PII-free Classroom-membership cache that can include people
// who have not activated LyfeLabz). It represents actual active canonical
// enrollments only.
//
// Authorization mirrors `assignmentsRecipientCandidatesList`: active-teacher
// role, owning teacher, same school, district boundary via
// `requireDistrictContext`. The population read reuses the same active-only
// enrollment predicate that first publication freezes recipients with, and
// the display name is resolved exclusively through the certified
// `createRosterDisplayNameResolver` (enrollment override -> user profile ->
// "Name unavailable"), so no second identity-resolution policy is invented
// and no provider identity, OAuth data, identity hash, email, or LMS roster
// metadata is ever projected.

export type EnrollmentsListForClassRequest = {
  readonly classId: string;
};

export type EnrollmentsListForClassStudent = {
  readonly studentId: string;
  readonly studentDisplayName: string;
};

export type EnrollmentsListForClassResponse = {
  readonly classId: string;
  readonly students: readonly EnrollmentsListForClassStudent[];
};

const CLASS_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;

// Every one of these is derived server-side from the class record and the
// caller's verified district context; a client that supplies any of them is
// refused so no laundering path can suggest cross-owner access or a spoofed
// scope.
const FORBIDDEN_REQUEST_KEYS: readonly string[] = [
  "studentId",
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

function validateRequest(data: unknown): EnrollmentsListForClassRequest {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new PlatformError(
      "enrollments.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;
  for (const key of FORBIDDEN_REQUEST_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      throw new PlatformError(
        "enrollments.invalidRequest",
        `Request payload must not include ${key}.`,
      );
    }
  }
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
  return { classId };
}

// Load the target class and enforce ownership. The caller must be the class's
// teacher and in the same school; district agreement is already established by
// `requireDistrictContext`. Ownership failure and a missing class both surface
// as the same non-leaking forbidden result.
async function loadOwnedClassSchoolId(
  classId: string,
  actor: { readonly uid: string; readonly schoolId: string },
): Promise<void> {
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
}

// Active-only canonical enrollment population for the class, deduplicated and
// sorted. Mirrors the certified `loadInitialRecipientPopulation` predicate
// (classId + schoolId match + status active + non-empty studentId) without
// importing the assignments domain, so a malformed or cross-scope row can
// never enter the projection.
async function loadActiveEnrolledStudentIds(
  classId: string,
  schoolId: string,
): Promise<readonly string[]> {
  const snapshot = await enrollmentsCollectionRef()
    .where("classId", "==", classId)
    .get();
  const seen = new Set<string>();
  for (const doc of snapshot.docs) {
    const data = doc.data() as EnrollmentRecord | undefined;
    if (!data) continue;
    if (data.classId !== classId) continue;
    if (data.schoolId !== schoolId) continue;
    if (data.status !== "active") continue;
    if (!isNonEmptyString(data.studentId)) continue;
    seen.add(data.studentId);
  }
  return Array.from(seen).sort();
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

async function enrollmentsListForClassHandler(
  request: CallableRequest<unknown>,
): Promise<EnrollmentsListForClassResponse> {
  const actor = await assertActiveTeacherInDistrict(request);
  const input = validateRequest(request.data);

  await loadOwnedClassSchoolId(input.classId, actor);

  const enrolledStudentIds = await loadActiveEnrolledStudentIds(
    input.classId,
    actor.schoolId,
  );

  const resolveDisplayName = createRosterDisplayNameResolver({
    classId: input.classId,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
  });

  const students: EnrollmentsListForClassStudent[] = [];
  for (const studentId of enrolledStudentIds) {
    const resolved = await resolveDisplayName(studentId);
    students.push({ studentId, studentDisplayName: resolved.displayName });
  }

  students.sort((a, b) => {
    const byName = a.studentDisplayName.localeCompare(
      b.studentDisplayName,
      undefined,
      { sensitivity: "base" },
    );
    if (byName !== 0) return byName;
    return a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0;
  });

  safeLog(() =>
    log.info("enrollments.listForClass", {
      actorUserId: actor.uid,
      classId: input.classId,
      count: students.length,
    }),
  );

  return { classId: input.classId, students };
}

export const enrollmentsListForClass = platformCallable(
  enrollmentsListForClassHandler,
);

// Test-only export of the raw handler so unit tests can drive it with fakes
// (mirrors `__assignmentsRecipientCandidatesListHandler`).
export const __enrollmentsListForClassHandler = enrollmentsListForClassHandler;
