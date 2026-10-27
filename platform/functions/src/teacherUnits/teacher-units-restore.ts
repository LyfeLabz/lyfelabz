import { type CallableRequest } from "firebase-functions/v2/https";

import { platformCallable } from "../shared";
import {
  PRODUCTION_TEACHER_UNITS_ENFORCEMENT,
  type TeacherUnitsEnforcement,
  readCompatibility,
  requireRuntimeIdentity,
} from "./a3-enforcement";
import type { MutationCompatibilityV2 } from "./availability-protocol";
import {
  assertActiveTeacher,
  assertOnlyAllowedKeys,
  readExpectedRevision,
  readUnitId,
  requestObject,
} from "./teacher-unit-access";
import { mutateOwnedTeacherUnit, type TeacherUnitMutationResponse } from "./teacher-unit-mutation";

// teacherUnitsRestore - U1A. Reversible `archived -> active` transition of
// the SAME unit (same id and every preserved field). `archivedAt` returns to
// null; the archive history is in the `teacherUnits.archived` /
// `teacherUnits.restored` audit events. Restoring an active unit is a
// no-op. See `mutateOwnedTeacherUnit`.

export type TeacherUnitsRestoreRequest = {
  readonly unitId: string;
  readonly expectedRevision: number;
  readonly compatibility: MutationCompatibilityV2;
};

export type TeacherUnitsRestoreResponse = TeacherUnitMutationResponse;

// Handler factory. Exported callables bind PRODUCTION_TEACHER_UNITS_ENFORCEMENT;
// other wiring exists only for server-side tests.
export function createTeacherUnitsRestoreHandler(enforcement: TeacherUnitsEnforcement) {
  return async function teacherUnitsRestoreHandler(
    request: CallableRequest<unknown>,
  ): Promise<TeacherUnitsRestoreResponse> {
    const identity = await requireRuntimeIdentity(enforcement, "teacherUnitsRestore");
    const actor = await assertActiveTeacher(request);
    const payload = requestObject(request.data);
    assertOnlyAllowedKeys(payload, ["unitId", "expectedRevision", "compatibility"]);
    const compatibility = readCompatibility(payload);
    const unitId = readUnitId(payload);
    const expectedRevision = readExpectedRevision(payload);
    const scope = { identity, enforcement, endpoint: "teacherUnitsRestore" } as const;

    const target = { operation: "restore", unitId, expectedRevision, compatibility } as const;

    return mutateOwnedTeacherUnit(scope, actor, target, (current) =>
      current.status === "active"
        ? null
        : {
            fields: { status: "active", archivedAt: null },
            action: "teacherUnits.restored",
            changedFields: ["status", "archivedAt"],
          },
    );
  };
}

const teacherUnitsRestoreHandler = createTeacherUnitsRestoreHandler(PRODUCTION_TEACHER_UNITS_ENFORCEMENT);

export const teacherUnitsRestore = platformCallable(teacherUnitsRestoreHandler);

// Exported for direct testing without the callable wrapper.
export const __teacherUnitsRestoreHandler = teacherUnitsRestoreHandler;
