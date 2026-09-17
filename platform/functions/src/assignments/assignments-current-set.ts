import { FieldValue } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  assignmentDocRef,
  assignmentsCurrentDocRef,
  assignmentsCurrentSetDocRef,
  classDocRef,
  log,
  requireDistrictContext,
  runFirestoreTransaction,
  writeAuditEventInTransaction,
  type AssignmentCurrentWrite,
  type AssignmentRecord,
  type ClassRecord,
} from "../shared";

import { isWellFormedAssignmentCurrentRecord } from "./resolve-current-assignment";

// Historical Assignment Resolution, Implementation Slice 4.
//
// assignmentsCurrentSet
//
// The ONLY explicit teacher-driven mutation for selecting or changing which
// assignment is Current for one (classId, lessonSlug) pair. Used for both
// the one-time explicit resolution of a legacy `multiplePublished` class
// with no prior pointer (`expectedCurrentAssignmentId: null`) and every
// subsequent deliberate "Change current assignment" action - both are the
// same category of explicit teacher intent, hence one callable and one
// `source: "teacherResolution"` value on the write (see
// `AssignmentCurrentSource` in `../shared/types/assignment-current.ts`).
//
// This callable does NOT reconcile recipients, does NOT publish an
// assignment, and does NOT create an assignment. It only ever changes the
// dedicated Current pointer at
// `classes/{classId}/assignmentsCurrent/{lessonSlug}`, after independently
// re-deriving, from live server data inside one Firestore transaction, that
// the requested assignment is genuinely eligible and that the caller's
// compare-and-swap belief about the pointer's current value still holds.
//
// Governing invariant: STALE TEACHER INTENT MUST NOT SILENTLY OVERWRITE A
// NEWER CURRENT SELECTION. `expectedCurrentAssignmentId` is mandatory on
// every call (never inferred, never optional) precisely so that a client
// can never "just set" Current without proving, at mutation time, that it
// observed the value it believes it is replacing.

export type AssignmentsCurrentSetRequest = {
  readonly classId: string;
  readonly lessonSlug: string;
  readonly assignmentId: string;
  readonly expectedCurrentAssignmentId: string | null;
};

export type AssignmentsCurrentSetResponse = {
  readonly classId: string;
  readonly lessonSlug: string;
  readonly assignmentId: string;
  readonly changed: boolean;
};

const CLASS_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;
const LESSON_SLUG_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,126}[A-Za-z0-9])?$/;
const ASSIGNMENT_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;

