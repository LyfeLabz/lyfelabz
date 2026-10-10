import { FieldValue } from "firebase-admin/firestore";
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

// teacherUnitsArchive - U1A. Reversible `active -> archived` transition.
//
// Sets `status: "archived"` and a server `archivedAt`; every other field
// (id, owner, school, grade, title, description, resourceIds, sortOrder) is
// preserved. The document is never deleted and no assignment is touched.
// Archiving an already-archived unit is a no-op that keeps the original
// `archivedAt` and revision. See `mutateOwnedTeacherUnit`.

export type TeacherUnitsArchiveRequest = {
  readonly unitId: string;
  readonly expectedRevision: number;
};

export type TeacherUnitsArchiveResponse = TeacherUnitMutationResponse;

async function teacherUnitsArchiveHandler(
  request: CallableRequest<unknown>,
): Promise<TeacherUnitsArchiveResponse> {
  const actor = await assertActiveTeacher(request);
  const payload = requestObject(request.data);
  assertOnlyAllowedKeys(payload, ["unitId", "expectedRevision"]);
  const unitId = readUnitId(payload);
  const expectedRevision = readExpectedRevision(payload);

  return mutateOwnedTeacherUnit(actor, unitId, expectedRevision, (current) =>
    current.status === "archived"
      ? null
      : {
          fields: { status: "archived", archivedAt: FieldValue.serverTimestamp() },
          action: "teacherUnits.archived",
          changedFields: ["status", "archivedAt"],
        },
  );
}

export const teacherUnitsArchive = platformCallable(teacherUnitsArchiveHandler);

// Exported for direct testing without the callable wrapper.
export const __teacherUnitsArchiveHandler = teacherUnitsArchiveHandler;
