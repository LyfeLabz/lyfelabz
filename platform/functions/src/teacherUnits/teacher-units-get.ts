import { type CallableRequest } from "firebase-functions/v2/https";

import { platformCallable } from "../shared";
import {
  PRODUCTION_TEACHER_UNITS_ENFORCEMENT,
  type TeacherUnitsEnforcement,
  requireRuntimeIdentity,
} from "./a3-enforcement";
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
// that snapshot is honored. Option B availability is enforced in the same
// snapshot; no compatibility envelope is accepted on reads.

export type TeacherUnitsGetRequest = {
  readonly unitId: string;
};

export type TeacherUnitsGetResponse = {
  readonly unit: TeacherUnitView;
};

// Handler factory. Exported callables bind PRODUCTION_TEACHER_UNITS_ENFORCEMENT;
// other wiring exists only for server-side tests.
export function createTeacherUnitsGetHandler(enforcement: TeacherUnitsEnforcement) {
  return async function teacherUnitsGetHandler(
    request: CallableRequest<unknown>,
  ): Promise<TeacherUnitsGetResponse> {
    const identity = await requireRuntimeIdentity(enforcement, "teacherUnitsGet");
    const actor = await assertActiveTeacher(request);
    const payload = requestObject(request.data);
    assertOnlyAllowedKeys(payload, ["unitId"]);
    const unitId = readUnitId(payload);
    const scope = { identity, enforcement, endpoint: "teacherUnitsGet" } as const;
    return { unit: await readOwnedTeacherUnit(scope, actor, unitId) };
  };
}

const teacherUnitsGetHandler = createTeacherUnitsGetHandler(PRODUCTION_TEACHER_UNITS_ENFORCEMENT);

export const teacherUnitsGet = platformCallable({ maxInstances: 20 }, teacherUnitsGetHandler);

// Exported for direct testing without the callable wrapper.
export const __teacherUnitsGetHandler = teacherUnitsGetHandler;
