import { type CallableRequest } from "firebase-functions/v2/https";

import { platformCallable } from "../shared";
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
};

export type TeacherUnitsRestoreResponse = TeacherUnitMutationResponse;

async function teacherUnitsRestoreHandler(
  request: CallableRequest<unknown>,
): Promise<TeacherUnitsRestoreResponse> {
  const actor = await assertActiveTeacher(request);
  const payload = requestObject(request.data);
  assertOnlyAllowedKeys(payload, ["unitId", "expectedRevision"]);
  const unitId = readUnitId(payload);
  const expectedRevision = readExpectedRevision(payload);

  return mutateOwnedTeacherUnit(actor, unitId, expectedRevision, (current) =>
    current.status === "active"
      ? null
      : {
          fields: { status: "active", archivedAt: null },
          action: "teacherUnits.restored",
          changedFields: ["status", "archivedAt"],
        },
  );
}

export const teacherUnitsRestore = platformCallable(teacherUnitsRestoreHandler);

// Exported for direct testing without the callable wrapper.
export const __teacherUnitsRestoreHandler = teacherUnitsRestoreHandler;
