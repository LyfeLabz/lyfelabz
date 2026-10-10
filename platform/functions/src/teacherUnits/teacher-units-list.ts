import { type CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  platformCallable,
  runFirestoreTransaction,
  teacherUnitsCollectionRef,
  type TeacherUnitGrade,
} from "../shared";
import {
  assertActiveTeacher,
  assertOnlyAllowedKeys,
  compareTeacherUnitViews,
  readGrade,
  reassertTeacherContextInTransaction,
  requestObject,
  toTeacherUnitView,
  type TeacherUnitActor,
  type TeacherUnitView,
} from "./teacher-unit-access";

// teacherUnitsList - U1A. Lists the caller's own units.
//
// The query is scoped to the authoritative owner AND school: two equality
// filters, `teacherId == caller uid` and `schoolId == caller's canonical
// school` (served by single-field indexes; no composite index, no
// ordering clause). Units the teacher created at a previous school are
// never read. The query runs in the same transaction snapshot that
// re-verifies the caller's canonical authorization (user, school,
// district), so a revocation committed before that snapshot is honored.
//
// Archived units are excluded unless `includeArchived` is true; `grade`
// optionally narrows to one grade. Both filters apply in memory AFTER the
// overflow check, so the ceiling bounds everything the teacher owns in the
// school, not the filtered subset. Results are in canonical order
// (sortOrder, createdAt, unitId).

export type TeacherUnitsListRequest = {
  readonly includeArchived?: boolean;
  readonly grade?: string;
};

export type TeacherUnitsListResponse = {
  readonly units: readonly TeacherUnitView[];
};

// Defensive read ceiling. Far above any realistic per-teacher unit count;
// exceeding it is refused rather than silently truncated: the query reads
// at most MAX + 1 documents, and MAX + 1 results means overflow.
export const TEACHER_UNITS_LIST_MAX = 1000;

export type TeacherUnitsListOptions = {
  readonly includeArchived: boolean;
  readonly grade: TeacherUnitGrade | undefined;
  // Test seam only; production always uses TEACHER_UNITS_LIST_MAX.
  readonly max?: number;
};

export async function listOwnedTeacherUnits(
  actor: TeacherUnitActor,
  options: TeacherUnitsListOptions,
): Promise<readonly TeacherUnitView[]> {
  const max = options.max ?? TEACHER_UNITS_LIST_MAX;
  const { verified, docs } = await runFirestoreTransaction(async (tx) => {
    const context = await reassertTeacherContextInTransaction(tx, actor);
    const snapshot = await tx.get(
      teacherUnitsCollectionRef()
        .where("teacherId", "==", context.uid)
        .where("schoolId", "==", context.schoolId)
        .limit(max + 1),
    );
    return {
      verified: context,
      docs: snapshot.docs.map((doc) => ({ id: doc.id, record: doc.data() })),
    };
  });
  if (docs.length > max) {
    throw new PlatformError(
      "teacherUnits.listLimitExceeded",
      "Too many units to list in one request.",
    );
  }
  return docs
    .filter(({ record }) => record.teacherId === verified.uid && record.schoolId === verified.schoolId)
    .filter(({ record }) => options.includeArchived || record.status === "active")
    .filter(({ record }) => options.grade === undefined || record.grade === options.grade)
    .map(({ id, record }) => toTeacherUnitView(id, record))
    .sort(compareTeacherUnitViews);
}

async function teacherUnitsListHandler(
  request: CallableRequest<unknown>,
): Promise<TeacherUnitsListResponse> {
  const actor = await assertActiveTeacher(request);
  const payload = requestObject(request.data);
  assertOnlyAllowedKeys(payload, ["includeArchived", "grade"]);
  const includeArchived = payload.includeArchived ?? false;
  if (typeof includeArchived !== "boolean") {
    throw new PlatformError("teacherUnits.invalidRequest", "includeArchived must be a boolean.");
  }
  const grade = payload.grade === undefined ? undefined : readGrade(payload.grade);

  const units = await listOwnedTeacherUnits(actor, { includeArchived, grade });
  return { units };
}

export const teacherUnitsList = platformCallable(teacherUnitsListHandler);

// Exported for direct testing without the callable wrapper.
export const __teacherUnitsListHandler = teacherUnitsListHandler;
