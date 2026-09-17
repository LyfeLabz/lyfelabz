import { type CallableRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";

import {
  platformCallable,
  PlatformError,
  assignmentDocRef,
  assignmentPublishDocRef,
  assignmentRecipientCreationDocRef,
  assignmentsCurrentSetDocRef,
  createFirestoreBatch,
  log,
  requireDistrictContext,
  resolveCurrentAssessmentRevisionId,
  writeAuditEvent,
  type AssignmentCurrentWrite,
  type AssignmentPublishWrite,
  type AssignmentRecord,
} from "../shared";

import {
  buildRecipientCreationWrite,
  loadInitialRecipientPopulation,
  type RecipientOwnershipContext,
} from "./assignment-recipients";

// Client-supplied request payload for assignmentsPublish. Only the target
// assignment identifier is carried. Ownership fields are never carried on
// the request and are derived server-side from the record.
export type AssignmentsPublishRequest = {
  readonly assignmentId: string;
};

// Return payload of a successful publish call. `alreadyPublished` is
// `true` when the record is already in `published` and no write is
// required; `false` when this call advanced the lifecycle field from
// `draft` to `published`.
export type AssignmentsPublishResponse = {
  readonly assignmentId: string;
  readonly status: "published";
  readonly alreadyPublished: boolean;
};

const ASSIGNMENT_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;

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

function validateRequest(data: unknown): AssignmentsPublishRequest {
  if (data === null || typeof data !== "object") {
    throw new PlatformError(
      "assignments.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;
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

// assignmentsPublish
//
// Canonical publish transition for assignments/{assignmentId} per Data
// Model §3.6 lifecycle: `draft` -> `published`. Callable by the owning
// teacher only.
//
// Every side effect flows through the canonical shared helpers:
//   - record read via `assignmentDocRef(...).get()`               (typed ref)
//   - enrollment population read via `enrollmentsCollectionRef(...)`
//                                                                 (§7 helper)
//   - atomic status transition, Current-pointer advancement, and recipient
//     snapshot via one `createFirestoreBatch()` commit; the publish write
//     uses `assignmentPublishDocRef(...)`, the Current pointer write uses
//     `assignmentsCurrentSetDocRef(...)`, and each recipient write uses
//     `assignmentRecipientCreationDocRef(...)`
//   - audit event via `writeAuditEvent({...})`                    (§5 helper)
//
// Historical Assignment Resolution, Implementation Slice 5. Every
// successful `draft -> published` transition atomically advances the
// Current pointer at `classes/{classId}/assignmentsCurrent/{lessonSlug}` to
// name this newly published assignment, in the SAME batch commit as the
// publish transition itself - never a separate, best-effort write after
// the fact. This is deliberately UNCONDITIONAL with respect to whatever
// value the pointer previously held: the assignment being published here is
// a genuinely new, teacher-authorized instructional occurrence, and the
// successful publication of a new occurrence is itself sufficient
// authority to become Current, per the architecture's own "a genuinely
// newly published occurrence becomes Current in the same atomic commit
// that publishes it" invariant.
//
// This intentionally differs from `assignmentsCurrentSet` (Slice 4), which
// requires an explicit, teacher-supplied `expectedCurrentAssignmentId`
// compare-and-swap for every DELIBERATE Current change. Publication
// advancement is not a "change Current" action at all from the teacher's
// perspective - it is an inherent, automatic consequence of publishing -
// so it carries no CAS, reads no prior pointer value, and cannot be
// rejected by a stale, malformed, or missing prior pointer. A pointer that
// is currently absent, stale, malformed, or pointed at a closed or deleted
// assignment is never read, never validated, and never a precondition for
// this write: publication authoritatively REPLACES whatever the pointer
// previously held. `resolveValidCurrentAssignmentId` (Slice 3) is
// deliberately not called anywhere on this path.
//
// Race semantics (locked): if two distinct, independently legitimate draft
// assignments for the same (classId, lessonSlug) are published through two
// concurrent calls, each publication atomically and unconditionally writes
// itself as Current; whichever underlying Firestore commit is applied last
// is the one the pointer ends up naming. This is intentional, not a defect
// - CAS is deliberately not used here to prevent it. Both assignments
// remain valid, independently published historical records; a teacher can
// use the Slice 4 `assignmentsCurrentSet` "Change current assignment" flow
// afterward to select whichever one they intend as Current.
//
// First-publication detection: the assignment record's current `status`
// field is the sole first-publication signal. `draft` -> `published`
// advances the lifecycle field and writes the initial recipient snapshot.
// `published` is treated as an already-published no-op with no recipient
// re-snapshot. Every other current status is rejected with
// `assignments.invalidTransition` per Data Model §3.6, which forbids
// resurrecting a `closed` or `archived` assignment through the publish
// path.
//
// Initial recipient snapshot (PDR-029h, PDR-029l, Sprint 12E-A
// Reconciliation Notice on Cloud Function Charter):
//   - Population is loaded from `enrollments` filtered by the assignment's
//     frozen `classId` and defense-in-depth-filtered against the
//     assignment's frozen `schoolId` and `status === "active"`.
//   - The assignment's `districtId` is not stored on the assignment record;
//     it is derived from the authenticated caller's district context. The
//     caller's `schoolId` has already been checked against the assignment's
//     `schoolId`, and Sprint 10A F1 guarantees that a teacher's district
//     context matches the district that owns their school, so the derived
//     `districtId` is the assignment's authoritative district.
//   - Each recipient document is written with `source: "classPublication"`,
//     `status: "assigned"`, and `assignedBy` set to the publishing
//     teacher's uid. `assignedAt` is stamped by the server via
//     `FieldValue.serverTimestamp()`.
//   - An empty population publishes successfully and creates zero
//     recipients.
//   - Recipient writes and the status write commit together in one atomic
//     batch. If the batch fails, publication does not partially succeed.
//   - Retrying the callable on an already-published assignment is
//     idempotent: no recipient re-snapshot, no second audit event.
//
// Idempotency: an already-`published` record returns
// `alreadyPublished: true` with no second write and no second audit
// event. Every other current status is rejected with
// `assignments.invalidTransition`.
async function assignmentsPublishHandler(
  request: CallableRequest<unknown>,
): Promise<AssignmentsPublishResponse> {
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

  if (existing.status === "published") {
    safeLog(() =>
      log.info("assignments.publishIdempotent", {
        actorUserId: actor.uid,
        assignmentId: input.assignmentId,
      }),
    );
    return {
      assignmentId: input.assignmentId,
      status: "published",
      alreadyPublished: true,
    };
  }

  if (existing.status !== "draft") {
    throw new PlatformError(
      "assignments.invalidTransition",
      `Cannot transition from "${existing.status}" to "published".`,
    );
  }

  if (!isNonEmptyString(existing.classId)) {
    throw new PlatformError(
      "assignments.invalidState",
      "Assignment record is missing its class reference.",
    );
  }
  if (!isNonEmptyString(existing.lessonSlug)) {
    throw new PlatformError(
      "assignments.invalidState",
      "Assignment record is missing its lesson slug.",
    );
  }

  // Immutable grading contract per ASSESSMENT_SCORING_CONTRACT.md §12.1.
  // Publication is refused unless the referenced assessment has already
  // been deployed. The currently deployed `assessmentRevisionId` is
  // resolved through the shared identifier helper (the sole owner of the
  // identifier grammar) and stamped once on the draft -> published
  // transition. Every downstream session and attempt scores against this
  // exact revision.
  const assessmentRevisionId = await resolveCurrentAssessmentRevisionId(
    existing.lessonSlug,
  );

  const population = await loadInitialRecipientPopulation(
    existing.classId,
    existing.schoolId,
  );

  const context: RecipientOwnershipContext = {
    assignmentId: input.assignmentId,
    classId: existing.classId,
    teacherId: existing.teacherId,
    schoolId: existing.schoolId,
    districtId: actor.districtId,
    assignedBy: actor.uid,
  };

  const batch = createFirestoreBatch();
  const publishWrite: AssignmentPublishWrite = {
    status: "published",
    // Sprint 15 Slice 2: stamp the first-publication timestamp so the
    // teacher dashboard can render a factual published date without a
    // second callable. Written exactly once (only on the draft ->
    // published transition; the idempotent already-published branch
    // above returns without writing).
    publishedAt: FieldValue.serverTimestamp(),
    // Immutable grading contract per ASSESSMENT_SCORING_CONTRACT.md
    // §12.1. Written exactly once on the first draft -> published
    // transition. Close/reopen transitions intentionally omit this
    // field; the idempotent already-published branch above returns
    // without writing.
    assessmentRevisionId,
  };
  batch.update(assignmentPublishDocRef(input.assignmentId), publishWrite);

  // Historical Assignment Resolution, Implementation Slice 5. Unconditional
  // Current-pointer advancement, atomic with the publish transition above -
  // see the handler-level comment for the full rationale (no CAS, no read
  // of any prior pointer value, source "publish" records why it advanced).
  // Ownership fields are sourced from the assignment's own frozen
  // `teacherId`/`schoolId` (already verified equal to `actor.uid`/
  // `actor.schoolId` above), exactly mirroring how `context` below sources
  // the same two fields for the recipient snapshot.
  const currentPointerWrite: AssignmentCurrentWrite = {
    classId: existing.classId,
    lessonSlug: existing.lessonSlug,
    assignmentId: input.assignmentId,
    teacherId: existing.teacherId,
    schoolId: existing.schoolId,
    setAt: FieldValue.serverTimestamp(),
    setBy: actor.uid,
    source: "publish",
  };
  batch.set(
    assignmentsCurrentSetDocRef(existing.classId, existing.lessonSlug),
    currentPointerWrite,
  );

  for (const studentId of population) {
    batch.set(
      assignmentRecipientCreationDocRef(input.assignmentId, studentId),
      buildRecipientCreationWrite(context, studentId, "classPublication"),
    );
  }
  await batch.commit();

  await writeAuditEvent({
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "assignments.published",
    targetType: "assignment",
    targetId: input.assignmentId,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
    payload: {
      classId: existing.classId,
      lessonSlug: existing.lessonSlug,
      assessmentRevisionId,
      recipientCount: population.length,
    },
  });

  safeLog(() =>
    log.info("assignments.published", {
      actorUserId: actor.uid,
      assignmentId: input.assignmentId,
      recipientCount: population.length,
    }),
  );

  return {
    assignmentId: input.assignmentId,
    status: "published",
    alreadyPublished: false,
  };
}

export const assignmentsPublish = platformCallable(assignmentsPublishHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assignmentsPublishHandler = assignmentsPublishHandler;
