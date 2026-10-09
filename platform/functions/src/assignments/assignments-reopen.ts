import { type Transaction } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  assignmentReopenDocRef,
  assignmentDocRef,
  isTransactionContention,
  log,
  requireDistrictContext,
  runFirestoreTransaction,
  writeAuditEventInTransaction,
  type AssignmentReopenWrite,
  type AssignmentRecord,
} from "../shared";

// Client-supplied request payload for assignmentsReopen. Only the target
// assignment identifier is carried. Ownership fields are never carried
// on the request and are derived server-side from the record.
export type AssignmentsReopenRequest = {
  readonly assignmentId: string;
};

// Return payload of a successful reopen call. `alreadyPublished` is
// `true` when the record is already in `published` and no write is
// required; `false` when this call advanced the lifecycle field from
// `closed` back to `published`.
export type AssignmentsReopenResponse = {
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

function validateRequest(data: unknown): AssignmentsReopenRequest {
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

// Test-only hooks (RA-3C). Awaited inside the reopen transaction so
// emulator tests can force an exact interleaving with a concurrent archive
// without timing-dependent sleeps. `attempt` counts transaction attempts
// from 1. The deployed callable never passes hooks.
export type ReopenTransactionHooks = {
  readonly afterRead?: (attempt: number) => Promise<void>;
  readonly afterWrites?: (attempt: number) => Promise<void>;
};

type ReopenActor = { readonly uid: string; readonly schoolId: string; readonly districtId: string };

type ReopenOutcome = { readonly kind: "alreadyPublished" } | { readonly kind: "reopened" };

// assignmentsReopen
//
// Inverse of assignmentsClose per Data Model 3.6 lifecycle: the
// `closed` -> `published` transition. Callable by the owning teacher
// only. The write is intentionally narrow so the reopen path cannot be
// laundered into a metadata edit, an ownership change, or a lesson
// change; recipients, attempts, sessions, summaries, answer keys, the
// frozen assessment revision and completion binding, and the Current
// pointer are never touched.
//
// Every side effect flows through the canonical shared helpers, inside one
// `runFirestoreTransaction(...)` (RA-3C):
//   - record read via `assignmentDocRef(...)`                     (typed ref)
//   - narrow reopen write via `assignmentReopenDocRef(...)`       (typed ref)
//   - audit event via `writeAuditEventInTransaction(...)`         (5 helper)
//
// Concurrency. The pre-RA-3C handler read the record outside any
// transaction and then wrote `published` unconditionally, so an archive
// committing between that read and write was overwritten and the archived
// assignment was resurrected. Now ownership and the `closed` precondition
// are checked against the snapshot this transaction read, and the status
// write commits only if that snapshot is still current; if an archive (or
// any other write) lands first, Firestore re-runs the function, which
// re-reads `archived` and refuses with `assignments.invalidTransition`.
// Archived therefore stays terminal under every interleaving. The
// transaction performs no external side effect (logging happens after
// commit), so retries are safe and cannot duplicate the audit event.
// Contention that outlasts the SDK's retries is refused with
// `assignments.reopenConflict` and writes nothing.
//
// Idempotency: an already-`published` record returns
// `alreadyPublished: true` with no second write and no second audit
// event. Every other current status (draft, archived) is rejected with
// `assignments.invalidTransition`.
async function reopenAssignment(
  request: CallableRequest<unknown>,
  hooks: ReopenTransactionHooks,
): Promise<AssignmentsReopenResponse> {
  const actor = await assertActiveTeacherInDistrict(request);
  const input = validateRequest(request.data);

  let attempt = 0;
  let outcome: ReopenOutcome;
  try {
    outcome = await runFirestoreTransaction(async (tx) => {
      attempt += 1;
      return reopenInTransaction(tx, input.assignmentId, actor, hooks, attempt);
    });
  } catch (err) {
    if (isTransactionContention(err)) {
      throw new PlatformError(
        "assignments.reopenConflict",
        "The assignment changed while it was being reopened. Try again.",
      );
    }
    throw err;
  }

  if (outcome.kind === "alreadyPublished") {
    safeLog(() =>
      log.info("assignments.reopenIdempotent", {
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

  safeLog(() =>
    log.info("assignments.reopened", {
      actorUserId: actor.uid,
      assignmentId: input.assignmentId,
    }),
  );

  return {
    assignmentId: input.assignmentId,
    status: "published",
    alreadyPublished: false,
  };
}

async function reopenInTransaction(
  tx: Transaction,
  assignmentId: string,
  actor: ReopenActor,
  hooks: ReopenTransactionHooks,
  attempt: number,
): Promise<ReopenOutcome> {
  const existing = await loadAssignment(tx, assignmentId);
  if (hooks.afterRead) await hooks.afterRead(attempt);

  if (
    existing.teacherId !== actor.uid ||
    existing.schoolId !== actor.schoolId
  ) {
    throw new PlatformError(
      "assignments.forbidden",
      "Caller does not own this assignment.",
    );
  }

  if (existing.status === "published") return { kind: "alreadyPublished" };

  if (existing.status !== "closed") {
    throw new PlatformError(
      "assignments.invalidTransition",
      `Cannot transition from "${existing.status}" to "published".`,
    );
  }

  const write: AssignmentReopenWrite = { status: "published" };
  tx.update(assignmentReopenDocRef(assignmentId), write);

  writeAuditEventInTransaction(tx, {
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "assignments.reopened",
    targetType: "assignment",
    targetId: assignmentId,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
    payload: { classId: existing.classId, previousStatus: existing.status },
  });

  if (hooks.afterWrites) await hooks.afterWrites(attempt);
  return { kind: "reopened" };
}

async function assignmentsReopenHandler(
  request: CallableRequest<unknown>,
): Promise<AssignmentsReopenResponse> {
  return reopenAssignment(request, {});
}

export const assignmentsReopen = platformCallable(assignmentsReopenHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assignmentsReopenHandler = assignmentsReopenHandler;

// RA-3C test seam: the same reopen path with interleaving hooks. Not a
// callable and not exported from `src/index.ts`.
export const __reopenAssignmentWithHooks = reopenAssignment;
