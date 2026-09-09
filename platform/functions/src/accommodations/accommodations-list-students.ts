import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  classDocRef,
  enrollmentsCollectionRef,
  log,
  requireDistrictContext,
  type ClassRecord,
  type EnrollmentRecord,
} from "../shared";
import { createRosterDisplayNameResolver } from "../enrollments/resolve-roster-display-name";

// Slice 7 teacher retrieval surface per F5.2 §14.
// Returns the authorized student identity list for exactly one class owned by
// the authenticated teacher. Authorization mirrors assessmentAttemptsListForClass;
// output shape mirrors assignmentsRecipientList.
//
// Responsibility boundary: student identity only. Current Reading Accessibility
// state for a selected student is loaded separately via accommodationsGet (CAS
// token required for accommodationsSet). The list surface does not read or
// return studentAccommodations documents.

export type AccommodationsListStudentsRequest = {
  readonly classId: string;
};

export type StudentListEntry = {
  readonly studentId: string;
  readonly studentDisplayName: string;
};

export type AccommodationsListStudentsResponse = {
  readonly classId: string;
  readonly students: readonly StudentListEntry[];
};

const FORBIDDEN_REQUEST_KEYS: readonly string[] = [
  "studentId",
  "uid",
  "userId",
  "districtId",
  "schoolId",
  "teacherId",
];

const CLASS_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateRequest(
  data: unknown,
): AccommodationsListStudentsRequest {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new PlatformError(
      "accommodations.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;
  for (const key of FORBIDDEN_REQUEST_KEYS) {
    if (key in payload) {
      throw new PlatformError(
        "accommodations.invalidRequest",
        `Field "${key}" is not permitted on the request.`,
      );
    }
  }
  if (!("classId" in payload) || !isNonEmptyString(payload.classId)) {
    throw new PlatformError(
      "accommodations.invalidClassId",
      "classId must be a non-empty string.",
    );
  }
  const classId = payload.classId.trim();
  if (!CLASS_ID_PATTERN.test(classId)) {
    throw new PlatformError(
      "accommodations.invalidClassId",
      "classId must be a URL-safe token (letters, digits, hyphens, underscores).",
    );
  }
  return { classId };
}

async function loadClass(classId: string): Promise<ClassRecord> {
  const snapshot = await classDocRef(classId).get();
  if (!snapshot.exists) {
    throw new PlatformError("classes.notFound", "Class was not found.");
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError("classes.notFound", "Class record was empty.");
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

// accommodationsListStudents
//
// Returns {classId, students} where each entry is {studentId, studentDisplayName}.
// No accommodation state is read or returned here; the caller uses
// accommodationsGet when a student is selected to load the current
// configRevision and ReadingAccessibilityConfig needed for the detail view and
// for the CAS token required by accommodationsSet.
//
// Authorization:
//   1. requireDistrictContext verifies auth, active status, and role=teacher.
//   2. classId validated (shape + forbidden keys).
//   3. classDocRef load; teacherId/schoolId ownership verified.
//   4. Enrollment query + defense-in-depth filter.
async function accommodationsListStudentsHandler(
  request: CallableRequest<unknown>,
): Promise<AccommodationsListStudentsResponse> {
  const context = await requireDistrictContext(request);
  if (context.role !== "teacher") {
    throw new PlatformError(
      "role-forbidden",
      "Caller must be an active teacher.",
    );
  }
  const actor = {
    uid: context.uid,
    schoolId: context.schoolId,
    districtId: context.districtId,
  };

  const input = validateRequest(request.data);

  const existing = await loadClass(input.classId);

  if (
    existing.teacherId !== actor.uid ||
    existing.schoolId !== actor.schoolId
  ) {
    throw new PlatformError(
      "classes.forbidden",
      "Caller does not own this class.",
    );
  }

  const enrollmentSnapshot = await enrollmentsCollectionRef()
    .where("classId", "==", input.classId)
    .where("status", "==", "active")
    .get();

  const admittedStudentIds = new Set<string>();
  for (const doc of enrollmentSnapshot.docs) {
    const data = doc.data() as EnrollmentRecord | undefined;
    if (!data) continue;
    if (data.classId !== input.classId) continue;
    if (data.schoolId !== actor.schoolId) continue;
    if (data.status !== "active") continue;
    if (!isNonEmptyString(data.studentId)) continue;
    admittedStudentIds.add(data.studentId);
  }

  const resolveDisplayName = createRosterDisplayNameResolver({
    classId: input.classId,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
  });

  const students: StudentListEntry[] = await Promise.all(
    Array.from(admittedStudentIds).map(async (studentId) => {
      const resolved = await resolveDisplayName(studentId);
      return { studentId, studentDisplayName: resolved.displayName };
    }),
  );

  students.sort((a, b) =>
    a.studentDisplayName.localeCompare(b.studentDisplayName),
  );

  safeLog(() =>
    log.info("accommodations.listedStudentsForClass", {
      actorUserId: actor.uid,
      classId: input.classId,
      count: students.length,
    }),
  );

  return { classId: input.classId, students };
}

export const accommodationsListStudents = platformCallable(
  accommodationsListStudentsHandler,
);

export const __accommodationsListStudentsHandler =
  accommodationsListStudentsHandler;
