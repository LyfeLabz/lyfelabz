import {
  PlatformError,
  assignmentDocRef,
  assignmentsCurrentDocRef,
  type AssignmentCurrentRecord,
  type AssignmentRecord,
} from "../shared";

// Historical Assignment Resolution, Implementation Slice 3.
//
// The ONE canonical implementation of Current-pointer validation. The
// pointer at `classes/{classId}/assignmentsCurrent/{lessonSlug}` is an
// index, never authority: a pointer document is never trusted merely
// because it exists. This module independently re-derives, from live
// server data, that a pointer's `assignmentId` still names a real,
// currently-published assignment inside the exact authorized
// teacher/class/lesson/school scope - the same governing invariant already
// documented on `AssignmentCurrentRecord` in
// `../shared/types/assignment-current.ts`.
//
// This is server-internal groundwork only (Slice 3). Nothing in this file
// is wired into any callable yet. The two planned consumers - a tolerant
// `assignmentsLifecycleState` integration and a strict
// `assignmentsCurrentRecipientsReconcile` integration - both reuse the
// exact same validation chain implemented once here, via the two exports
// below, so there is never a second, independently-drifting copy of "what
// counts as a valid Current" for a read path versus a mutation path.
//
// Authorization boundary, mirroring `RecipientEnforcementContext` /
// `isCanonicalRecipient` in `./assignment-recipients.ts` exactly: this
// module performs NO authentication, NO role check, and NO class-ownership
// check of its own. Every field on `CurrentAssignmentEnforcementContext`
// MUST already be established by the caller, through the caller's own
// existing authorization sequence, before this function is invoked -
// `teacherId`/`schoolId`/`districtId` must already be the caller's
// verified `DistrictContext` (via `requireDistrictContext` plus the active-
// teacher role check, exactly as `assignmentsLifecycleState` and
// `assignmentsRecipientsReconcile` already perform today), and that actor
// must already have been checked against a live `classes/{classId}` record
// (`classRecord.teacherId === teacherId && classRecord.schoolId ===
// schoolId`) before this function is called. This function never re-reads
// the class itself and never re-derives the actor: doing so here would
// duplicate authorization logic that already exists, correctly, at every
// planned call site, and would not close any gap those call sites do not
// already close. Supplying a matching `context` alone is never sufficient
// to obtain a `"valid"` result: this function still independently reads
// and validates the live pointer AND the live referenced assignment against
// that context on every call, and a caller cannot shortcut either read.
//
// Reconnaissance note on `districtId`: neither `AssignmentCurrentRecord`
// nor `AssignmentRecord` carries a `districtId` field (confirmed against
// the actual certified types in `../shared/types/assignment-current.ts`
// and `../shared/types/assignment.ts`). District scope is never stored
// directly on either record anywhere in this codebase; it is always
// re-derived from `schoolId` through `requireDistrictContext`'s own chain
// (`users/{uid}.schoolId` -> `schools/{schoolId}.districtId`), exactly as
// `assignmentsLifecycleState` and `assignmentsRecipientsReconcile` already
// rely on today. `districtId` is accepted on the context here for
// signature completeness with that established `{uid, schoolId,
// districtId}` actor shape and for future callers' own audit/log payloads,
// but it drives no independent comparison inside this function: cross-
// district isolation is enforced transitively through the `schoolId`
// checks below, since a school belongs to exactly one district.
//
// Reconnaissance note on `assignmentId` self-reference: `AssignmentRecord`
// does not store its own id as a field (the id is purely the Firestore
// document id at `assignments/{assignmentId}`). There is therefore no
// separate "does the referenced assignment's stored id match the pointer's
// assignmentId" check to perform beyond fetching the assignment document AT
// exactly `pointer.assignmentId` - if that document exists, its identity is
// established by construction of the read itself, not by comparing a
// field.
//
// Efficiency: exactly two live reads per call - the pointer, then (only if
// the pointer is present, well-formed, and scoped correctly) the referenced
// assignment. A malformed or missing pointer short-circuits before the
// assignment is ever read. No collection query, no scan of every assignment
// for the class, and no new index. There is no fallback assignment
// selection of any kind (no newest/oldest/most-recipients/most-attempts/
// Classroom-publication/grading-mode heuristic) anywhere in this function:
// every non-"valid" branch returns immediately with a reason and performs
// no further read.

export type CurrentAssignmentEnforcementContext = {
  readonly classId: string;
  readonly lessonSlug: string;
  readonly teacherId: string;
  readonly schoolId: string;
  readonly districtId: string;
};

