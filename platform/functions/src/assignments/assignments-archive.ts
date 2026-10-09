import { type Transaction } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  assignmentArchiveDocRef,
  assignmentDocRef,
  isTransactionContention,
  log,
  requireDistrictContext,
  runFirestoreTransaction,
  writeAuditEventInTransaction,
  type AssignmentArchiveWrite,
  type AssignmentRecord,
} from "../shared";

// Client-supplied request payload for assignmentsArchive. Only the target
// assignment identifier is carried. Ownership fields are never carried on
// the request and are derived server-side from the record.
export type AssignmentsArchiveRequest = {
  readonly assignmentId: string;
};

// Return payload of a successful archive call. `alreadyArchived` is
// `true` when the record is already in the terminal `archived` state and
// no write is required; `false` when this call advanced the lifecycle
// field to `archived`.
export type AssignmentsArchiveResponse = {
  readonly assignmentId: string;
  readonly status: "archived";
  readonly alreadyArchived: boolean;
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

function validateRequest(data: unknown): AssignmentsArchiveRequest {
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

// Test-only hooks (RA-3B certification). Awaited inside the archive
// transaction so emulator tests can force an exact interleaving with a
// concurrent publication without timing-dependent sleeps. `attempt` counts
// transaction attempts from 1. The deployed callable never passes hooks.
export type ArchiveTransactionHooks = {
  readonly afterRead?: (attempt: number) => Promise<void>;
  readonly afterWrites?: (attempt: number) => Promise<void>;
};

type ArchiveActor = { readonly uid: string; readonly schoolId: string; readonly districtId: string };

type ArchiveOutcome = { readonly kind: "alreadyArchived" } | { readonly kind: "archived" };

// assignmentsArchive
//
// Canonical terminal archive transition for assignments/{assignmentId}
// per Data Model §3.6 lifecycle. Callable by the owning teacher only.
// `archived` may be reached from `draft`, `published`, or `closed`; it is
// terminal.
//
// Every side effect flows through the canonical shared helpers, inside one
// `runFirestoreTransaction(...)` (RA-3B certification correction):
//   - record read via `assignmentDocRef(...)`                     (typed ref)
//   - narrow archive write via `assignmentArchiveDocRef(...)`     (typed ref)
//   - audit event via `writeAuditEventInTransaction(...)`         (§5 helper)
//
// Concurrency. The pre-correction handler read the record, then updated it
// and wrote the audit event separately. A publication committing between
// that read and write left the record archived but the audit recording
// `previousStatus: "draft"`. Now `previousStatus` is taken from the
// snapshot this transaction read and commits with the write; if any other
// write lands on the record first, Firestore re-runs the function, which
// re-reads, so the audit always names the state actually archived. The
// transaction performs no external side effect (logging happens after
// commit), so retries are safe. Contention that outlasts the SDK's retries
// is refused with `assignments.archiveConflict` and writes nothing.
//
// The Current pointer is not read or written here (unchanged).
//
// Idempotency: an already-`archived` record returns
// `alreadyArchived: true` with no second write and no second audit event.
async function archiveAssignment(
  request: CallableRequest<unknown>,
  hooks: ArchiveTransactionHooks,
): Promise<AssignmentsArchiveResponse> {
  const actor = await assertActiveTeacherInDistrict(request);
  const input = validateRequest(request.data);

  let attempt = 0;
  let outcome: ArchiveOutcome;
  try {
    outcome = await runFirestoreTransaction(async (tx) => {
      attempt += 1;
      return archiveInTransaction(tx, input.assignmentId, actor, hooks, attempt);
    });
  } catch (err) {
    if (isTransactionContention(err)) {
      throw new PlatformError(
        "assignments.archiveConflict",
        "The assignment changed while it was being archived. Try again.",
      );
    }
    throw err;
  }

  if (outcome.kind === "alreadyArchived") {
    safeLog(() =>
      log.info("assignments.archiveIdempotent", {
        actorUserId: actor.uid,
        assignmentId: input.assignmentId,
      }),
    );
    return {
      assignmentId: input.assignmentId,
      status: "archived",
      alreadyArchived: true,
    };
  }

  safeLog(() =>
    log.info("assignments.archived", {
      actorUserId: actor.uid,
      assignmentId: input.assignmentId,
    }),
  );

  return {
    assignmentId: input.assignmentId,
    status: "archived",
    alreadyArchived: false,
  };
}

async function archiveInTransaction(
  tx: Transaction,
  assignmentId: string,
  actor: ArchiveActor,
  hooks: ArchiveTransactionHooks,
  attempt: number,
): Promise<ArchiveOutcome> {
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

  if (existing.status === "archived") return { kind: "alreadyArchived" };

  // `existing.status` narrows to `"draft" | "published" | "closed"` here
  // per the current `AssignmentStatus` enumeration. All three transition
  // to `archived` per §3.6.
  const write: AssignmentArchiveWrite = { status: "archived" };
  tx.update(assignmentArchiveDocRef(assignmentId), write);

  writeAuditEventInTransaction(tx, {
    actorUserId: actor.uid,
    actorRole: "teacher",
    action: "assignments.archived",
    targetType: "assignment",
    targetId: assignmentId,
    schoolId: actor.schoolId,
    districtId: actor.districtId,
    payload: { classId: existing.classId, previousStatus: existing.status },
  });

  if (hooks.afterWrites) await hooks.afterWrites(attempt);
  return { kind: "archived" };
}

async function assignmentsArchiveHandler(
  request: CallableRequest<unknown>,
): Promise<AssignmentsArchiveResponse> {
  return archiveAssignment(request, {});
}

export const assignmentsArchive = platformCallable(assignmentsArchiveHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assignmentsArchiveHandler = assignmentsArchiveHandler;

// RA-3B certification test seam: the same archive path with interleaving
// hooks. Not a callable and not exported from `src/index.ts`.
export const __archiveAssignmentWithHooks = archiveAssignment;
