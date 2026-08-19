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
import { loadInitialRecipientPopulation } from "./assignment-recipients";

// Sprint 27 Phase 5: certified enumeration of the active-enrolled students
// in an owned, published assignment's frozen class who are NOT yet
// recipients of that assignment. This is the read the teacher-facing
// late-recipient affordance consumes to decide who may be added through the
// certified `assignmentsRecipientAdd` path (PDR-029h `manualAddition`).
//
// This callable is intentionally not a roster-management or analytics
// surface. Authorization mirrors `assignmentsRecipientList`: active-teacher
// role, owning teacher, same school, district boundary via
// `requireDistrictContext`. It projects exactly the same minimum identity
// (studentId + resolved display name) that the recipient list already
// exposes for the owning teacher, and it never surfaces attempt data,
// session data, scores, answer information, provider identity, OAuth data,
// or any LMS roster metadata.
//
// The candidate population is a pure set difference computed server-side:
//   active enrollments in the assignment's frozen class and school
//     MINUS the assignment's current recipient population.
// The enrollment population read reuses the exact certified helper
// (`loadInitialRecipientPopulation`) that first publication uses to freeze
// recipients, so a candidate is, by construction, a student who would have
// been included had publication happened after they enrolled. The frozen
// recipient population is never mutated by this read.
//
// Only a `published` assignment yields candidates. A `draft` has no frozen
// population, and a `closed` or otherwise non-published assignment MUST NOT
// gain recipients (PDR-029j), so those states return an empty candidate list
// rather than an error: there is simply no addable student, and no
// information is leaked by the empty projection.

export type AssignmentsRecipientCandidatesListRequest = {
  readonly assignmentId: string;
};

export type AssignmentsRecipientCandidateItem = {
  readonly studentId: string;
  readonly studentDisplayName: string;
};

export type AssignmentsRecipientCandidatesListResponse = {
  readonly assignmentId: string;
  readonly candidates: readonly AssignmentsRecipientCandidateItem[];
};

const ASSIGNMENT_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;

// Fields the client is not permitted to carry on the request. Every one is
// derived server-side from the assignment, the class, and the caller's
// verified district context; a client that supplies any of them is refused
// so no laundering path can suggest cross-owner access or a spoofed scope.
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

function validateRequest(
  data: unknown,
): AssignmentsRecipientCandidatesListRequest {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
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

// Read the assignment's current recipient population as a set of studentIds.
// The filtering mirrors `assignmentsRecipientList` exactly (assignmentId,
// school, district, and `assigned` status), so the candidate set difference
// is computed against the same admitted population the teacher already sees
// on the roster.
async function loadRecipientStudentIds(
  assignmentId: string,
  schoolId: string,
  districtId: string,
): Promise<ReadonlySet<string>> {
  const snapshot = await assignmentRecipientsCollectionRef(assignmentId).get();
  const ids = new Set<string>();
  for (const doc of snapshot.docs) {
    const data = doc.data() as AssignmentRecipientRecord | undefined;
    if (!data) continue;
    if (data.assignmentId !== assignmentId) continue;
    if (data.schoolId !== schoolId) continue;
    if (data.districtId !== districtId) continue;
    if (data.status !== "assigned") continue;
    if (!isNonEmptyString(data.studentId)) continue;
    ids.add(data.studentId);
  }
  return ids;
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

async function assignmentsRecipientCandidatesListHandler(
  request: CallableRequest<unknown>,
): Promise<AssignmentsRecipientCandidatesListResponse> {
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

  // Only a published assignment has a frozen recipient population that a
  // late add can extend (PDR-029j). Every other lifecycle state has no
  // addable student, so the empty projection is the correct, non-leaking
  // answer.
  if (assignment.status !== "published") {
    return { assignmentId: input.assignmentId, candidates: [] };
  }

  if (!isNonEmptyString(assignment.classId)) {
    throw new PlatformError(
      "assignments.invalidState",
      "Assignment record is missing its class reference.",
    );
  }

  const [enrolledStudentIds, recipientStudentIds] = await Promise.all([
    loadInitialRecipientPopulation(assignment.classId, actor.schoolId),
    loadRecipientStudentIds(
      input.assignmentId,
      actor.schoolId,
      actor.districtId,
    ),
  ]);

  const resolveDisplayName = createRosterDisplayNameResolver({
    classId: assignment.classId,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
  });

  const seen = new Set<string>();
  const candidates: AssignmentsRecipientCandidateItem[] = [];
  for (const studentId of enrolledStudentIds) {
    if (recipientStudentIds.has(studentId)) continue;
    if (seen.has(studentId)) continue;
    seen.add(studentId);
    const resolved = await resolveDisplayName(studentId);
    candidates.push({
      studentId,
      studentDisplayName: resolved.displayName,
    });
  }

  candidates.sort((a, b) => {
    const byName = a.studentDisplayName.localeCompare(
      b.studentDisplayName,
      undefined,
      { sensitivity: "base" },
    );
    if (byName !== 0) return byName;
    return a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0;
  });

  safeLog(() =>
    log.info("assignments.recipientCandidatesList", {
      actorUserId: actor.uid,
      assignmentId: input.assignmentId,
      count: candidates.length,
    }),
  );

  return { assignmentId: input.assignmentId, candidates };
}

export const assignmentsRecipientCandidatesList = platformCallable(
  assignmentsRecipientCandidatesListHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assignmentsRecipientCandidatesListHandler =
  assignmentsRecipientCandidatesListHandler;