// Exactly these four keys are ever accepted. `teacherId`, `schoolId`,
// `districtId`, `setBy`, `source`, `previousAssignmentId`, and every other
// field a client might otherwise use to influence scope or provenance are
// rejected outright by the allowlist below - not merely ignored - so a
// caller cannot smuggle an unrecognized field through undetected.
const ALLOWED_REQUEST_KEYS: ReadonlySet<string> = new Set([
  "classId",
  "lessonSlug",
  "assignmentId",
  "expectedCurrentAssignmentId",
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

function validateRequest(data: unknown): AssignmentsCurrentSetRequest {
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

  if (!("expectedCurrentAssignmentId" in payload)) {
    throw new PlatformError(
      "assignments.invalidExpectedCurrentAssignmentId",
      "expectedCurrentAssignmentId is required (use null for a first resolution).",
    );
  }
  const rawExpected = payload.expectedCurrentAssignmentId;
  let expectedCurrentAssignmentId: string | null;
  if (rawExpected === null) {
    expectedCurrentAssignmentId = null;
  } else if (isNonEmptyString(rawExpected) && ASSIGNMENT_ID_PATTERN.test(rawExpected.trim())) {
    expectedCurrentAssignmentId = rawExpected.trim();
  } else {
    throw new PlatformError(
      "assignments.invalidExpectedCurrentAssignmentId",
      "expectedCurrentAssignmentId must be null or a URL-safe assignment id token.",
    );
  }

  return { classId, lessonSlug, assignmentId, expectedCurrentAssignmentId };
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

// assignmentsCurrentSetHandler
//
// Every live read this mutation depends on - the owning class, the
// existing Current pointer, and (only when a genuine change is actually
// about to occur) the requested assignment's eligibility - happens INSIDE
// one Firestore transaction, not before it. This is deliberately the safer
// of two designs: reading class/assignment state non-transactionally and
// only wrapping the pointer compare-and-swap in a transaction would leave a
// window in which the requested assignment could close or change scope
// between that earlier read and the transaction's commit, letting a
// stale-but-momentarily-true eligibility check authorize a write the live
// data no longer supports. Firestore requires every transactional read to
// precede every transactional write within a given attempt; both writes
// below (the pointer `set` and the audit event) are issued only after every
// read that attempt performs, per the exact order enumerated next.
//
// Ordering revision (post-Slice-4-review): requested-assignment eligibility
// is validated LAST, only once a genuine pointer change is about to happen,
// not unconditionally up front. The original ordering validated the
// requested assignment before ever reading the pointer, which meant a
// harmless retry of an ALREADY-COMPLETED pointer mutation (response lost in
// transit, assignment closed in the interim) would surface a spurious
// `assignments.invalidTransition` instead of the idempotent `changed:false`
// the mutation had, in fact, already achieved. The corrected order is:
//
//   1. class read + ownership/school checks (unconditional - the caller
//      must never reach anything else without already owning the class)
//   2. live pointer read + well-formedness + exact-scope validation
//      (unconditional - a malformed or cross-scope pointer fails closed
//      before ANY assignment identity is even compared)
//   3. same-value idempotency check (before CAS, before touching the
//      requested assignment at all)
//   4. compare-and-swap (before touching the requested assignment - a
//      stale CAS request is rejected without paying for an assignment read
//      it can never use)
//   5. requested-assignment read + full eligibility validation (only now,
//      because only now is a genuine NEW Current selection about to occur)
//   6. pointer write + atomic audit event
//
// Security note: steps 3 and 4 can only be reached after step 1 has already
// proven the caller is an active teacher who owns this exact class in this
// exact school, AND after step 2 has already proven the live pointer itself
// (if one exists) is well-formed and scoped to that exact
// class/lesson/teacher/school. The same-value branch is therefore never a
// path to authorization - it is an idempotent acknowledgement that "the
// pointer mutation you, an already-authorized owner of this class, just
// asked for is already the live state," never a claim that the named
// assignment is presently eligible to become a NEW Current selection. A
// caller cannot manufacture a same-value success for another teacher's
// class merely by naming a matching assignmentId, because step 1 already
// rejects any caller who does not own the class before the pointer is ever
// read.
async function assignmentsCurrentSetHandler(
  request: CallableRequest<unknown>,
): Promise<AssignmentsCurrentSetResponse> {
  const actor = await assertActiveTeacherInDistrict(request);
  const input = validateRequest(request.data);

  const response = await runFirestoreTransaction(async (tx) => {
    // ---- 1. Class ownership (unconditional, before anything else) ----
    const classSnapshot = await tx.get(classDocRef(input.classId));
    if (!classSnapshot.exists) {
      throw new PlatformError("classes.notFound", "Class was not found.");
    }
    const classRecord: ClassRecord | undefined = classSnapshot.data();
    if (!classRecord) {
      throw new PlatformError("classes.notFound", "Class record was empty.");
    }
    if (classRecord.teacherId !== actor.uid) {
      throw new PlatformError(
        "classes.forbidden",
        "Caller does not own this class.",
      );
    }
    if (classRecord.schoolId !== actor.schoolId) {
      throw new PlatformError(
        "classes.forbidden",
        "Caller does not own this class.",
      );
    }

    // ---- 2. Live pointer: read and validate, never treat malformed as absent ----
    const pointerSnapshot = await tx.get(
      assignmentsCurrentDocRef(input.classId, input.lessonSlug),
    );
    let liveCurrentAssignmentId: string | null;
    if (!pointerSnapshot.exists) {
      liveCurrentAssignmentId = null;
    } else {
      const pointerData = pointerSnapshot.data();
      if (!isWellFormedAssignmentCurrentRecord(pointerData)) {
        throw new PlatformError(
          "assignments.currentNotResolved",
          "Existing Current pointer is malformed.",
        );
      }
      if (
        pointerData.classId !== input.classId ||
        pointerData.lessonSlug !== input.lessonSlug ||
        pointerData.teacherId !== actor.uid ||
        pointerData.schoolId !== actor.schoolId
      ) {
        throw new PlatformError(
          "assignments.currentNotResolved",
          "Existing Current pointer scope does not match the requested class, lesson, teacher, or school.",
        );
      }
      // A malformed-and-then-scope-checked pointer is well-formed at this
      // point, so it is safe to expose its raw recorded value here even
      // when that value happens to equal the requested assignmentId - the
      // well-formedness and scope checks above already ran unconditionally
      // and could not have been skipped by a same-value coincidence.
      liveCurrentAssignmentId = pointerData.assignmentId;
    }

    // ---- 3. Same-value branch, evaluated BEFORE CAS and BEFORE the
    // requested assignment is ever read (LOCKED order) ----
    // A first request may commit successfully but its response may be lost
    // in transit; the retry still carries the ORIGINAL
    // expectedCurrentAssignmentId, and the requested assignment may since
    // have closed or disappeared entirely. None of that matters here: the
    // exact pointer mutation the caller is asking for is already the live
    // state, so this returns success without reading, or caring about, the
    // requested assignment's current eligibility at all.
    if (liveCurrentAssignmentId === input.assignmentId) {
      return {
        classId: input.classId,
        lessonSlug: input.lessonSlug,
        assignmentId: input.assignmentId,
        changed: false,
      };
    }

    // ---- 4. Compare-and-swap, evaluated BEFORE the requested assignment
    // is read ----
    // A stale CAS expectation can never result in a write regardless of
    // what the requested assignment looks like, so it is rejected here,
    // before paying for a read that could never be used.
    if (input.expectedCurrentAssignmentId !== liveCurrentAssignmentId) {
      throw new PlatformError(
        "assignments.conflict",
        "The Current assignment has changed since it was last observed.",
      );
    }

    // ---- 5. Requested-assignment eligibility, only now that a genuine
    // NEW Current selection is actually about to happen ----
    // The Current pointer is never used as authority for this check; the
    // requested assignment must independently qualify by its own live
    // fields, exactly as `assignmentsRecipientsReconcile` independently
    // re-derives ownership rather than trusting anything read earlier.
    const assignmentSnapshot = await tx.get(assignmentDocRef(input.assignmentId));
    if (!assignmentSnapshot.exists) {
      throw new PlatformError(
        "assignments.notFound",
        "Requested assignment was not found.",
      );
    }
    const assignment: AssignmentRecord | undefined = assignmentSnapshot.data();
    if (!assignment) {
      throw new PlatformError(
        "assignments.notFound",
        "Requested assignment record was empty.",
      );
    }
    if (assignment.classId !== input.classId) {
      throw new PlatformError(
        "assignments.classLessonMismatch",
        "Requested assignment does not belong to the named class.",
      );
    }
    if (assignment.lessonSlug !== input.lessonSlug) {
      throw new PlatformError(
        "assignments.classLessonMismatch",
        "Requested assignment does not belong to the named lesson.",
      );
    }
    if (assignment.teacherId !== actor.uid) {
      throw new PlatformError(
        "assignments.forbidden",
        "Caller does not own the requested assignment.",
      );
    }
    if (assignment.schoolId !== actor.schoolId) {
      throw new PlatformError(
        "assignments.forbidden",
        "Caller does not own the requested assignment.",
      );
    }
    if (assignment.status !== "published") {
      throw new PlatformError(
        "assignments.invalidTransition",
        `Only a published assignment may become Current; current status is "${assignment.status}".`,
      );
    }

    // ---- 6. Write: pointer + audit, atomically, in the same transaction ----
    const write: AssignmentCurrentWrite = {
      classId: input.classId,
      lessonSlug: input.lessonSlug,
      assignmentId: input.assignmentId,
      teacherId: actor.uid,
      schoolId: actor.schoolId,
      setAt: FieldValue.serverTimestamp(),
      setBy: actor.uid,
      source: "teacherResolution",
    };
    tx.set(assignmentsCurrentSetDocRef(input.classId, input.lessonSlug), write);

    writeAuditEventInTransaction(tx, {
      actorUserId: actor.uid,
      actorRole: "teacher",
      action: "assignments.currentChanged",
      targetType: "assignment",
      targetId: input.assignmentId,
      schoolId: actor.schoolId,
      districtId: actor.districtId,
      payload: {
        classId: input.classId,
        lessonSlug: input.lessonSlug,
        assignmentId: input.assignmentId,
        previousAssignmentId: liveCurrentAssignmentId,
        source: "teacherResolution",
      },
    });

    return {
      classId: input.classId,
      lessonSlug: input.lessonSlug,
      assignmentId: input.assignmentId,
      changed: true,
    };
  });

  safeLog(() =>
    log.info("assignments.currentSet", {
      actorUserId: actor.uid,
      classId: input.classId,
      lessonSlug: input.lessonSlug,
      assignmentId: input.assignmentId,
      changed: response.changed,
    }),
  );

  return response;
}

export const assignmentsCurrentSet = platformCallable(assignmentsCurrentSetHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assignmentsCurrentSetHandler = assignmentsCurrentSetHandler;
