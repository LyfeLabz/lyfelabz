import { FieldValue } from "firebase-admin/firestore";

import {
  PlatformError,
  isTransactionContention,
  log,
  runFirestoreTransaction,
  teacherUnitDocRef,
  teacherUnitUpdateDocRef,
  writeAuditEventInTransaction,
  type AuditAction,
  type TeacherUnitRecord,
  type TeacherUnitUpdateWrite,
} from "../shared";
import {
  assertOwnedUnit,
  readOwnedTeacherUnit,
  reassertTeacherContextInTransaction,
  safeLog,
  toTeacherUnitView,
  type TeacherUnitActor,
  type TeacherUnitView,
} from "./teacher-unit-access";

// U1A - the single compare-and-set core behind every mutation of an
// existing unit (rename, description edit, archive, restore).
//
// One Firestore transaction:
//   1. re-verify the caller's canonical authorization (active teacher, same
//      school, school still resolves to the verified district; see
//      `reassertTeacherContextInTransaction`);
//   2. read the unit and verify ownership (uniform `teacherUnits.notFound`);
//   3. ask the operation for its change against the CURRENT record. The
//      operation may refuse (e.g. editing an archived unit) or return
//      `null` when its result already holds;
//   4. `null` -> no-op: nothing is written, the revision is unchanged, no
//      audit event, and `expectedRevision` is not compared (no newer data
//      can be overwritten by a write that does not happen);
//   5. otherwise `expectedRevision` must equal the stored revision, or the
//      request is refused with `teacherUnits.writeConflict` carrying the
//      current revision;
//   6. write the change with `revision + 1` and a server `updatedAt`, and
//      append the audit event, atomically.
//
// Every refusal is thrown inside the transaction before any write is
// staged, so a refused request writes nothing. The no-op response is built
// from the same snapshot that authorized it. After a write, the response is
// produced by `readOwnedTeacherUnit` (a second consistent snapshot that
// re-verifies authorization), so a revocation committed between the write
// and the response read is honored: the write stands, and the response is
// refused.
//
// Because the comparison and the write share one transaction, two writers
// holding the same expected revision can never both commit: the second
// transaction's read set moved, so Firestore retries it, and the retry
// observes the new revision and is refused.

export type TeacherUnitChangeFields = Omit<TeacherUnitUpdateWrite, "updatedAt" | "revision">;

export type TeacherUnitChange = {
  readonly fields: TeacherUnitChangeFields;
  readonly action: AuditAction;
  readonly changedFields: readonly string[];
};

export type TeacherUnitMutationResponse = {
  readonly unit: TeacherUnitView;
  // True when the request wrote nothing because its result already held.
  readonly noop: boolean;
};

type Outcome =
  | { readonly wrote: false; readonly record: TeacherUnitRecord }
  | { readonly wrote: true; readonly revision: number; readonly change: TeacherUnitChange };

// Test seam only: runs between the commit and the response read.
export type TeacherUnitMutationHooks = {
  readonly afterCommit?: () => Promise<void>;
};

export async function mutateOwnedTeacherUnit(
  actor: TeacherUnitActor,
  unitId: string,
  expectedRevision: number,
  planChange: (current: TeacherUnitRecord) => TeacherUnitChange | null,
  hooks: TeacherUnitMutationHooks = {},
): Promise<TeacherUnitMutationResponse> {
  let outcome: Outcome;
  try {
    outcome = await runFirestoreTransaction<Outcome>(async (tx) => {
      const verified = await reassertTeacherContextInTransaction(tx, actor);

      const snapshot = await tx.get(teacherUnitDocRef(unitId));
      const current = snapshot.exists ? snapshot.data() : undefined;
      assertOwnedUnit(current, verified);

      const change = planChange(current);
      if (change === null) {
        return { wrote: false, record: current };
      }

      if (current.revision !== expectedRevision) {
        throw new PlatformError(
          "teacherUnits.writeConflict",
          "expectedRevision does not match the unit's current revision.",
          undefined,
          { currentRevision: current.revision },
        );
      }

      const revision = current.revision + 1;
      tx.update(teacherUnitUpdateDocRef(unitId), {
        ...change.fields,
        updatedAt: FieldValue.serverTimestamp(),
        revision,
      });
      writeAuditEventInTransaction(tx, {
        actorUserId: verified.uid,
        actorRole: "teacher",
        action: change.action,
        targetType: "teacherUnit",
        targetId: unitId,
        schoolId: verified.schoolId,
        districtId: verified.districtId,
        payload: {
          grade: current.grade,
          previousRevision: current.revision,
          revision,
          ...(change.action === "teacherUnits.updated"
            ? { changedFields: [...change.changedFields] }
            : {}),
        },
      });
      return { wrote: true, revision, change };
    });
  } catch (err) {
    if (isTransactionContention(err)) {
      throw new PlatformError(
        "teacherUnits.writeConflict",
        "The unit changed while it was being updated. Reload it and try again.",
        err,
      );
    }
    throw err;
  }

  if (!outcome.wrote) {
    safeLog(() =>
      log.info("teacherUnits.noop", { actorUserId: actor.uid, unitId, revision: outcome.record.revision }),
    );
    return { unit: toTeacherUnitView(unitId, outcome.record), noop: true };
  }

  safeLog(() =>
    log.info(outcome.change.action, { actorUserId: actor.uid, unitId, revision: outcome.revision }),
  );

  if (hooks.afterCommit) await hooks.afterCommit();

  // Post-commit authorized read so the response carries resolved server
  // timestamps. Under a concurrent later write this may already show a
  // newer revision; that newer state is the correct base for the caller's
  // next request.
  return { unit: await readOwnedTeacherUnit(actor, unitId), noop: false };
}
