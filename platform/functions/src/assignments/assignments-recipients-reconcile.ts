import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  assignmentDocRef,
  classDocRef,
  log,
  requireDistrictContext,
  writeAuditEvent,
  type AssignmentRecord,
  type ClassRecord,
} from "../shared";

import {
  reconcileAssignmentRecipients,
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
// predicate `loadInitialRecipientPopulation` already applies. The
// enrollment diff and idempotent ensure-write loop are no longer inline in
// this file: Historical Assignment Resolution, Implementation Slice 6
// extracted them into the shared `reconcileAssignmentRecipients` engine in
// `./assignment-recipients`, so this callable's own responsibility is now
// exactly: authenticate, authorize, load and validate the assignment/class,
// build the authoritative `RecipientOwnershipContext`, invoke the engine
// with `source: "teacherReconcile"`, and emit this callable's own audit
// event from the result. The extraction changed no external behavior; see
// `reconcileAssignmentRecipients`'s own doc comment for the exact
// partial-success/concurrency semantics it preserves unchanged.

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

  const context: RecipientOwnershipContext = {
    assignmentId: input.assignmentId,
    classId: assignment.classId,
    teacherId: assignment.teacherId,
    schoolId: assignment.schoolId,
    districtId: actor.districtId,
    assignedBy: actor.uid,
  };

  // Historical Assignment Resolution, Implementation Slice 6. The
  // enrollment-diff + ensure-write loop that used to live inline here is
  // now the shared `reconcileAssignmentRecipients` engine in
  // `./assignment-recipients`, reused unmodified by this callable and,
  // starting in a later slice, by the Current-aware reconciliation
  // callable as well. Every authorization/ownership/status check above
  // this line is completely unchanged and still lives in THIS handler, not
  // in the engine - the engine trusts `context` exactly as
  // `ensureAssignmentRecipient` already did before this extraction.
  const { added, alreadyCurrent } = await reconcileAssignmentRecipients(
    context,
    "teacherReconcile",
  );

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
