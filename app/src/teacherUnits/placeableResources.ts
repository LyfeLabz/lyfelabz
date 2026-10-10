// U2.1 - thin adapter over the canonical RA-1 projection for the future
// Unit Builder resource library. Not a registry: every entry is a
// `FlatResource` from `getFlatResources()` (curriculum/resourceProjection.ts),
// selected by `unitPlaceable` and returned in canonical registry order.
//
// Placement and assignment are independent RA-1 capabilities. A resource
// is "assignable" only when `capabilities.authenticatedAssignment` is true;
// every other placeable resource (for example `simulation-gravity-wells`)
// can be organized in a unit but not assigned.
//
// Grade filtering is discovery only. A Grade 7 resource found through
// cross-grade discovery keeps `grade: "7"` even when placed in a Grade 6
// unit; membership is not grade-restricted (TEACHER_UNITS.md §9.1). The
// server list (unit-placeable-resources.json) remains the enforcement
// boundary.

import { getFlatResources, type FlatResource } from "../curriculum/resourceProjection";
import type { LessonTopic, ResourceType } from "../curriculum/curriculumManifest";
import type { TeacherUnitGrade } from "./types";

export type ResourceEligibility = "assignable" | "organizeOnly";

export function resourceEligibility(resource: FlatResource): ResourceEligibility {
  return resource.capabilities.authenticatedAssignment ? "assignable" : "organizeOnly";
}

let placeable: ReadonlyArray<FlatResource> | null = null;

// Every unit-placeable resource, canonical order.
export function getPlaceableResources(): ReadonlyArray<FlatResource> {
  if (placeable === null) {
    placeable = Object.freeze(getFlatResources().filter((r) => r.unitPlaceable));
  }
  return placeable;
}

export function getPlaceableResourceById(id: string): FlatResource | null {
  return getPlaceableResources().find((r) => r.id === id) ?? null;
}

export type PlaceableResourceQuery = {
  // The unit's own grade. Results default to it.
  readonly unitGrade: TeacherUnitGrade;
  // "unitGrade" (default) or an explicit request for every grade.
  readonly scope?: "unitGrade" | "allGrades";
  readonly type?: ResourceType | "all";
  readonly topic?: LessonTopic | "all";
  // Case-insensitive title substring.
  readonly search?: string;
};

export function filterPlaceableResources(
  query: PlaceableResourceQuery,
): ReadonlyArray<FlatResource> {
  const scope = query.scope ?? "unitGrade";
  const type = query.type ?? "all";
  const topic = query.topic ?? "all";
  const needle = (query.search ?? "").trim().toLowerCase();
  return getPlaceableResources().filter(
    (r) =>
      (scope === "allGrades" || r.grade === query.unitGrade) &&
      (type === "all" || r.type === type) &&
      (topic === "all" || r.topic === topic) &&
      (needle === "" || r.title.toLowerCase().includes(needle)),
  );
}

// A unit's stored resource ids resolved against the current client
// projection. `unavailable` ids are stored but no longer placeable here
// (or unknown); the server refuses any save that still names them, so a
// future UI must show them and let the teacher remove them. Order kept.
export type ResolvedUnitResource =
  | { readonly id: string; readonly status: "available"; readonly resource: FlatResource }
  | { readonly id: string; readonly status: "unavailable"; readonly resource: null };

export function resolveUnitResources(
  resourceIds: ReadonlyArray<string>,
): ReadonlyArray<ResolvedUnitResource> {
  return resourceIds.map((id) => {
    const resource = getPlaceableResourceById(id);
    return resource === null
      ? Object.freeze({ id, status: "unavailable" as const, resource: null })
      : Object.freeze({ id, status: "available" as const, resource });
  });
}
