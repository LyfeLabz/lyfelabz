import { FieldValue } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  isTeacherUnitColor,
  platformCallable,
  type TeacherUnitColor,
} from "../shared";
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
  readColor,
  readDescription,
  readExpectedRevision,
  readTitle,
  readUnitId,
  requestObject,
} from "./teacher-unit-access";
import {
  mutateOwnedTeacherUnit,
  type TeacherUnitMutationResponse,
} from "./teacher-unit-mutation";

// teacherUnitsUpdate - U1A rename and description edit, plus the unit color.
//
// Accepts any of `title`, `description`, and `color` (a palette token, or
// null for the neutral default), plus the `expectedRevision` the caller last
// observed. Only these fields are editable; grade, owner,
// school, status, resource membership, and ordering are not. An archived
// unit is read-only (`teacherUnits.invalidStatus`): restore it first. A
// request whose values already match is a no-op. See
// `mutateOwnedTeacherUnit` for the revision contract.

export type TeacherUnitsUpdateRequest = {
  readonly unitId: string;
  readonly expectedRevision: number;
  readonly title?: string;
  readonly description?: string;
  readonly color?: TeacherUnitColor | null;
  readonly compatibility: MutationCompatibilityV2;
};

export type TeacherUnitsUpdateResponse = TeacherUnitMutationResponse;

const ALLOWED_KEYS: readonly string[] = [
  "unitId",
  "expectedRevision",
  "title",
  "description",
  "color",
  "compatibility",
];

function validateRequest(data: unknown): TeacherUnitsUpdateRequest {
  const payload = requestObject(data);
  assertOnlyAllowedKeys(payload, ALLOWED_KEYS);
  const compatibility = readCompatibility(payload);
  const unitId = readUnitId(payload);
  const expectedRevision = readExpectedRevision(payload);
  const title = payload.title === undefined ? undefined : readTitle(payload.title);
  const description =
    payload.description === undefined ? undefined : readDescription(payload.description);
  const color = payload.color === undefined ? undefined : readColor(payload.color);
  if (title === undefined && description === undefined && color === undefined) {
    throw new PlatformError(
      "teacherUnits.invalidRequest",
      "At least one of title, description, or color must be supplied.",
    );
  }
  return {
    unitId,
    expectedRevision,
    compatibility,
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(color !== undefined ? { color } : {}),
  };
}

// Handler factory. Exported callables bind PRODUCTION_TEACHER_UNITS_ENFORCEMENT;
// other wiring exists only for server-side tests.
export function createTeacherUnitsUpdateHandler(enforcement: TeacherUnitsEnforcement) {
  return async function teacherUnitsUpdateHandler(
    request: CallableRequest<unknown>,
  ): Promise<TeacherUnitsUpdateResponse> {
    const identity = await requireRuntimeIdentity(enforcement, "teacherUnitsUpdate");
    const actor = await assertActiveTeacher(request);
    const input = validateRequest(request.data);
    const scope = { identity, enforcement, endpoint: "teacherUnitsUpdate" } as const;
    const target = {
      operation: "update",
      unitId: input.unitId,
      expectedRevision: input.expectedRevision,
      compatibility: input.compatibility,
    } as const;

    return mutateOwnedTeacherUnit(scope, actor, target, (current) => {
      if (current.status !== "active") {
        throw new PlatformError(
          "teacherUnits.invalidStatus",
          "An archived unit cannot be edited. Restore it first.",
        );
      }
      const fields: {
        title?: string;
        description?: string;
        color?: TeacherUnitColor | FieldValue;
      } = {};
      const changedFields: string[] = [];
      if (input.title !== undefined && input.title !== current.title) {
        fields.title = input.title;
        changedFields.push("title");
      }
      if (input.description !== undefined && input.description !== current.description) {
        fields.description = input.description;
        changedFields.push("description");
      }
      if (input.color !== undefined) {
        const held = isTeacherUnitColor(current.color) ? current.color : null;
        if (input.color !== held) {
          fields.color = input.color ?? FieldValue.delete();
          changedFields.push("color");
        }
      }
      if (changedFields.length === 0) return null;
      return {
        fields,
        action: "teacherUnits.updated",
        changedFields,
      };
    });
  };
}

const teacherUnitsUpdateHandler = createTeacherUnitsUpdateHandler(PRODUCTION_TEACHER_UNITS_ENFORCEMENT);

export const teacherUnitsUpdate = platformCallable(teacherUnitsUpdateHandler);

// Exported for direct testing without the callable wrapper.
export const __teacherUnitsUpdateHandler = teacherUnitsUpdateHandler;
