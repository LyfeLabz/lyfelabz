import { FieldValue } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  TEACHER_UNIT_FIRST_ORDERED_POSITION,
  TEACHER_UNITS_REORDER_MAX,
  isTransactionContention,
  log,
  platformCallable,
  runFirestoreTransaction,
  teacherUnitUpdateDocRef,
  teacherUnitsCollectionRef,
  writeAuditEventInTransaction,
  type TeacherUnitGrade,
  type TeacherUnitRecord,
} from "../shared";
import {
  assertActiveTeacher,
  assertOnlyAllowedKeys,
  compareTeacherUnitViews,
  readGrade,
  readUnitId,
  reassertTeacherContextInTransaction,
  requestObject,
  safeLog,
  toTeacherUnitView,
  type TeacherUnitActor,
  type TeacherUnitView,
} from "./teacher-unit-access";
import { TEACHER_UNITS_LIST_MAX, listOwnedTeacherUnits } from "./teacher-units-list";

// teacherUnitsReorder - U1B ordering of one teacher-grade organization.
//
// The organization is every ACTIVE unit the caller owns, in their current
// canonical school, for one grade (what `teacherUnitsList({ grade })`
// returns). The request names that complete set, in the desired order,
// each with the revision the caller last observed. Unit `i` (0-based) is
// given `sortOrder = i + 1`.
//
// One Firestore transaction:
//   1. re-verify the caller's canonical authorization
//      (`reassertTeacherContextInTransaction`);
//   2. read the caller's units with the same owner-and-school query as
//      `teacherUnitsList` (no new index) and keep the active units of the
//      grade;
//   3. every requested id must be one of them (otherwise the uniform
//      `teacherUnits.notFound`: missing, another teacher's, another
//      school's, another grade's, or archived), and the request must name
//      all of them (otherwise `teacherUnits.writeConflict`: the caller's
//      view of the organization is stale, e.g. a unit was created or
//      restored since);
//   4. when every unit already holds its requested position, nothing is
//      written (no-op; revisions are not compared, as in U1A);
//   5. otherwise every requested `expectedRevision` must equal the stored
//      revision (`teacherUnits.writeConflict` with the first mismatch);
//   6. each unit whose position changes is written with its new
//      `sortOrder`, `revision + 1`, a server `updatedAt`, and one
//      `teacherUnits.reordered` audit event, all atomically. Units whose
//      position does not change are not written.
//
// Concurrency follows Firestore transaction serialization. Conflicting
// writes from the same revision cannot both commit: two different reorders
// of one organization, or a reorder and an edit to a unit it moves (the
// loser's read set moved, Firestore retries it, and the retry is refused on
// revision). Identical reorders may yield one write and one no-op. Every
// named revision is compared, but only moved units are written, so an edit
// to an unmoved unit may succeed alongside a reorder. A concurrent create
// or restore in the grade either precedes the snapshot (the reorder is
// refused as stale) or follows it (both succeed). Archived units are never written by a
// reorder; they keep their `sortOrder` through archive and restore, and a
// restored unit is placed by that preserved value (ties: creation time,
// then id) until the next reorder.

export type TeacherUnitsReorderRequest = {
  readonly grade: TeacherUnitGrade;
  readonly units: ReadonlyArray<{ readonly unitId: string; readonly expectedRevision: number }>;
};

export type TeacherUnitsReorderResponse = {
  // The grade organization (active units) in canonical order.
  readonly units: readonly TeacherUnitView[];
  // True when every unit already held its requested position.
  readonly noop: boolean;
};

type OrderEntry = { readonly unitId: string; readonly expectedRevision: number };

function readOrderEntry(value: unknown): OrderEntry {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PlatformError(
      "teacherUnits.invalidUnitOrder",
      "Each units entry must be an object with unitId and expectedRevision.",
    );
  }
  const entry = value as Record<string, unknown>;
  const extra = Object.keys(entry).filter((k) => k !== "unitId" && k !== "expectedRevision");
  if (extra.length > 0) {
    throw new PlatformError(
      "teacherUnits.invalidRequest",
      `Unsupported units entry field(s): ${extra.join(", ")}.`,
    );
  }
  const expectedRevision = entry.expectedRevision;
  if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new PlatformError(
      "teacherUnits.invalidExpectedRevision",
      "expectedRevision must be a positive integer.",
    );
  }
  return { unitId: readUnitId(entry), expectedRevision };
}

export function readUnitOrder(value: unknown): readonly OrderEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PlatformError("teacherUnits.invalidUnitOrder", "units must be a non-empty array.");
  }
  if (value.length > TEACHER_UNITS_REORDER_MAX) {
    throw new PlatformError(
      "teacherUnits.invalidUnitOrder",
      `At most ${String(TEACHER_UNITS_REORDER_MAX)} units can be ordered in one request.`,
    );
  }
  const entries = (value as unknown[]).map(readOrderEntry);
  const seen = new Set<string>();
  for (const { unitId } of entries) {
    if (seen.has(unitId)) {
      throw new PlatformError("teacherUnits.invalidUnitOrder", "Each unit can appear only once.");
    }
    seen.add(unitId);
  }
  return entries;
}

