import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  classDocRef,
  log,
  requireDistrictContext,
  writeAuditEvent,
  type ClassRecord,
} from "../shared";

import {
  reconcileAssignmentRecipients,
  type RecipientOwnershipContext,
} from "./assignment-recipients";
import { requireValidCurrentAssignmentId } from "./resolve-current-assignment";

// Historical Assignment Resolution, Implementation Slice 7.
//
// assignmentsCurrentRecipientsReconcile
//
// The Current-aware sibling of `assignmentsRecipientsReconcile`. Where that
// callable requires the client to name an exact `assignmentId`, this one
// accepts only `{classId, lessonSlug}` and resolves the assignment to
// reconcile ENTIRELY server-side, from live authoritative Current, during
// this invocation. This is the callable Curriculum's normal "Update
// Assignment" flow will call once wired in a later slice (Slice 10); it
// exists specifically to close the stale-tab hole a client-supplied
// assignmentId would otherwise leave open: a browser tab that once observed
// Current = X has no way to make this callable reconcile X once Current has
// moved on to Y, because X is never a value this callable's request shape
// can carry.
//
// This callable performs NO Current pointer write of any kind - no CAS, no
// `assignmentsCurrentSet` call, no pointer mutation. It only reads/resolves
// live Current (via the Slice 3 strict resolver) and then reconciles
// recipients for whatever assignment that resolution names, via the Slice 6
// shared engine. `assignmentsRecipientsReconcile` itself is completely
// unmodified by this slice and remains available for any future,
// explicitly-authorized historical action that legitimately names an old
// assignmentId on purpose - "Current" and "an assignment the caller
// explicitly named" are two different product intents with two different
// callables, exactly as the architecture requires.
//
// Authorization chain (in order):
//   1. `requireDistrictContext` + active-teacher role check.
//   2. Request-shape validation: exactly `{classId, lessonSlug}`, nothing
//      else. `assignmentId`, `currentAssignmentId`, `expectedAssignmentId`,
//      `candidateAssignmentId`, `studentIds`, `teacherId`, `schoolId`, and
//      `districtId` are all rejected by the allowlist below, not merely
//      ignored - a client cannot smuggle in an assignment-selection field
//      of any name.
//   3. Load the live class and require exact ownership
//      (`teacherId`/`schoolId` match the actor). This happens BEFORE Current
//      is ever resolved and never depends on Current for its own
//      correctness - the Current pointer is never used as authority for
//      class ownership.
//   4. Resolve live Current via `requireValidCurrentAssignmentId`, passing
//      the now-authorized `classId`/`lessonSlug` and the verified actor
//      scope. This independently re-validates that the live pointer AND its
//      referenced assignment are well-formed and scoped to this exact
//      class/lesson/teacher/school, and that the assignment is currently
//      `published` - see `./resolve-current-assignment.ts` for the full
//      validation chain. Any non-"valid" resolution (absent, malformed,
//      cross-scope, references a missing or non-published assignment)
//      throws the canonical `assignments.currentNotResolved` refusal and
//      this callable performs NO further work: no engine call, no audit.
//   5. Construct `RecipientOwnershipContext` from already-verified values
//      (`input.classId`, `actor.uid`, `actor.schoolId`, `actor.districtId`)
//      and the resolved `assignmentId` - no second read of the assignment
//      record. This is safe, not a shortcut: `requireValidCurrentAssignmentId`
//      already independently proved `assignment.classId === input.classId`,
//      `assignment.teacherId === actor.uid`, and `assignment.schoolId ===
//      actor.schoolId` as part of returning a "valid" resolution, so these
//      values are already known-equal to the assignment's own frozen
//      fields by the time this line runs - re-reading the assignment here
//      would prove nothing the resolver has not already proven.
//   6. Invoke the unmodified Slice 6 engine, `reconcileAssignmentRecipients`,
//      with `source: "teacherReconcile"` - the identical source value the
//      explicit-assignmentId callable already uses, because this is the
//      same category of teacher-initiated bulk reconciliation intent, just
//      reached through Current resolution instead of a named id.
//   7. Audit exactly once, only on success, reusing the existing
//      `assignments.recipientsReconciled` action (no new audit vocabulary
//      entry) with an aggregate-only payload.
//
// Concurrency note (server-side Current-change race): resolution (step 4)
// and reconciliation (step 6) are two separate, sequential operations, not
// one atomic unit - there is no transaction or lock spanning both. If some
// other operation (a concurrent `assignmentsCurrentSet` call, or a
// concurrent `assignmentsPublish` advancing Current for a brand-new
// occurrence) changes Current between this callable's resolution step and
// the completion of its reconciliation step, this invocation still
// completes reconciliation against the assignment that WAS live Current at
// the moment it resolved - it does not retry, re-resolve, or abort merely
// because Current moved on a moment later. This is not a security or
// correctness defect: the resolved assignment was genuinely, verifiably
// Current at resolution time, reconciling its recipients is never invalid
// for that assignment, and the callable never uses anything but that one
// server-resolved value for the rest of its own execution. The specific,
// narrower property this callable exists to guarantee - and does guarantee
// unconditionally - is that the assignmentId reconciled is always resolved
// from live, authoritative Current during THIS invocation, never supplied
// or pinned by a stale client value. It makes no stronger claim than that.

