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
  type TeacherUnitColor,
  type TeacherUnitGrade,
} from "../shared";
import {
  PRODUCTION_TEACHER_UNITS_ENFORCEMENT,
  type A3Scope,
  type TeacherUnitsEnforcement,
  readCompatibility,
  requireRuntimeIdentity,
  respondAfterCommit,
} from "./a3-enforcement";
import type { MutationCompatibilityV2 } from "./availability-protocol";
import {
  assertActiveTeacher,
  assertOnlyAllowedKeys,
  assertOwnedUnit,
  authorizeTeacherUnitsTransaction,
  readColor,
  readDescription,
  readExpectedSchoolId,
  readGrade,
  readIdempotencyKey,
  readOwnedTeacherUnit,
  readTitle,
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
// transaction the handler runs the A3-3 authoritative prefix (runtime
// identity, the caller's canonical authorization, uncached availability and
// the compatibility envelope; `authorizeTeacherUnitsTransaction`), then reads
// the receipt
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
//
// School binding (U2.2; required by the A3 v2 contract). Because the receipt
// is scoped to the verified school, a same-key retry after a school transfer
// finds no receipt in the new school and would create a second unit there.
// Every request therefore carries `expectedSchoolId` (the school its create
// intent was made in); a missing or malformed value is refused before any
// transaction. Inside the transaction, right after the authorization
// snapshot and BEFORE the receipt is read or anything is written,
// `expectedSchoolId` must equal the verified school, or the request is
// refused with `teacherUnits.schoolContextChanged`. This applies to first
// creates and same-key replays alike. The field is only compared; the school
// written to the unit, receipt, and audit event is always the
// server-verified one. Neither it nor the compatibility envelope is part of
// the request hash or the receipt identity.
//
// Firestore SDK reruns (approved A3-3 Option A): a rerun after an earlier
// attempt actually committed finds this key's receipt and replays the
// original unit, with no second unit, receipt or audit. A refusal raised
// inside the transaction is not proof that nothing was written by this
// request. The bounded ALREADY_EXISTS loop below is not a resubmission after
// an uncertain outcome: ALREADY_EXISTS is a definite precondition failure of
// a transaction that did not commit. After a confirmed commit, a failed
// response read becomes `teacherUnits.responseUnavailable` (outcome
// unconfirmed); the unit, receipt and audit stand.

export type TeacherUnitsCreateRequest = {
  readonly grade: TeacherUnitGrade;
  readonly title: string;
  readonly description?: string;
  // Optional unit color token; absent or null creates a neutral unit.
  readonly color?: TeacherUnitColor | null;
  readonly idempotencyKey: string;
  // Required: the school the create intent was made in. Compared with the
  // verified school; never used as the write's school.
  readonly expectedSchoolId: string;
  readonly compatibility: MutationCompatibilityV2;
};

export type TeacherUnitsCreateResponse = {
  readonly unit: TeacherUnitView;
  // True when this key already created the unit and nothing new was written.
  readonly replayed: boolean;
};

const ALLOWED_KEYS: readonly string[] = [
  "grade",
  "title",
  "description",
  "color",
  "idempotencyKey",
  "expectedSchoolId",
  "compatibility",
];

type ValidatedCreate = {
  readonly grade: TeacherUnitGrade;
  readonly title: string;
  readonly description: string;
  // Absent or null: a neutral unit.
  readonly color?: TeacherUnitColor | null;
  readonly idempotencyKey: string;
  readonly expectedSchoolId: string;
  readonly compatibility: MutationCompatibilityV2;
};

function validateRequest(data: unknown): ValidatedCreate {
  const payload = requestObject(data);
  assertOnlyAllowedKeys(payload, ALLOWED_KEYS);
  const compatibility = readCompatibility(payload);
  const grade = readGrade(payload.grade);
  const title = readTitle(payload.title);
  const description =
    payload.description === undefined ? "" : readDescription(payload.description);
  const color = payload.color === undefined ? null : readColor(payload.color);
  const idempotencyKey = readIdempotencyKey(payload);
  const expectedSchoolId = readExpectedSchoolId(payload);
  return { grade, title, description, color, idempotencyKey, expectedSchoolId, compatibility };
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
// `" Energy "` and `"Energy"` are the same request. Only the create intent
// participates: never `expectedSchoolId` or the compatibility envelope.
// A neutral (colorless) create hashes exactly as before colors existed, so a
// retry of a pre-color receipt still matches; a color joins only when set.
export function teacherUnitCreateRequestHash(
  input: Pick<ValidatedCreate, "grade" | "title" | "description"> & {
    readonly color?: TeacherUnitColor | null;
  },
): string {
  const color = input.color ?? null;
  return sha256Hex(
    JSON.stringify(
      color === null
        ? [input.grade, input.title, input.description]
        : [input.grade, input.title, input.description, color],
    ),
  );
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
  scope: A3Scope,
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
        const verified = await authorizeTeacherUnitsTransaction(tx, scope, actor, input.compatibility);
        // School binding: refused before the receipt read and before any
        // write is staged, for first creates and replays alike.
        if (input.expectedSchoolId !== verified.schoolId) {
          throw new PlatformError(
            "teacherUnits.schoolContextChanged",
            "The caller's school is not the school this request was made in.",
          );
        }
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
          ...(input.color !== undefined && input.color !== null ? { color: input.color } : {}),
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
  return respondAfterCommit("create", { actorUserId: actor.uid, unitId }, async () => {
    if (hooks.afterCommit) await hooks.afterCommit();
    return { unit: await readOwnedTeacherUnit(scope, actor, unitId), replayed: false };
  });
}

// Handler factory. Exported callables bind PRODUCTION_TEACHER_UNITS_ENFORCEMENT;
// other wiring exists only for server-side tests.
export function createTeacherUnitsCreateHandler(enforcement: TeacherUnitsEnforcement) {
  return async function teacherUnitsCreateHandler(
    request: CallableRequest<unknown>,
  ): Promise<TeacherUnitsCreateResponse> {
    const identity = await requireRuntimeIdentity(enforcement, "teacherUnitsCreate");
    const actor = await assertActiveTeacher(request);
    const input = validateRequest(request.data);
    const scope = { identity, enforcement, endpoint: "teacherUnitsCreate" } as const;
    return createTeacherUnit(scope, actor, input);
  };
}

const teacherUnitsCreateHandler = createTeacherUnitsCreateHandler(PRODUCTION_TEACHER_UNITS_ENFORCEMENT);

export const teacherUnitsCreate = platformCallable({ maxInstances: 20 }, teacherUnitsCreateHandler);

// Exported for direct testing without the callable wrapper.
export const __teacherUnitsCreateHandler = teacherUnitsCreateHandler;
