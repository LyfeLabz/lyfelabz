import { type CallableRequest } from "firebase-functions/v2/https";

import { platformCallable } from "../shared";
import {
  assertActiveTeacher,
  assertOnlyAllowedKeys,
  readOwnedTeacherUnit,
  readUnitId,
  requestObject,
  type TeacherUnitView,
} from "./teacher-unit-access";

// teacherUnitsGet - U1A. Returns one of the caller's own units, active or
// archived. A missing unit, another teacher's unit, and a unit from another
// school are the same `teacherUnits.notFound` refusal. The caller's
// canonical authorization (user, school, district) and the unit are read
// in one transaction snapshot (`readOwnedTeacherUnit`), so a suspension,
// role change, school transfer, or school/district change committed before
// that snapshot is honored.

export type TeacherUnitsGetRequest = {
  readonly unitId: string;
};

export type TeacherUnitsGetResponse = {
  readonly unit: TeacherUnitView;
};

async function teacherUnitsGetHandler(
  request: CallableRequest<unknown>,
): Promise<TeacherUnitsGetResponse> {
  const actor = await assertActiveTeacher(request);
  const payload = requestObject(request.data);
  assertOnlyAllowedKeys(payload, ["unitId"]);
  const unitId = readUnitId(payload);
  return { unit: await readOwnedTeacherUnit(actor, unitId) };
}

export const teacherUnitsGet = platformCallable(teacherUnitsGetHandler);

// Exported for direct testing without the callable wrapper.
export const __teacherUnitsGetHandler = teacherUnitsGetHandler;