export type AssignmentsCurrentRecipientsReconcileRequest = {
  readonly classId: string;
  readonly lessonSlug: string;
};

export type AssignmentsCurrentRecipientsReconcileResponse = {
  readonly classId: string;
  readonly lessonSlug: string;
  readonly assignmentId: string;
  readonly added: number;
  readonly alreadyCurrent: number;
};

const CLASS_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;
const LESSON_SLUG_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,126}[A-Za-z0-9])?$/;

// Exactly these two keys are ever accepted. Every assignment-selection or
// scope field a client might otherwise supply - `assignmentId`,
// `currentAssignmentId`, `expectedAssignmentId`, `candidateAssignmentId`,
// `studentIds`, `teacherId`, `schoolId`, `districtId`, or anything else - is
// rejected outright by this allowlist, not merely ignored.
const ALLOWED_REQUEST_KEYS: ReadonlySet<string> = new Set([
  "classId",
  "lessonSlug",
]);

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

function validateRequest(
  data: unknown,
): AssignmentsCurrentRecipientsReconcileRequest {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new PlatformError(
      "assignments.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;

  for (const key of Object.keys(payload)) {
    if (!ALLOWED_REQUEST_KEYS.has(key)) {
      throw new PlatformError(
        "assignments.invalidRequest",
        `Field "${key}" is not permitted on the request.`,
      );
    }
  }

  if (!isNonEmptyString(payload.classId)) {
    throw new PlatformError(
      "assignments.invalidClassId",
      "classId must be a non-empty string.",
    );
  }
  const classId = payload.classId.trim();
  if (!CLASS_ID_PATTERN.test(classId)) {
    throw new PlatformError(
      "assignments.invalidClassId",
      "classId must be a URL-safe token.",
    );
  }

  if (!isNonEmptyString(payload.lessonSlug)) {
    throw new PlatformError(
      "assignments.invalidLessonSlug",
      "lessonSlug must be a non-empty string.",
    );
  }
  const lessonSlug = payload.lessonSlug.trim();
  if (!LESSON_SLUG_PATTERN.test(lessonSlug)) {
    throw new PlatformError(
      "assignments.invalidLessonSlug",
      "lessonSlug must be a URL-safe token.",
    );
  }

  return { classId, lessonSlug };
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

async function assignmentsCurrentRecipientsReconcileHandler(
  request: CallableRequest<unknown>,
): Promise<AssignmentsCurrentRecipientsReconcileResponse> {
  const actor = await assertActiveTeacherInDistrict(request);
  const input = validateRequest(request.data);

  const classRecord = await loadClass(input.classId);
  if (
    classRecord.teacherId !== actor.uid ||
    classRecord.schoolId !== actor.schoolId
  ) {
    throw new PlatformError(
      "classes.forbidden",
      "Caller does not own this class.",
    );
  }

  // Live Current resolution, server-side, during this invocation - never a
  // client-supplied or previously-observed value. Throws
  // `assignments.currentNotResolved` and performs no further work (no
  // engine call, no audit) for every non-"valid" resolution.
  const assignmentId = await requireValidCurrentAssignmentId({
    classId: input.classId,
    lessonSlug: input.lessonSlug,
    teacherId: actor.uid,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
  });

  const context: RecipientOwnershipContext = {
    assignmentId,
    classId: input.classId,
    teacherId: actor.uid,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
    assignedBy: actor.uid,
  };

  const { added, alreadyCurrent } = await reconcileAssignmentRecipients(
    context,
    "teacherReconcile",
  );

  // Reuses the existing `assignments.recipientsReconciled` audit action -
  // this is the same category of teacher-initiated bulk reconciliation
  // intent as the explicit-assignmentId callable, just reached through
  // Current resolution. No new audit vocabulary entry. Aggregate-only
  // payload: no student identifiers, no recipient records, no pointer
  // contents.
  await writeAuditEvent({
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "assignments.recipientsReconciled",
    targetType: "assignment",
    targetId: assignmentId,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
    payload: {
      assignmentId,
      classId: input.classId,
      lessonSlug: input.lessonSlug,
      added,
      alreadyCurrent,
    },
  });

  safeLog(() =>
    log.info("assignments.currentRecipientsReconciled", {
      actorUserId: actor.uid,
      classId: input.classId,
      lessonSlug: input.lessonSlug,
      assignmentId,
      added,
      alreadyCurrent,
    }),
  );

  return {
    classId: input.classId,
    lessonSlug: input.lessonSlug,
    assignmentId,
    added,
    alreadyCurrent,
  };
}

export const assignmentsCurrentRecipientsReconcile = platformCallable(
  assignmentsCurrentRecipientsReconcileHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assignmentsCurrentRecipientsReconcileHandler =
  assignmentsCurrentRecipientsReconcileHandler;