// Closed, internal-facing reason vocabulary. These values are for tests and
// server logs only - they are never surfaced to a client as distinct error
// codes. `requireValidCurrentAssignmentId` below collapses every one of
// them to the single canonical `assignments.currentNotResolved` refusal, so
// future client behavior can treat every non-"valid" resolution identically
// without observing which specific check failed.
export type CurrentAssignmentUnresolvedReason =
  | "pointerMissing"
  | "pointerMalformed"
  | "pointerClassMismatch"
  | "pointerLessonMismatch"
  | "pointerTeacherMismatch"
  | "pointerSchoolMismatch"
  | "assignmentMissing"
  | "assignmentClassMismatch"
  | "assignmentLessonMismatch"
  | "assignmentTeacherMismatch"
  | "assignmentSchoolMismatch"
  | "assignmentNotPublished";

export type ResolveCurrentAssignmentResult =
  | { readonly resolution: "valid"; readonly assignmentId: string }
  | { readonly resolution: CurrentAssignmentUnresolvedReason };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Malformed-pointer guard. A pointer document that exists but is missing a
// required field, carries the wrong type on a field, or carries a `source`
// outside the closed `AssignmentCurrentSource` vocabulary is treated
// identically to "no pointer" (fail closed) - it is never repaired,
// overwritten, or partially trusted.
function isWellFormedAssignmentCurrentRecord(
  data: FirebaseFirestore.DocumentData | undefined,
): data is AssignmentCurrentRecord {
  if (!data) return false;
  if (!isNonEmptyString(data.classId)) return false;
  if (!isNonEmptyString(data.lessonSlug)) return false;
  if (!isNonEmptyString(data.assignmentId)) return false;
  if (!isNonEmptyString(data.teacherId)) return false;
  if (!isNonEmptyString(data.schoolId)) return false;
  if (!isNonEmptyString(data.setBy)) return false;
  if (data.source !== "publish" && data.source !== "teacherResolution") {
    return false;
  }
  if (data.setAt === undefined || data.setAt === null) return false;
  return true;
}

// The canonical tolerant resolver. Never throws for an unresolved Current;
// every unresolved condition is a normal, expected return value, not an
// error. `assignmentsLifecycleState` (a later slice) is the tolerant
// consumer: it must be able to report "Current is unresolved" as part of
// its own five-state response without failing the whole read.
export async function resolveValidCurrentAssignmentId(
  context: CurrentAssignmentEnforcementContext,
): Promise<ResolveCurrentAssignmentResult> {
  const pointerSnapshot = await assignmentsCurrentDocRef(
    context.classId,
    context.lessonSlug,
  ).get();
  if (!pointerSnapshot.exists) {
    return { resolution: "pointerMissing" };
  }

  const pointerData = pointerSnapshot.data();
  if (!isWellFormedAssignmentCurrentRecord(pointerData)) {
    return { resolution: "pointerMalformed" };
  }
  const pointer: AssignmentCurrentRecord = pointerData;

  if (pointer.classId !== context.classId) {
    return { resolution: "pointerClassMismatch" };
  }
  if (pointer.lessonSlug !== context.lessonSlug) {
    return { resolution: "pointerLessonMismatch" };
  }
  if (pointer.teacherId !== context.teacherId) {
    return { resolution: "pointerTeacherMismatch" };
  }
  if (pointer.schoolId !== context.schoolId) {
    return { resolution: "pointerSchoolMismatch" };
  }

  const assignmentSnapshot = await assignmentDocRef(pointer.assignmentId).get();
  if (!assignmentSnapshot.exists) {
    return { resolution: "assignmentMissing" };
  }
  const assignment: AssignmentRecord | undefined = assignmentSnapshot.data();
  if (!assignment) {
    return { resolution: "assignmentMissing" };
  }

  if (assignment.classId !== context.classId) {
    return { resolution: "assignmentClassMismatch" };
  }
  if (assignment.lessonSlug !== context.lessonSlug) {
    return { resolution: "assignmentLessonMismatch" };
  }
  if (assignment.teacherId !== context.teacherId) {
    return { resolution: "assignmentTeacherMismatch" };
  }
  if (assignment.schoolId !== context.schoolId) {
    return { resolution: "assignmentSchoolMismatch" };
  }
  if (assignment.status !== "published") {
    return { resolution: "assignmentNotPublished" };
  }

  return { resolution: "valid", assignmentId: pointer.assignmentId };
}

// The thin strict wrapper. A later `assignmentsCurrentRecipientsReconcile`
// slice is the mutation consumer: it must fail closed the instant Current
// is unresolved, rather than branch on which of the checks above failed.
// Every non-"valid" resolution converges on the identical canonical refusal
// `assignments.currentNotResolved` so a client can never distinguish, for
// example, "no pointer" from "cross-school pointer" from "pointer refers to
// a closed assignment" - all are simply "Current is not resolved for this
// class and lesson; resolve it again."
export async function requireValidCurrentAssignmentId(
  context: CurrentAssignmentEnforcementContext,
): Promise<string> {
  const result = await resolveValidCurrentAssignmentId(context);
  if (result.resolution === "valid") {
    return result.assignmentId;
  }
  throw new PlatformError(
    "assignments.currentNotResolved",
    "No valid Current assignment is resolved for this class and lesson.",
  );
}
