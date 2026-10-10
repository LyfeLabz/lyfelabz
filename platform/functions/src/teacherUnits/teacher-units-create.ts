import { createHash } from "node:crypto";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  TEACHER_UNIT_CREATE_RECEIPT_RETENTION_MS,
  TEACHER_UNIT_DEFAULT_SORT_ORDER,
  TEACHER_UNIT_INITIAL_REVISION,
  isTransactionContention,
  log,
  platformCallable,
  runFirestoreTransaction,
  teacherUnitCreateReceiptCreationDocRef,
  teacherUnitCreateReceiptDocRef,
  teacherUnitCreationDocRef,
  teacherUnitDocRef,
  teacherUnitsCollectionRef,
  writeAuditEventInTransaction,
  type TeacherUnitGrade,
} from "../shared";
import {
  assertActiveTeacher,
  assertOnlyAllowedKeys,
  assertOwnedUnit,
  readDescription,
  readGrade,
  readIdempotencyKey,
  readOwnedTeacherUnit,
  readTitle,
  reassertTeacherContextInTransaction,
  requestObject,
  safeLog,
  toTeacherUnitView,
  type TeacherUnitActor,
  type TeacherUnitView,
} from "./teacher-unit-access";

// teacherUnitsCreate - U1A. Creates one active unit owned by the caller.
//
// `teacherId` and `schoolId` come only from the caller's verified canonical
// identity; a request naming either (or any other server-owned field) is
// rejected. The id is server-generated (Firestore auto-id) and written
// with `Transaction.create()`, so it can never overwrite an existing
// record. The record starts at revision 1 with `resourceIds: []` and the
// U1A `sortOrder` placeholder.
//
// Retry safety. Every request carries a client `idempotencyKey`. Inside ONE
// transaction the handler re-verifies the caller's canonical authorization
// (user, school, district), then reads the receipt
// `teacherUnitCreateReceipts/{sha256(teacherId, schoolId, key)}`:
//   - absent: create the unit, the receipt, and the `teacherUnits.created`
//     audit event atomically;
//   - present with the same normalized request hash: a replay. Nothing is
//     written and no audit event is emitted; the response is the ORIGINAL
//     unit (same `unitId`, current state) with `replayed: true`;
//   - present with a different hash: `teacherUnits.idempotencyKeyConflict`.
// Two simultaneous requests with one key contend on the same receipt
// document; exactly one commits, and the other re-runs and replays it.
// Deduplication is by key only, never by title. A replay is authorized
// exactly like a first request (refusals are evaluated before the receipt
// is read). See docs/platform/TEACHER_UNITS.md.

export type TeacherUnitsCreateRequest = {
  readonly grade: TeacherUnitGrade;
  readonly title: string;
  readonly description?: string;
  readonly idempotencyKey: string;
};

export type TeacherUnitsCreateResponse = {
  readonly unit: TeacherUnitView;
  // True when this key already created the unit and nothing new was written.
  readonly replayed: boolean;
};

const ALLOWED_KEYS: readonly string[] = ["grade", "title", "description", "idempotencyKey"];

type ValidatedCreate = Required<TeacherUnitsCreateRequest>;

