import { FieldValue } from "firebase-admin/firestore";
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
  readonly compatibility: MutationCompatibilityV2;
};

export type TeacherUnitsArchiveResponse = TeacherUnitMutationResponse;

// Handler factory. Exported callables bind PRODUCTION_TEACHER_UNITS_ENFORCEMENT;
// other wiring exists only for server-side tests.
export function createTeacherUnitsArchiveHandler(enforcement: TeacherUnitsEnforcement) {
  return async function teacherUnitsArchiveHandler(
    request: CallableRequest<unknown>,
  ): Promise<TeacherUnitsArchiveResponse> {
    const identity = await requireRuntimeIdentity(enforcement, "teacherUnitsArchive");
    const actor = await assertActiveTeacher(request);
    const payload = requestObject(request.data);
    assertOnlyAllowedKeys(payload, ["unitId", "expectedRevision", "compatibility"]);
    const compatibility = readCompatibility(payload);
    const unitId = readUnitId(payload);
    const expectedRevision = readExpectedRevision(payload);
    const scope = { identity, enforcement, endpoint: "teacherUnitsArchive" } as const;

    const target = { operation: "archive", unitId, expectedRevision, compatibility } as const;

    return mutateOwnedTeacherUnit(scope, actor, target, (current) =>
      current.status === "archived"
        ? null
        : {
            fields: { status: "archived", archivedAt: FieldValue.serverTimestamp() },
            action: "teacherUnits.archived",
            changedFields: ["status", "archivedAt"],
          },
    );
  };
}

const teacherUnitsArchiveHandler = createTeacherUnitsArchiveHandler(PRODUCTION_TEACHER_UNITS_ENFORCEMENT);

export const teacherUnitsArchive = platformCallable({ maxInstances: 20 }, teacherUnitsArchiveHandler);

// Exported for direct testing without the callable wrapper.
export const __teacherUnitsArchiveHandler = teacherUnitsArchiveHandler;
