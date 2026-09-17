import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  assignmentDocRef,
  assignmentRecipientsCollectionRef,
  classDocRef,
  enrollmentsCollectionRef,
  log,
  requireDistrictContext,
  writeAuditEvent,
  type AssignmentRecipientRecord,
  type AssignmentRecord,
  type ClassRecord,
  type EnrollmentRecord,
} from "../shared";

import {
  ensureAssignmentRecipient,
  type RecipientOwnershipContext,
} from "./assignment-recipients";

// Student Progress & Assignment Membership, Phase B Core, Slice 2.
//
// assignmentsRecipientsReconcile
//
// The intent-based teacher callable: "bring this assignment's recipients
// up to date with the class's current active enrollment." The caller
// never names a student. Every eligible student is derived server-side
// from the assignment's own frozen `classId`, exactly mirroring the
// population rule `loadInitialRecipientPopulation` already uses for the
// initial recipient snapshot at first publication - this callable answers
// the identical population question, just at a later point in the
// assignment's lifecycle and diffed against whichever recipients already
// exist.
//
// This callable never creates another assignment, never calls
// `assignmentsCreateDraft` / `assignmentsPublish` / `lmsAssignmentsPublish`,
// and never touches `lmsAssignmentPublications` or any Classroom-facing
// state. It only ever adds missing `assignments/{assignmentId}/recipients`
// documents; it never removes or overwrites an existing one.
//
// Authorization mirrors `assignmentsRecipientAdd` (PDR-029j) exactly,
// minus the per-student enrollment check (there is no single target
// student here - eligibility is the whole active roster):
//   1. Caller is authenticated with a district context.
//   2. Caller is an active teacher.
//   3. Assignment exists.
//   4. Assignment's frozen `teacherId` equals caller uid.
//   5. Assignment's frozen `schoolId` equals caller schoolId.
//   6. Assignment lifecycle is `published`. `draft`, `closed`, and
//      `archived` are refused with the same `assignments.invalidTransition`
//      identifier `assignmentsRecipientAdd` already uses, so a client
//      handles both callables' refusal identically.
//   7. Assignment's referenced class exists.
//   8. Class's frozen `teacherId` equals caller uid.
//   9. Class's frozen `schoolId` equals caller schoolId.
//   10. Assignment and class ownership are internally consistent.
//
// Eligible population: every enrollment record whose `classId` equals the
// assignment's frozen `classId`, whose `schoolId` equals the assignment's
// frozen `schoolId`, and whose `status` is `"active"` - the identical
// predicate `loadInitialRecipientPopulation` already applies, reused here
// by direct query rather than by calling that function (this callable
// additionally needs the raw `studentId` set to diff against existing
// recipients, not the already-deduplicated array `loadInitialRecipientPopulation`
// returns, so the predicate is applied locally rather than importing it -
// see the handler below for the exact filter).
//
// Idempotent recipient creation is delegated entirely to the Slice 1
// primitive `ensureAssignmentRecipient`; this callable performs no
// existence-check or write of its own beyond calling it once per missing
// student. See the handler for the exact concurrency/count semantics.

export type AssignmentsRecipientsReconcileRequest = {
  readonly assignmentId: string;
};

export type AssignmentsRecipientsReconcileResponse = {
  readonly assignmentId: string;
  readonly added: number;
  readonly alreadyCurrent: number;
};

const ASSIGNMENT_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;

