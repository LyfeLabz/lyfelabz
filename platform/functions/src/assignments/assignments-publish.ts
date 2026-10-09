import { type CallableRequest } from "firebase-functions/v2/https";
import { FieldValue, type Transaction } from "firebase-admin/firestore";

import {
  assertAssignableActivity,
  parseAssignmentResourceType,
  platformCallable,
  PlatformError,
  assignmentDocRef,
  assignmentPublishDocRef,
  assignmentRecipientCreationDocRef,
  assignmentsCurrentSetDocRef,
  completionDefinitionDocRef,
  isTransactionContention,
  log,
  requireDistrictContext,
  resolveCurrentAssessmentRevisionId,
  runFirestoreTransaction,
  writeAuditEventInTransaction,
  type AssignmentCompletionBinding,
  type AssignmentCurrentWrite,
  type AssignmentPublishWrite,
  type AssignmentRecord,
  type AssignmentResourceType,
} from "../shared";
import {
  buildAssignmentCompletionBinding,
  verifyCompletionDefinitionRecord,
  type CompletionResourceType,
} from "../resourceCompletion";

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

// Publication policy (RA-3B test seam). `assertAssignable` is the
// identifier/type/assignability gate applied to the record inside the
// publication transaction. The deployed callable always uses
// `PRODUCTION_ASSIGNMENT_PUBLICATION_POLICY`, which is the canonical
// `assertAssignableActivity` lesson-only gate, so non-lesson publication
// stays refused in production. Only tests construct another policy, to
// exercise the non-lesson binding path without opening the gate.
export type AssignmentPublicationPolicy = {
  readonly assertAssignable: (activityId: string, resourceType: AssignmentResourceType) => void;
};

export const PRODUCTION_ASSIGNMENT_PUBLICATION_POLICY: AssignmentPublicationPolicy = Object.freeze({
  assertAssignable: assertAssignableActivity,
});

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