function validateRequest(data: unknown): TeacherUnitsReorderRequest {
  const payload = requestObject(data);
  assertOnlyAllowedKeys(payload, ["grade", "units"]);
  return { grade: readGrade(payload.grade), units: readUnitOrder(payload.units) };
}

type Outcome =
  | { readonly wrote: false; readonly units: readonly TeacherUnitView[] }
  | { readonly wrote: true; readonly moved: number };

// Test seam only: runs between the commit and the response read.
export type TeacherUnitReorderHooks = {
  readonly afterCommit?: () => Promise<void>;
};

export async function reorderTeacherUnits(
  actor: TeacherUnitActor,
  input: TeacherUnitsReorderRequest,
  hooks: TeacherUnitReorderHooks = {},
): Promise<TeacherUnitsReorderResponse> {
  let outcome: Outcome;
  try {
    outcome = await runFirestoreTransaction<Outcome>(async (tx) => {
      const verified = await reassertTeacherContextInTransaction(tx, actor);
      const snapshot = await tx.get(
        teacherUnitsCollectionRef()
          .where("teacherId", "==", verified.uid)
          .where("schoolId", "==", verified.schoolId)
          .limit(TEACHER_UNITS_LIST_MAX + 1),
      );
      if (snapshot.docs.length > TEACHER_UNITS_LIST_MAX) {
        throw new PlatformError(
          "teacherUnits.listLimitExceeded",
          "Too many units to order in one request.",
        );
      }
      const organization = new Map<string, TeacherUnitRecord>();
      for (const doc of snapshot.docs) {
        const record = doc.data();
        if (
          record.teacherId === verified.uid &&
          record.schoolId === verified.schoolId &&
          record.grade === input.grade &&
          record.status === "active"
        ) {
          organization.set(doc.id, record);
        }
      }

      for (const { unitId } of input.units) {
        if (!organization.has(unitId)) {
          throw new PlatformError("teacherUnits.notFound", "Unit was not found.");
        }
      }
      if (organization.size !== input.units.length) {
        throw new PlatformError(
          "teacherUnits.writeConflict",
          "The grade's units changed. Reload them and try again.",
        );
      }

      const moves = input.units
        .map((entry, index) => ({
          ...entry,
          current: organization.get(entry.unitId) as TeacherUnitRecord,
          sortOrder: TEACHER_UNIT_FIRST_ORDERED_POSITION + index,
        }))
        .filter((move) => move.current.sortOrder !== move.sortOrder);

      if (moves.length === 0) {
        return {
          wrote: false,
          units: [...organization]
            .map(([id, record]) => toTeacherUnitView(id, record))
            .sort(compareTeacherUnitViews),
        };
      }

      for (const { unitId, expectedRevision } of input.units) {
        const currentRevision = (organization.get(unitId) as TeacherUnitRecord).revision;
        if (currentRevision !== expectedRevision) {
          throw new PlatformError(
            "teacherUnits.writeConflict",
            "expectedRevision does not match the unit's current revision.",
            undefined,
            { unitId, currentRevision },
          );
        }
      }

      for (const move of moves) {
        const revision = move.current.revision + 1;
        tx.update(teacherUnitUpdateDocRef(move.unitId), {
          sortOrder: move.sortOrder,
          updatedAt: FieldValue.serverTimestamp(),
          revision,
        });
        writeAuditEventInTransaction(tx, {
          actorUserId: verified.uid,
          actorRole: "teacher",
          action: "teacherUnits.reordered",
          targetType: "teacherUnit",
          targetId: move.unitId,
          schoolId: verified.schoolId,
          districtId: verified.districtId,
          payload: {
            grade: input.grade,
            previousRevision: move.current.revision,
            revision,
            previousSortOrder: move.current.sortOrder,
            sortOrder: move.sortOrder,
          },
        });
      }
      return { wrote: true, moved: moves.length };
    });
  } catch (err) {
    if (isTransactionContention(err)) {
      throw new PlatformError(
        "teacherUnits.writeConflict",
        "The units changed while they were being reordered. Reload them and try again.",
        err,
      );
    }
    throw err;
  }

  if (!outcome.wrote) {
    safeLog(() => log.info("teacherUnits.reorderNoop", { actorUserId: actor.uid, grade: input.grade }));
    return { units: outcome.units, noop: true };
  }

  const moved = outcome.moved;
  safeLog(() =>
    log.info("teacherUnits.reordered", { actorUserId: actor.uid, grade: input.grade, moved }),
  );
  if (hooks.afterCommit) await hooks.afterCommit();

  // Post-commit authorized read (same contract as U1A mutations).
  const units = await listOwnedTeacherUnits(actor, { includeArchived: false, grade: input.grade });
  return { units, noop: false };
}

async function teacherUnitsReorderHandler(
  request: CallableRequest<unknown>,
): Promise<TeacherUnitsReorderResponse> {
  const actor = await assertActiveTeacher(request);
  const input = validateRequest(request.data);
  return reorderTeacherUnits(actor, input);
}

export const teacherUnitsReorder = platformCallable(teacherUnitsReorderHandler);

// Exported for direct testing without the callable wrapper.
export const __teacherUnitsReorderHandler = teacherUnitsReorderHandler;
