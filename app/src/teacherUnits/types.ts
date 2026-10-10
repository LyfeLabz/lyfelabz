// U2.1 - client types for the certified U1A/U1B `teacherUnits*` callables.
//
// The app package cannot import Functions source (tsconfig `rootDir` is
// `src`), so these types mirror the server wire contract exactly, the same
// way `classes/updateClassMetadata.ts` mirrors `classesUpdateMetadata`.
// Canonical definitions:
//   platform/functions/src/shared/types/teacher-unit.ts
//   platform/functions/src/teacherUnits/teacher-unit-access.ts (TeacherUnitView)
//   platform/functions/src/teacherUnits/teacher-units-*.ts (requests/responses)
//   docs/platform/TEACHER_UNITS.md
//
// Firebase-free, so future shell surfaces can import it without breaking
// the shell "no firebase imports" invariant.
//
// The server remains authoritative for authentication, ownership, school
// context, placeability, duplicates, maximum counts, status, revisions, and
// atomic ordering. Nothing here replaces server validation.

import type { TeacherDefaultGrade } from "../teacherPreferences/types";

// Same closed "6" | "7" | "8" set the server reuses from the teacher
// default-grade preference. A Grade 8 unit is valid even though the
// curriculum has no Grade 8 resources today.
export type TeacherUnitGrade = TeacherDefaultGrade;
export const TEACHER_UNIT_GRADES: ReadonlyArray<TeacherUnitGrade> = Object.freeze([
  "6",
  "7",
  "8",
]);

export type TeacherUnitStatus = "active" | "archived";

// Server bounds, mirrored for client feedback only (TEACHER_UNITS.md §3, §9).
export const TEACHER_UNIT_TITLE_MAX_LENGTH = 120;
export const TEACHER_UNIT_DESCRIPTION_MAX_LENGTH = 1000;
export const TEACHER_UNIT_RESOURCES_MAX = 100;
export const TEACHER_UNITS_REORDER_MAX = 200;

// Create idempotency key grammar (TEACHER_UNITS.md §5.1).
export const TEACHER_UNIT_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

// One unit as every callable returns it (server `TeacherUnitView`).
export type TeacherUnit = {
  readonly unitId: string;
  readonly grade: TeacherUnitGrade;
  readonly title: string;
  readonly description: string;
  readonly status: TeacherUnitStatus;
  readonly archivedAtMillis: number | null;
  readonly createdAtMillis: number | null;
  readonly updatedAtMillis: number | null;
  // Ordered canonical RA-1 resource ids. Order is significant.
  readonly resourceIds: ReadonlyArray<string>;
  readonly sortOrder: number;
  readonly revision: number;
};

// ---------- Requests ----------

export type TeacherUnitsCreateRequest = {
  readonly grade: TeacherUnitGrade;
  readonly title: string;
  readonly description?: string;
  readonly idempotencyKey: string;
};

export type TeacherUnitsListRequest = {
  readonly includeArchived?: boolean;
  readonly grade?: TeacherUnitGrade;
};

export type TeacherUnitsGetRequest = { readonly unitId: string };

// At least one of title / description (server-enforced).
export type TeacherUnitsUpdateRequest = {
  readonly unitId: string;
  readonly expectedRevision: number;
  readonly title?: string;
  readonly description?: string;
};

export type TeacherUnitsLifecycleRequest = {
  readonly unitId: string;
  readonly expectedRevision: number;
};

export type TeacherUnitsSetResourcesRequest = {
  readonly unitId: string;
  readonly expectedRevision: number;
  // The complete ordered list the unit should hold.
  readonly resourceIds: ReadonlyArray<string>;
};

export type TeacherUnitOrderEntry = {
  readonly unitId: string;
  readonly expectedRevision: number;
};

// Names the caller's COMPLETE active organization for one grade.
export type TeacherUnitsReorderRequest = {
  readonly grade: TeacherUnitGrade;
  readonly units: ReadonlyArray<TeacherUnitOrderEntry>;
};

// ---------- Responses ----------

export type TeacherUnitsCreateResponse = {
  readonly unit: TeacherUnit;
  // True when the key replayed an earlier create (current state returned).
  readonly replayed: boolean;
};

export type TeacherUnitsListResponse = { readonly units: ReadonlyArray<TeacherUnit> };

export type TeacherUnitsGetResponse = { readonly unit: TeacherUnit };

// Single-unit mutations. `noop: true` is an authorized success: nothing was
// written and `unit` is the current authoritative state.
export type TeacherUnitMutationResponse = {
  readonly unit: TeacherUnit;
  readonly noop: boolean;
};

// The grade's active units in canonical order after the reorder.
export type TeacherUnitsReorderResponse = {
  readonly units: ReadonlyArray<TeacherUnit>;
  readonly noop: boolean;
};

export type TeacherUnitsCallables = {
  readonly create: (req: TeacherUnitsCreateRequest) => Promise<TeacherUnitsCreateResponse>;
  readonly list: (req?: TeacherUnitsListRequest) => Promise<TeacherUnitsListResponse>;
  readonly get: (req: TeacherUnitsGetRequest) => Promise<TeacherUnitsGetResponse>;
  readonly update: (req: TeacherUnitsUpdateRequest) => Promise<TeacherUnitMutationResponse>;
  readonly archive: (req: TeacherUnitsLifecycleRequest) => Promise<TeacherUnitMutationResponse>;
  readonly restore: (req: TeacherUnitsLifecycleRequest) => Promise<TeacherUnitMutationResponse>;
  readonly setResources: (
    req: TeacherUnitsSetResourcesRequest,
  ) => Promise<TeacherUnitMutationResponse>;
  readonly reorder: (req: TeacherUnitsReorderRequest) => Promise<TeacherUnitsReorderResponse>;
};

export function isTeacherUnitGrade(v: unknown): v is TeacherUnitGrade {
  return v === "6" || v === "7" || v === "8";
}

// Canonical reader order (server `compareTeacherUnitViews`): sortOrder,
// then createdAt, then unitId. New units (sortOrder 0) sort first.
export function compareTeacherUnits(a: TeacherUnit, b: TeacherUnit): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  const ac = a.createdAtMillis ?? 0;
  const bc = b.createdAtMillis ?? 0;
  if (ac !== bc) return ac - bc;
  return a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0;
}
