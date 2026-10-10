import { type CallableRequest } from "firebase-functions/v2/https";

import { PlatformError, TEACHER_UNIT_RESOURCES_MAX, platformCallable } from "../shared";
import {
  assertActiveTeacher,
  assertOnlyAllowedKeys,
  readExpectedRevision,
  readUnitId,
  requestObject,
} from "./teacher-unit-access";
import {
  mutateOwnedTeacherUnit,
  type TeacherUnitMutationResponse,
} from "./teacher-unit-mutation";
import { isUnitPlaceableResourceId } from "./unit-placeable-resources";

// teacherUnitsSetResources - U1B resource membership and ordering.
//
// Replaces a unit's ordered `resourceIds` with the complete list the
// caller supplies, so adding, removing, and reordering resources are one
// operation and one revision: the caller sends the list it wants, based on
// the `expectedRevision` it last observed.
//
// Every id is validated before any read or write against the server copy
// of the RA-1 `unitPlaceable` projection (unit-placeable-resources.ts). One
// invalid, unknown, non-placeable (gated lesson, tool), or repeated id
// refuses the whole request; nothing is written. Placement does not depend
// on assignability (Gravity Wells is placeable), and there is no
// cross-unit uniqueness: the same resource may sit in any number of units.
//
// An archived unit is read-only (`teacherUnits.invalidStatus`): restore it
// first. Archive and restore preserve `resourceIds`. A list equal to the
// stored one (same ids, same order) is a no-op. See
// `mutateOwnedTeacherUnit` for authorization and the revision contract.

export type TeacherUnitsSetResourcesRequest = {
  readonly unitId: string;
  readonly expectedRevision: number;
  readonly resourceIds: readonly string[];
};

export type TeacherUnitsSetResourcesResponse = TeacherUnitMutationResponse;

const ALLOWED_KEYS: readonly string[] = ["unitId", "expectedRevision", "resourceIds"];

export function readResourceIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new PlatformError("teacherUnits.invalidResourceIds", "resourceIds must be an array.");
  }
  if (value.length > TEACHER_UNIT_RESOURCES_MAX) {
    throw new PlatformError(
      "teacherUnits.invalidResourceIds",
      `A unit can hold at most ${String(TEACHER_UNIT_RESOURCES_MAX)} resources.`,
    );
  }
  const seen = new Set<string>();
  const notPlaceable: string[] = [];
  for (const id of value as unknown[]) {
    if (typeof id !== "string") {
      throw new PlatformError("teacherUnits.invalidResourceIds", "resourceIds must contain only strings.");
    }
    if (seen.has(id)) {
      throw new PlatformError(
        "teacherUnits.duplicateResource",
        "A resource can appear only once in a unit.",
        undefined,
        { resourceId: id },
      );
    }
    seen.add(id);
    if (!isUnitPlaceableResourceId(id)) notPlaceable.push(id);
  }
  if (notPlaceable.length > 0) {
    throw new PlatformError(
      "teacherUnits.resourceNotPlaceable",
      "Every resource must be a canonical resource that can be placed in a unit.",
      undefined,
      { resourceIds: notPlaceable },
    );
  }
  return value as string[];
}

function validateRequest(data: unknown): TeacherUnitsSetResourcesRequest {
  const payload = requestObject(data);
  assertOnlyAllowedKeys(payload, ALLOWED_KEYS);
  return {
    unitId: readUnitId(payload),
    expectedRevision: readExpectedRevision(payload),
    resourceIds: readResourceIds(payload.resourceIds),
  };
}

function sameOrderedIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

async function teacherUnitsSetResourcesHandler(
  request: CallableRequest<unknown>,
): Promise<TeacherUnitsSetResourcesResponse> {
  const actor = await assertActiveTeacher(request);
  const input = validateRequest(request.data);

  return mutateOwnedTeacherUnit(actor, input.unitId, input.expectedRevision, (current) => {
    if (current.status !== "active") {
      throw new PlatformError(
        "teacherUnits.invalidStatus",
        "An archived unit cannot be edited. Restore it first.",
      );
    }
    if (sameOrderedIds(current.resourceIds, input.resourceIds)) return null;
    return {
      fields: { resourceIds: [...input.resourceIds] },
      action: "teacherUnits.resourcesUpdated",
      changedFields: ["resourceIds"],
      auditPayload: {
        previousResourceCount: current.resourceIds.length,
        resourceCount: input.resourceIds.length,
      },
    };
  });
}

export const teacherUnitsSetResources = platformCallable(teacherUnitsSetResourcesHandler);

// Exported for direct testing without the callable wrapper.
export const __teacherUnitsSetResourcesHandler = teacherUnitsSetResourcesHandler;
