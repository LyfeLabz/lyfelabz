import { randomBytes } from "node:crypto";

import { type CallableRequest } from "firebase-functions/v2/https";

import {
  assertClassSupports,
  classActivationDocRef,
  classDocRef,
  classesCollectionRef,
  log,
  platformCallable,
  PlatformError,
  requireDistrictContext,
  runFirestoreTransaction,
  writeAuditEvent,
  type ClassActivationWrite,
} from "../shared";

// classesActivate
//
// Sprint 24B Phase 2B.3 - narrow activation callable per Phase 2B
// Implementation Specification §5.3, §7.5, and §8.
//
// Atomically transitions a teacher-owned `needsSetup` class to `active`
// after the teacher confirms `grade` and `block`. Inside a single
// Firestore transaction, `{ status, grade, block, joinCode }` are written
// together, so the four fields become observable at the same instant.
// The class is never observable as:
//   - active without grade
//   - active without block
//   - active without joinCode
//   - needsSetup with a persisted grade/block that were written outside
//     the activation transaction
//
// Darkness: no production client invokes this callable in Phase 2B.3. The
// client swap and workspace setup form land in Phase 2B.4.
//
// Idempotency (Spec §8.6, §10):
//   - Already-active with matching grade and block: return the existing
//     joinCode without a second write and without a second audit event.
//     The join code is NOT rotated.
//   - Already-active with differing grade or block: reject with
//     `classes.alreadyActiveConflict` per §10. Preserve the existing
//     class; activation is not the metadata-editing seam.
//   - Archived: reject with `classes.notActivatable` via
//     `assertClassSupports("activate", record)`.
//   - Not-found: reject with `classes.notFound`.
//
// Teacher preference (Spec §8.10, §9.6): the callable does NOT touch the
// teacher preference document. `defaultGrade` follow-up is a best-effort
// client-side write performed by the Phase 2B.4 workspace setup form
// after `classesActivate` returns successfully. Keeping the preference
// write outside the activation transaction guarantees a preference-storage
// failure can never fail activation, never rotate the join code, and never
// produce a partial write.

export type ClassesActivateRequest = {
  readonly classId: string;
  readonly grade: "6" | "7" | "8";
  readonly block: "A" | "B" | "C" | "D" | "E" | "F" | "G";
};

// Sprint 24B Phase 2B.7 joinCode invariant applies. `joinCode` is a
// non-empty string for manual activations and `null` for LMS activations.
// The client narrows on this field to decide whether to render the
// student join-code affordance after activation.
export type ClassesActivateResponse = {
  readonly classId: string;
  readonly status: "active";
  readonly joinCode: string | null;
  readonly alreadyActive: boolean;
};

const CLASS_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;
const BLOCK_PATTERN = /^[A-G]$/;
const GRADES: readonly ("6" | "7" | "8")[] = Object.freeze(["6", "7", "8"]);

// Fixed retry cap for join-code collision, per Spec §5.3 recommendation
// (N = 5). Sufficient given the 32-bit code space over a single school.
const JOIN_CODE_MAX_ATTEMPTS = 5;

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
  return {
    uid: context.uid,
    schoolId: context.schoolId,
    districtId: context.districtId,
  };
}

