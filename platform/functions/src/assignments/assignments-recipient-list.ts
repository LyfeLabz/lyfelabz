import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  assignmentDocRef,
  assignmentRecipientsCollectionRef,
  log,
  requireDistrictContext,
  type AssignmentRecipientRecord,
  type AssignmentRecord,
} from "../shared";
import { createRosterDisplayNameResolver } from "../enrollments/resolve-roster-display-name";

// Sprint 15 Slice 5: certified enumeration of the frozen recipient
// population for one owned assignment. Authorization mirrors
// `assessmentAssignmentSummary`: active-teacher role, owning teacher,
// same school, district boundary via `requireDistrictContext`.
//
// This callable is intentionally not an aggregate analytics surface. It
// returns the recipient population that PDR-029o already authorizes for
// the owning teacher, and it never surfaces attempt data, session data,
// scores, or answer information. Client-side composition of the
// dashboard roster grouping (`Submitted`, `In progress`, `Not started`)
// is done by the Assignment Detail surface using this recipient roster
// alongside the certified `assessmentAttemptsListForClass` and
// `assessmentAssignmentSummary` seams.

export type AssignmentsRecipientListRequest = {
  readonly assignmentId: string;
};

export type AssignmentsRecipientListItem = {
  readonly studentId: string;
  readonly studentDisplayName: string;
};

export type AssignmentsRecipientListResponse = {
  readonly assignmentId: string;
  readonly recipients: readonly AssignmentsRecipientListItem[];
};

const ASSIGNMENT_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;

const FORBIDDEN_REQUEST_KEYS: readonly string[] = [
  "studentId",
  "uid",
  "userId",
  "districtId",
  "schoolId",
  "teacherId",
  "classId",
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

function validateRequest(data: unknown): AssignmentsRecipientListRequest {
  if (data === null || typeof data !== "object") {
    throw new PlatformError(
      "assignments.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;
  for (const key of FORBIDDEN_REQUEST_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      throw new PlatformError(
        "assignments.invalidRequest",
        `Request payload must not include ${key}.`,
      );
    }
  }
  if (!isNonEmptyString(payload.assignmentId)) {
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
  return { assignmentId };
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

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

async function assignmentsRecipientListHandler(
  request: CallableRequest<unknown>,
): Promise<AssignmentsRecipientListResponse> {
  const actor = await assertActiveTeacherInDistrict(request);
  const input = validateRequest(request.data);

  const existing = await loadAssignment(input.assignmentId);

  if (
    existing.teacherId !== actor.uid ||
    existing.schoolId !== actor.schoolId
  ) {
    throw new PlatformError(
      "assignments.forbidden",
      "Caller does not own this assignment.",
    );
  }

  const snapshot = await assignmentRecipientsCollectionRef(
    input.assignmentId,
  ).get();

  const admitted: AssignmentRecipientRecord[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!data) continue;
    if (data.assignmentId !== input.assignmentId) continue;
    if (data.schoolId !== actor.schoolId) continue;
    if (data.districtId !== actor.districtId) continue;
    if (data.status !== "assigned") continue;
    if (!isNonEmptyString(data.studentId)) continue;
    admitted.push(data);
  }

  const resolveDisplayName = createRosterDisplayNameResolver({
    classId: existing.classId,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
  });

  const seen = new Set<string>();
  const recipients: AssignmentsRecipientListItem[] = [];
  for (const data of admitted) {
    if (seen.has(data.studentId)) continue;
    seen.add(data.studentId);
    const resolved = await resolveDisplayName(data.studentId);
    recipients.push({
      studentId: data.studentId,
      studentDisplayName: resolved.displayName,
    });
  }

  recipients.sort((a, b) => {
    const byName = a.studentDisplayName.localeCompare(
      b.studentDisplayName,
      undefined,
      { sensitivity: "base" },
    );
    if (byName !== 0) return byName;
    return a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0;
  });

  safeLog(() =>
    log.info("assignments.recipientList", {
      actorUserId: actor.uid,
      assignmentId: input.assignmentId,
      count: recipients.length,
    }),
  );

  return { assignmentId: input.assignmentId, recipients };
}

export const assignmentsRecipientList = platformCallable(
  assignmentsRecipientListHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assignmentsRecipientListHandler =
  assignmentsRecipientListHandler;