async function loadAssignment(
  tx: Transaction,
  assignmentId: string,
): Promise<AssignmentRecord> {
  const snapshot = await tx.get(assignmentDocRef(assignmentId));
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
//   - record read via `assignmentDocRef(...)` inside the publication
//     transaction                                               (typed ref)
//   - enrollment population read via `enrollmentsCollectionRef(...)`,
//     inside the same transaction                               (§7 helper)
//   - status transition, frozen assessment revision, RA-3B completion
//     binding (non-lesson only), Current-pointer advancement, recipient
//     snapshot, and audit event via one `runFirestoreTransaction(...)`
//     commit; the publish write uses `assignmentPublishDocRef(...)`, the
//     Current pointer write uses `assignmentsCurrentSetDocRef(...)`, each
//     recipient write uses `assignmentRecipientCreationDocRef(...)`, and
//     the audit event uses `writeAuditEventInTransaction(...)`
//
// RA-3B publication concurrency. The pre-RA-3B path read the record and
// then committed an unconditional batch, so two concurrent publish calls
// could both observe `draft` and both commit (rewriting the frozen
// revision, recipient snapshot, Current pointer, and audit trail), and a
// draft update read before publication could land on the published record.
// The transition now runs in a Firestore transaction that re-reads the
// record (see `publishInTransaction`), and `assignmentsUpdateDraft` runs in
// its own transaction, so exactly one `draft` -> `published` transition
// commits and every loser observes it. Contention that outlasts the
// transaction's retries is refused with the stable
// `assignments.publishConflict` and writes nothing.
//
// Historical Assignment Resolution, Implementation Slice 5. Every
// successful `draft -> published` transition atomically advances the
// Current pointer at `classes/{classId}/assignmentsCurrent/{lessonSlug}` to
// name this newly published assignment, in the SAME transaction commit as the
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
//     transaction. If it fails, publication does not partially succeed.
//     The commit carries the transition, the Current pointer, the audit
//     event, and one write per recipient. Firestore has no fixed write
//     count per transaction; it is bounded by the 10 MiB request size,
//     the 270 s transaction limit (60 s idle), and contention. See
//     docs/platform/FROZEN_COMPLETION_DEFINITIONS.md.
//   - Retrying the callable on an already-published assignment is
//     idempotent: no recipient re-snapshot, no second audit event. This
//     holds for a concurrent duplicate call as well as a later retry.
//
// Idempotency: an already-`published` record returns
// `alreadyPublished: true` with no second write and no second audit
// event. Every other current status is rejected with
// `assignments.invalidTransition`.
async function publishAssignment(
  request: CallableRequest<unknown>,
  policy: AssignmentPublicationPolicy,
): Promise<AssignmentsPublishResponse> {
  const actor = await assertActiveTeacherInDistrict(request);
  const input = validateRequest(request.data);

  let outcome: PublishTransactionOutcome;
  try {
    outcome = await runFirestoreTransaction((tx) =>
      publishInTransaction(tx, input.assignmentId, actor, policy),
    );
  } catch (err) {
    if (isTransactionContention(err)) {
      throw new PlatformError(
        "assignments.publishConflict",
        "The assignment changed while it was being published. Try again.",
      );
    }
    throw err;
  }

  if (outcome.kind === "alreadyPublished") {
    logIdempotent(actor.uid, input.assignmentId);
    return {
      assignmentId: input.assignmentId,
      status: "published",
      alreadyPublished: true,
    };
  }

  safeLog(() =>
    log.info("assignments.published", {
      actorUserId: actor.uid,
      assignmentId: input.assignmentId,
      recipientCount: outcome.recipientCount,
    }),
  );

  return {
    assignmentId: input.assignmentId,
    status: "published",
    alreadyPublished: false,
  };
}

type PublishActor = { readonly uid: string; readonly schoolId: string; readonly districtId: string };

type PublishTransactionOutcome =
  | { readonly kind: "alreadyPublished" }
  | { readonly kind: "published"; readonly recipientCount: number };

function assertOwnedBy(record: AssignmentRecord, actor: PublishActor): void {
  if (record.teacherId !== actor.uid || record.schoolId !== actor.schoolId) {
    throw new PlatformError(
      "assignments.forbidden",
      "Caller does not own this assignment.",
    );
  }
}

function assertDraft(record: AssignmentRecord): void {
  if (record.status !== "draft") {
    throw new PlatformError(
      "assignments.invalidTransition",
      `Cannot transition from "${record.status}" to "published".`,
    );
  }
}

function logIdempotent(actorUserId: string, assignmentId: string): void {
  safeLog(() =>
    log.info("assignments.publishIdempotent", {
      actorUserId,
      assignmentId,
    }),
  );
}

// RA-3B. Resolves the immutable completion definition frozen with
// `assessmentRevisionId`, verifies it (hash, RA-2 schema, registered
// validators, resource and revision identity), and builds the binding for
// this occurrence. Reads inside the publication transaction. Any failure
// refuses publication; nothing is substituted or repaired.
async function resolveCompletionBinding(
  tx: Transaction,
  occurrence: { readonly assignmentId: string; readonly classId: string },
  resourceId: string,
  resourceType: CompletionResourceType,
  assessmentRevisionId: string,
): Promise<AssignmentCompletionBinding> {
  const snapshot = await tx.get(completionDefinitionDocRef(assessmentRevisionId));
  const verified = verifyCompletionDefinitionRecord(
    assessmentRevisionId,
    snapshot.exists ? snapshot.data() : undefined,
    { resourceId, resourceType },
  );
  if (!verified.ok) {
    throw new PlatformError(
      "assignments.completionDefinitionUnavailable",
      `The frozen completion definition for this assessment revision cannot be used (${verified.issue}).`,
      undefined,
      { issue: verified.issue },
    );
  }
  return buildAssignmentCompletionBinding(occurrence, verified);
}

// The one `draft` -> `published` transition. Every read (the record, the
// current assessment revision, the RA-3B completion definition, and the
// recipient population) precedes every write, and all of them belong to
// this transaction, so what is frozen is one consistent snapshot. Firestore
// retries the function on contention, and each attempt re-reads, so
// exactly one transition commits:
//   - a concurrent publish that commits first makes this attempt observe
//     `published` and return the idempotent outcome without writing, so
//     the frozen revision, completion binding, recipient snapshot, Current
//     pointer, and audit event are written once, by the winner only;
//   - a concurrent draft update that commits first is observed by the
//     retried attempt, which freezes the revision and binding for the
//     record as it now stands (and re-applies the assignability gate);
//   - a draft update that reads before this commits is itself refused or
//     retried by its own transaction (`assignmentsUpdateDraft`).
async function publishInTransaction(
  tx: Transaction,
  assignmentId: string,
  actor: PublishActor,
  policy: AssignmentPublicationPolicy,
): Promise<PublishTransactionOutcome> {
  const existing = await loadAssignment(tx, assignmentId);
  assertOwnedBy(existing, actor);
  if (existing.status === "published") return { kind: "alreadyPublished" };
  assertDraft(existing);

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

  // Resource Expansion Phase 1 - defense in depth behind the draft
  // callables: a record publishes only when its activity identifier
  // belongs to its type (absent means "lesson") and that type is
  // assignable. Every existing lesson record passes unchanged. Applied to
  // the record as read by this transaction.
  const resourceType = parseAssignmentResourceType(existing.resourceType);
  policy.assertAssignable(existing.lessonSlug, resourceType);

  // Immutable grading contract per ASSESSMENT_SCORING_CONTRACT.md §12.1.
  // Publication is refused unless the referenced assessment has already
  // been deployed. The currently deployed `assessmentRevisionId` is
  // resolved through the shared identifier helper (the sole owner of the
  // identifier grammar), read inside this transaction, and stamped once on
  // the draft -> published transition. Every downstream session and
  // attempt scores against this exact revision.
  const assessmentRevisionId = await resolveCurrentAssessmentRevisionId(
    existing.lessonSlug,
    tx,
  );

  // RA-3B - a non-lesson occurrence also freezes the completion definition
  // deployed with that exact revision. Lessons never carry a binding.
  const completionBinding =
    resourceType === "lesson"
      ? undefined
      : await resolveCompletionBinding(
          tx,
          { assignmentId, classId: existing.classId },
          existing.lessonSlug,
          resourceType,
          assessmentRevisionId,
        );

  // Initial recipient population, read in this transaction after the
  // revision and binding resolve (a refused publication never loads it).
  const population = await loadInitialRecipientPopulation(
    existing.classId,
    existing.schoolId,
    tx,
  );

  const context: RecipientOwnershipContext = {
    assignmentId,
    classId: existing.classId,
    teacherId: existing.teacherId,
    schoolId: existing.schoolId,
    districtId: actor.districtId,
    assignedBy: actor.uid,
  };

  const publishWrite: AssignmentPublishWrite = {
    status: "published",
    // Sprint 15 Slice 2: stamp the first-publication timestamp so the
    // teacher dashboard can render a factual published date without a
    // second callable. Written exactly once (only by the winning draft ->
    // published transition).
    publishedAt: FieldValue.serverTimestamp(),
    // Immutable grading contract per ASSESSMENT_SCORING_CONTRACT.md
    // §12.1. Written exactly once on the first draft -> published
    // transition. Close/reopen transitions intentionally omit this field.
    assessmentRevisionId,
    ...(completionBinding ? { completionBinding } : {}),
  };
  tx.update(assignmentPublishDocRef(assignmentId), publishWrite);

  // Historical Assignment Resolution, Implementation Slice 5. Unconditional
  // Current-pointer advancement, atomic with the publish transition above -
  // see the handler-level comment for the full rationale (no CAS, no read
  // of any prior pointer value, source "publish" records why it advanced).
  // Ownership fields are sourced from the assignment's own frozen
  // `teacherId`/`schoolId` (already verified equal to `actor.uid`/
  // `actor.schoolId` above), exactly mirroring how `context` sources the
  // same two fields for the recipient snapshot.
  const currentPointerWrite: AssignmentCurrentWrite = {
    classId: existing.classId,
    lessonSlug: existing.lessonSlug,
    assignmentId,
    teacherId: existing.teacherId,
    schoolId: existing.schoolId,
    setAt: FieldValue.serverTimestamp(),
    setBy: actor.uid,
    source: "publish",
  };
  tx.set(
    assignmentsCurrentSetDocRef(existing.classId, existing.lessonSlug),
    currentPointerWrite,
  );

  for (const studentId of population) {
    tx.set(
      assignmentRecipientCreationDocRef(assignmentId, studentId),
      buildRecipientCreationWrite(context, studentId, "classPublication"),
    );
  }

  // The audit event commits with the transition it describes, so it is
  // written exactly once, by the winning attempt, with the values that
  // attempt froze.
  writeAuditEventInTransaction(tx, {
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "assignments.published",
    targetType: "assignment",
    targetId: assignmentId,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
    payload: {
      classId: existing.classId,
      lessonSlug: existing.lessonSlug,
      assessmentRevisionId,
      recipientCount: population.length,
      ...(completionBinding
        ? { completionDefinitionHash: completionBinding.definitionHash }
        : {}),
    },
  });

  return { kind: "published", recipientCount: population.length };
}

async function assignmentsPublishHandler(
  request: CallableRequest<unknown>,
): Promise<AssignmentsPublishResponse> {
  return publishAssignment(request, PRODUCTION_ASSIGNMENT_PUBLICATION_POLICY);
}

export const assignmentsPublish = platformCallable(assignmentsPublishHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assignmentsPublishHandler = assignmentsPublishHandler;

// RA-3B test seam: the same publication path under an explicit policy, so
// tests can exercise non-lesson binding while the production gate stays
// closed. Not wrapped as a callable and not exported from `src/index.ts`.
export const __publishAssignmentWithPolicy = publishAssignment;