// Every field a client might otherwise be tempted to supply to influence
// which students are eligible, or to launder a recipient's provenance, is
// refused outright. Eligibility is derived entirely server-side from the
// assignment's own frozen `classId`/`schoolId`; the request accepts
// exactly one field.
const FORBIDDEN_REQUEST_KEYS: readonly string[] = [
  "classId",
  "teacherId",
  "schoolId",
  "districtId",
  "studentId",
  "studentIds",
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

function validateRequest(data: unknown): AssignmentsRecipientsReconcileRequest {
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

// Identical active-enrollment predicate to `loadInitialRecipientPopulation`
// (assignment-recipients.ts), applied locally because this callable needs
// the raw filtered `studentId` set (to diff against existing recipients),
// not that function's already-deduplicated, already-sorted return array.
async function loadActiveEnrolledStudentIds(
  classId: string,
  schoolId: string,
): Promise<ReadonlySet<string>> {
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
  return seen;
}

// Existing canonical recipients for the assignment, defensively filtered
// exactly as `assessmentAssignmentSummary`'s population read already is:
// the recipient doc id must equal its own `studentId` field, and every
// ownership field must match the assignment/class/actor context. A
// malformed or cross-scope row is silently dropped rather than amplified,
// consistent with the defense-in-depth pattern used throughout this
// domain.
async function loadExistingRecipientStudentIds(
  assignmentId: string,
  classId: string,
  actor: { readonly schoolId: string; readonly districtId: string },
  assignment: { readonly teacherId: string; readonly schoolId: string },
): Promise<ReadonlySet<string>> {
  const snapshot = await assignmentRecipientsCollectionRef(assignmentId).get();
  const seen = new Set<string>();
  for (const doc of snapshot.docs) {
    const data = doc.data() as AssignmentRecipientRecord | undefined;
    if (!data) continue;
    if (doc.id !== data.studentId) continue;
    if (data.assignmentId !== assignmentId) continue;
    if (data.classId !== classId) continue;
    if (data.teacherId !== assignment.teacherId) continue;
    if (data.schoolId !== assignment.schoolId) continue;
    if (data.schoolId !== actor.schoolId) continue;
    if (data.districtId !== actor.districtId) continue;
    if (data.status !== "assigned") continue;
    if (!isNonEmptyString(data.studentId)) continue;
    seen.add(data.studentId);
  }
  return seen;
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

async function assignmentsRecipientsReconcileHandler(
  request: CallableRequest<unknown>,
): Promise<AssignmentsRecipientsReconcileResponse> {
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
      `Recipients may only be reconciled for a published assignment; current status is "${assignment.status}".`,
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

  const [activeEnrolledStudentIds, existingRecipientStudentIds] =
    await Promise.all([
      loadActiveEnrolledStudentIds(assignment.classId, assignment.schoolId),
      loadExistingRecipientStudentIds(
        input.assignmentId,
        assignment.classId,
        actor,
        assignment,
      ),
    ]);

  const missing = Array.from(activeEnrolledStudentIds).filter(
    (studentId) => !existingRecipientStudentIds.has(studentId),
  );

  const context: RecipientOwnershipContext = {
    assignmentId: input.assignmentId,
    classId: assignment.classId,
    teacherId: assignment.teacherId,
    schoolId: assignment.schoolId,
    districtId: actor.districtId,
    assignedBy: actor.uid,
  };

  // Concurrency note: each `ensureAssignmentRecipient` call independently
  // re-checks existence immediately before writing (Slice 1's own
  // idempotency guarantee), so a concurrent reconcile (or a concurrent
  // `assignmentsRecipientAdd`) racing on the same student can never result
  // in two documents at the same (assignmentId, studentId) path - the
  // recipient document id is deterministic, so "duplicate" is structurally
  // impossible regardless of timing. `added` below counts only the
  // students THIS invocation's own calls actually created; a student
  // found already-missing in this call's initial snapshot but created by
  // a concurrent caller a moment before this call's own write reads back
  // as `added: false` from `ensureAssignmentRecipient` and is correctly
  // folded into `alreadyCurrent`, not double-counted as newly added by
  // both callers.
  const results = await Promise.all(
    missing.map((studentId) =>
      ensureAssignmentRecipient(context, studentId, "teacherReconcile"),
    ),
  );
  const added = results.filter((r) => r.added).length;
  const alreadyCurrent = activeEnrolledStudentIds.size - added;

  // A reconciliation-level audit event, deliberately distinct from
  // `assignments.recipientAdded` (which means "a teacher clicked Add for
  // this one named student"). This event never names a student; it
  // carries only the aggregate counts a teacher-initiated bulk intent
  // action warrants, consistent with `assignmentsRecipientAdd`'s own
  // audit shape but scoped to what is true of this callable specifically.
  await writeAuditEvent({
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "assignments.recipientsReconciled",
    targetType: "assignment",
    targetId: input.assignmentId,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
    payload: {
      assignmentId: input.assignmentId,
      classId: assignment.classId,
      added,
      alreadyCurrent,
    },
  });

  safeLog(() =>
    log.info("assignments.recipientsReconciled", {
      actorUserId: actor.uid,
      assignmentId: input.assignmentId,
      added,
      alreadyCurrent,
    }),
  );

  return {
    assignmentId: input.assignmentId,
    added,
    alreadyCurrent,
  };
}

export const assignmentsRecipientsReconcile = platformCallable(
  assignmentsRecipientsReconcileHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assignmentsRecipientsReconcileHandler =
  assignmentsRecipientsReconcileHandler;