function validateRequest(data: unknown): ValidatedCreate {
  const payload = requestObject(data);
  assertOnlyAllowedKeys(payload, ALLOWED_KEYS);
  return {
    grade: readGrade(payload.grade),
    title: readTitle(payload.title),
    description: payload.description === undefined ? "" : readDescription(payload.description),
    idempotencyKey: readIdempotencyKey(payload),
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// Receipt id: scoped to the authoritative teacher and school. JSON array
// encoding keeps the three components unambiguous.
export function teacherUnitCreateReceiptId(
  teacherId: string,
  schoolId: string,
  idempotencyKey: string,
): string {
  return sha256Hex(JSON.stringify(["teacherUnitsCreate", teacherId, schoolId, idempotencyKey]));
}

// Hash of the NORMALIZED request (after trimming and defaulting), so
// `" Energy "` and `"Energy"` are the same request.
export function teacherUnitCreateRequestHash(input: ValidatedCreate): string {
  return sha256Hex(JSON.stringify([input.grade, input.title, input.description]));
}

// gRPC ALREADY_EXISTS: a `create()` lost to a concurrent commit of the same
// document. For the receipt, that commit is a concurrent request with the
// same key; re-running the transaction replays it.
const FIRESTORE_ALREADY_EXISTS = 6;

function isAlreadyExists(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === FIRESTORE_ALREADY_EXISTS || code === "already-exists" || code === "ALREADY_EXISTS";
}

type CreateOutcome =
  | { readonly replayed: false; readonly unitId: string }
  | { readonly replayed: true; readonly unit: TeacherUnitView };

// Test seam only: runs between the commit and the response read.
export type TeacherUnitCreateHooks = {
  readonly afterCommit?: () => Promise<void>;
};

const CREATE_ATTEMPTS = 2;

export async function createTeacherUnit(
  actor: TeacherUnitActor,
  input: ValidatedCreate,
  hooks: TeacherUnitCreateHooks = {},
): Promise<TeacherUnitsCreateResponse> {
  const receiptId = teacherUnitCreateReceiptId(actor.uid, actor.schoolId, input.idempotencyKey);
  const requestHash = teacherUnitCreateRequestHash(input);

  let outcome: CreateOutcome | undefined;
  for (let attempt = 1; outcome === undefined; attempt += 1) {
    const unitId = teacherUnitsCollectionRef().doc().id;
    try {
      outcome = await runFirestoreTransaction<CreateOutcome>(async (tx) => {
        const verified = await reassertTeacherContextInTransaction(tx, actor);
        const receiptSnapshot = await tx.get(teacherUnitCreateReceiptDocRef(receiptId));
        const receipt = receiptSnapshot.exists ? receiptSnapshot.data() : undefined;

        if (receipt) {
          if (receipt.teacherId !== verified.uid || receipt.schoolId !== verified.schoolId) {
            // Unreachable for a sha-256 receipt id; refuse rather than trust it.
            throw new PlatformError(
              "teacherUnits.idempotencyKeyConflict",
              "idempotencyKey was already used for a different request.",
            );
          }
          if (receipt.requestHash !== requestHash) {
            throw new PlatformError(
              "teacherUnits.idempotencyKeyConflict",
              "idempotencyKey was already used for a different request.",
            );
          }
          const unitSnapshot = await tx.get(teacherUnitDocRef(receipt.unitId));
          const record = unitSnapshot.exists ? unitSnapshot.data() : undefined;
          assertOwnedUnit(record, verified);
          return { replayed: true, unit: toTeacherUnitView(receipt.unitId, record) };
        }

        const now = FieldValue.serverTimestamp();
        tx.create(teacherUnitCreationDocRef(unitId), {
          teacherId: verified.uid,
          schoolId: verified.schoolId,
          grade: input.grade,
          title: input.title,
          description: input.description,
          status: "active",
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
          resourceIds: [],
          sortOrder: TEACHER_UNIT_DEFAULT_SORT_ORDER,
          revision: TEACHER_UNIT_INITIAL_REVISION,
        });
        tx.create(teacherUnitCreateReceiptCreationDocRef(receiptId), {
          teacherId: verified.uid,
          schoolId: verified.schoolId,
          unitId,
          requestHash,
          createdAt: now,
          expiresAt: Timestamp.fromMillis(Date.now() + TEACHER_UNIT_CREATE_RECEIPT_RETENTION_MS),
        });
        writeAuditEventInTransaction(tx, {
          actorUserId: verified.uid,
          actorRole: "teacher",
          action: "teacherUnits.created",
          targetType: "teacherUnit",
          targetId: unitId,
          schoolId: verified.schoolId,
          districtId: verified.districtId,
          payload: { grade: input.grade, revision: TEACHER_UNIT_INITIAL_REVISION },
        });
        return { replayed: false, unitId };
      });
    } catch (err) {
      if (isAlreadyExists(err) && attempt < CREATE_ATTEMPTS) continue;
      if (isTransactionContention(err) || isAlreadyExists(err)) {
        throw new PlatformError(
          "teacherUnits.writeConflict",
          "The request could not be completed. Retry it with the same idempotencyKey.",
          err,
        );
      }
      throw err;
    }
  }

  if (outcome.replayed) {
    const unitId = outcome.unit.unitId;
    safeLog(() => log.info("teacherUnits.createReplayed", { actorUserId: actor.uid, unitId }));
    return { unit: outcome.unit, replayed: true };
  }

  const unitId = outcome.unitId;
  safeLog(() =>
    log.info("teacherUnits.created", { actorUserId: actor.uid, unitId, grade: input.grade }),
  );
  if (hooks.afterCommit) await hooks.afterCommit();
  return { unit: await readOwnedTeacherUnit(actor, unitId), replayed: false };
}

async function teacherUnitsCreateHandler(
  request: CallableRequest<unknown>,
): Promise<TeacherUnitsCreateResponse> {
  const actor = await assertActiveTeacher(request);
  const input = validateRequest(request.data);
  return createTeacherUnit(actor, input);
}

export const teacherUnitsCreate = platformCallable(teacherUnitsCreateHandler);

// Exported for direct testing without the callable wrapper.
export const __teacherUnitsCreateHandler = teacherUnitsCreateHandler;