function validateRequest(data: unknown): ClassesActivateRequest {
  if (data === null || typeof data !== "object") {
    throw new PlatformError(
      "classes.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;

  if (!isNonEmptyString(payload.classId)) {
    throw new PlatformError(
      "classes.invalidClassId",
      "classId must be a non-empty string.",
    );
  }
  const classId = payload.classId.trim();
  if (!CLASS_ID_PATTERN.test(classId)) {
    throw new PlatformError(
      "classes.invalidClassId",
      "classId must be a URL-safe token (letters, digits, hyphens, underscores).",
    );
  }

  const rawGrade = payload.grade;
  if (!isNonEmptyString(rawGrade)) {
    throw new PlatformError(
      "classes.invalidGrade",
      "grade must be one of 6, 7, 8.",
    );
  }
  const grade = rawGrade.trim();
  if (!(GRADES as readonly string[]).includes(grade)) {
    throw new PlatformError(
      "classes.invalidGrade",
      "grade must be one of 6, 7, 8.",
    );
  }

  const rawBlock = payload.block;
  if (!isNonEmptyString(rawBlock)) {
    throw new PlatformError(
      "classes.invalidBlock",
      "block must be a single letter A through G.",
    );
  }
  const block = rawBlock.trim().toUpperCase();
  if (!BLOCK_PATTERN.test(block)) {
    throw new PlatformError(
      "classes.invalidBlock",
      "block must be a single letter A through G.",
    );
  }

  return {
    classId,
    grade: grade as "6" | "7" | "8",
    block: block as "A" | "B" | "C" | "D" | "E" | "F" | "G",
  };
}

// Server-generated join code. Matches the eight-uppercase-hex format
// established by `classesCreate` in Sprint 4B so the join-code lookup
// path (`enrollmentsJoinByCode`) does not need to widen its
// JOIN_CODE_PATTERN.
function generateJoinCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

async function joinCodeIsUniqueInSchool(
  candidate: string,
  schoolId: string,
): Promise<boolean> {
  const snapshot = await classesCollectionRef()
    .where("joinCode", "==", candidate)
    .where("schoolId", "==", schoolId)
    .limit(1)
    .get();
  return snapshot.empty;
}

async function allocateJoinCode(schoolId: string): Promise<string> {
  for (let attempt = 0; attempt < JOIN_CODE_MAX_ATTEMPTS; attempt += 1) {
    const candidate = generateJoinCode();
    // eslint-disable-next-line no-await-in-loop
    if (await joinCodeIsUniqueInSchool(candidate, schoolId)) {
      return candidate;
    }
  }
  throw new PlatformError(
    "classes.joinCodeGenerationFailed",
    "Could not allocate a join code; try again.",
  );
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

async function classesActivateHandler(
  request: CallableRequest<unknown>,
): Promise<ClassesActivateResponse> {
  const actor = await assertActiveTeacherInDistrict(request);
  const input = validateRequest(request.data);

  // Load the class outside the transaction for early ownership and
  // status validation. The activation transaction re-reads the class
  // under transactional isolation before any write, so a concurrent
  // mutation between these two reads cannot produce a partial state
  // (see the transaction body below).
  const preSnapshot = await classDocRef(input.classId).get();
  if (!preSnapshot.exists) {
    throw new PlatformError("classes.notFound", "Class was not found.");
  }
  const preRecord = preSnapshot.data();
  if (!preRecord) {
    throw new PlatformError("classes.notFound", "Class record was empty.");
  }
  if (
    preRecord.teacherId !== actor.uid ||
    preRecord.schoolId !== actor.schoolId
  ) {
    throw new PlatformError(
      "classes.forbidden",
      "Caller does not own this class.",
    );
  }

  // Shared eligibility gate. Rejects `archived` with
  // `classes.notActivatable`; permits `active` (idempotent) and
  // `needsSetup` (the ordinary transition).
  assertClassSupports("activate", preRecord);

  // Sprint 24B Phase 2B.7 joinCode invariant. `joinCode` is present for
  // manual classes and absent for LMS-sourced classes. The decision is
  // made from the pre-transaction record's `enrollmentSource`; the field
  // is immutable after creation (there is no writer that flips it), so
  // the pre-transaction read is sufficient and re-reading inside the
  // transaction would not surface a different value.
  const isLmsSourced = preRecord.enrollmentSource === "lms";

  // Already-active handling per Spec §10 (ratified idempotency behavior).
  if (preRecord.status === "active") {
    if (preRecord.grade !== input.grade || preRecord.block !== input.block) {
      throw new PlatformError(
        "classes.alreadyActiveConflict",
        "Class is already active with different grade or block.",
      );
    }
    safeLog(() =>
      log.info("classes.activateIdempotent", {
        actorUserId: actor.uid,
        classId: input.classId,
      }),
    );
    return {
      classId: input.classId,
      status: "active",
      joinCode: preRecord.joinCode ?? null,
      alreadyActive: true,
    };
  }

  // Allocate a collision-free join code before opening the transaction,
  // but only for manual classes. LMS-sourced classes must never receive
  // a joinCode per Phase 2B.7. Per Spec §8.5 note 4a, join-code collision
  // is a non-key indexed query that cannot execute inside a transaction;
  // the transaction body below is the atomicity boundary for the class
  // write itself.
  const joinCode = isLmsSourced ? null : await allocateJoinCode(actor.schoolId);

  // Atomic `{ status, grade, block, joinCode? }` write. `joinCode` is
  // omitted from the write shape for LMS-sourced classes.
  const transactionResult = await runFirestoreTransaction(async (tx) => {
    const snapshot = await tx.get(classDocRef(input.classId));
    if (!snapshot.exists) {
      throw new PlatformError(
        "classes.notFound",
        "Class was not found.",
      );
    }
    const record = snapshot.data();
    if (!record) {
      throw new PlatformError(
        "classes.notFound",
        "Class record was empty.",
      );
    }
    if (
      record.teacherId !== actor.uid ||
      record.schoolId !== actor.schoolId
    ) {
      throw new PlatformError(
        "classes.forbidden",
        "Caller does not own this class.",
      );
    }

    // Re-check under transactional isolation. If a concurrent write
    // already transitioned the class to `active`, honor the same
    // idempotent-vs-conflict distinction as the pre-transaction path
    // and abandon this transaction's minted join code (if any).
    if (record.status === "active") {
      const active = record;
      if (active.grade !== input.grade || active.block !== input.block) {
        throw new PlatformError(
          "classes.alreadyActiveConflict",
          "Class is already active with different grade or block.",
        );
      }
      return {
        wrote: false as const,
        joinCode: active.joinCode ?? null,
      };
    }

    // `assertClassSupports("activate", record)` narrows to
    // `active | needsSetup`; the branch above handles active. Anything
    // else (archived) would have been rejected in the pre-transaction
    // check; a concurrent archive between the two reads surfaces here.
    if (record.status !== "needsSetup") {
      throw new PlatformError(
        "classes.notActivatable",
        "Class cannot be activated in its current state.",
      );
    }

    const write: ClassActivationWrite = {
      status: "active",
      grade: input.grade,
      block: input.block,
      ...(joinCode !== null ? { joinCode } : {}),
    };
    tx.update(classActivationDocRef(input.classId), write);
    return { wrote: true as const, joinCode };
  });

  if (transactionResult.wrote) {
    await writeAuditEvent({
      actorUserId: actor.uid,
      actorRole: "teacher",
      action: "classes.activated",
      targetType: "class",
      targetId: input.classId,
      schoolId: actor.schoolId,
      districtId: actor.districtId,
      payload: {
        previousStatus: "needsSetup",
        grade: input.grade,
        block: input.block,
      },
    });

    safeLog(() =>
      log.info("classes.activated", {
        actorUserId: actor.uid,
        classId: input.classId,
        schoolId: actor.schoolId,
        districtId: actor.districtId,
      }),
    );
  } else {
    // Concurrent-write idempotent branch: match the pre-transaction
    // already-active behavior. No audit is emitted for an idempotent
    // return, matching `classesArchive`'s already-archived posture.
    safeLog(() =>
      log.info("classes.activateIdempotent", {
        actorUserId: actor.uid,
        classId: input.classId,
      }),
    );
  }

  return {
    classId: input.classId,
    status: "active",
    joinCode: transactionResult.joinCode,
    alreadyActive: !transactionResult.wrote,
  };
}

export const classesActivate = platformCallable(classesActivateHandler);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __classesActivateHandler = classesActivateHandler;
