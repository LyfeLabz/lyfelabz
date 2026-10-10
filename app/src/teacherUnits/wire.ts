import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

import {
  TEACHER_UNIT_DESCRIPTION_MAX_LENGTH,
  TEACHER_UNIT_RESOURCES_MAX,
  TEACHER_UNIT_TITLE_MAX_LENGTH,
  compareTeacherUnits,
  isTeacherUnitGrade,
  type TeacherUnit,
  type TeacherUnitGrade,
  type TeacherUnitMutationResponse,
  type TeacherUnitsCallables,
  type TeacherUnitsReorderResponse,
} from "./types";

// U2.1 - client wire for the eight certified U1A/U1B `teacherUnits*`
// callables (docs/platform/TEACHER_UNITS.md §4). Lives outside
// `src/shell/**` so the shell invariant (no firebase/functions imports, no
// httpsCallable) is preserved, mirroring classes/updateClassMetadata.ts.
//
// The factory receives the app's existing `Functions` instance (it never
// initializes Firebase) and performs no network call until a returned
// operation is invoked. Requests carry only the server's allowlisted keys;
// optional fields are omitted rather than sent as undefined. Responses are
// checked against the wire contract: a malformed response throws
// `TeacherUnitsResponseError` rather than being treated as success.
// Server errors (HttpsError, details.code) propagate unchanged; see
// errors.ts for normalization.

export class TeacherUnitsResponseError extends Error {
  constructor(callable: string) {
    super(`${callable} returned an unexpected response.`);
    this.name = "TeacherUnitsResponseError";
  }
}

export const TEACHER_UNITS_CALLABLE_NAMES = Object.freeze({
  create: "teacherUnitsCreate",
  list: "teacherUnitsList",
  get: "teacherUnitsGet",
  update: "teacherUnitsUpdate",
  archive: "teacherUnitsArchive",
  restore: "teacherUnitsRestore",
  setResources: "teacherUnitsSetResources",
  reorder: "teacherUnitsReorder",
} as const);

// Server invariants (platform/functions/src/teacherUnits/teacher-unit-access.ts,
// shared/types/teacher-unit.ts, TEACHER_UNITS.md §3). Stored ids that are no
// longer RA-1 placeable are NOT rejected here: they stay readable so the
// teacher can see and remove them.
const UNIT_ID_PATTERN = /^[A-Za-z0-9]{20}$/;
// eslint-disable-next-line no-control-regex
const TITLE_FORBIDDEN = /[\u0000-\u001f\u007f]/;
// eslint-disable-next-line no-control-regex
const DESCRIPTION_FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function codePointLength(value: string): number {
  return [...value].length;
}

function isNonNegativeSafeInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

function isNullableMillis(v: unknown): v is number | null {
  return v === null || isNonNegativeSafeInteger(v);
}

function isValidTitle(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    v.trim() === v &&
    codePointLength(v) <= TEACHER_UNIT_TITLE_MAX_LENGTH &&
    !TITLE_FORBIDDEN.test(v)
  );
}

function isValidDescription(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.trim() === v &&
    codePointLength(v) <= TEACHER_UNIT_DESCRIPTION_MAX_LENGTH &&
    !DESCRIPTION_FORBIDDEN.test(v)
  );
}

function isValidResourceIds(v: unknown): v is string[] {
  if (!Array.isArray(v) || v.length > TEACHER_UNIT_RESOURCES_MAX) return false;
  if (!v.every((id) => typeof id === "string" && id.length > 0)) return false;
  return new Set(v).size === v.length;
}

// Ownership fields are omitted from the server view; if a future server
// ever includes them they must at least be well-formed.
function isOptionalIdentity(v: unknown): boolean {
  return v === undefined || (typeof v === "string" && v.length > 0);
}

export function parseTeacherUnit(raw: unknown, callable: string): TeacherUnit {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TeacherUnitsResponseError(callable);
  }
  const r = raw as Record<string, unknown>;
  const statusConsistent =
    (r.status === "active" && r.archivedAtMillis === null) ||
    (r.status === "archived" && isNonNegativeSafeInteger(r.archivedAtMillis));
  if (
    typeof r.unitId !== "string" ||
    !UNIT_ID_PATTERN.test(r.unitId) ||
    !isOptionalIdentity(r.teacherId) ||
    !isOptionalIdentity(r.schoolId) ||
    !isTeacherUnitGrade(r.grade) ||
    !isValidTitle(r.title) ||
    !isValidDescription(r.description) ||
    !statusConsistent ||
    !isNullableMillis(r.createdAtMillis) ||
    !isNullableMillis(r.updatedAtMillis) ||
    !isValidResourceIds(r.resourceIds) ||
    !isNonNegativeSafeInteger(r.sortOrder) ||
    !isNonNegativeSafeInteger(r.revision) ||
    r.revision < 1
  ) {
    throw new TeacherUnitsResponseError(callable);
  }
  return Object.freeze({
    unitId: r.unitId,
    grade: r.grade,
    title: r.title,
    description: r.description,
    status: r.status as TeacherUnit["status"],
    archivedAtMillis: r.archivedAtMillis as number | null,
    createdAtMillis: r.createdAtMillis,
    updatedAtMillis: r.updatedAtMillis,
    // Order preserved exactly as the server returned it.
    resourceIds: Object.freeze(r.resourceIds.slice()),
    sortOrder: r.sortOrder,
    revision: r.revision,
  });
}

function parseUnits(raw: unknown, callable: string): ReadonlyArray<TeacherUnit> {
  if (!Array.isArray(raw)) throw new TeacherUnitsResponseError(callable);
  const units = raw.map((u) => parseTeacherUnit(u, callable));
  if (new Set(units.map((u) => u.unitId)).size !== units.length) {
    throw new TeacherUnitsResponseError(callable);
  }
  return Object.freeze(units);
}

function isCanonicallyOrdered(units: ReadonlyArray<TeacherUnit>): boolean {
  for (let i = 1; i < units.length; i++) {
    if (compareTeacherUnits(units[i - 1] as TeacherUnit, units[i] as TeacherUnit) > 0) return false;
  }
  return true;
}

function readData(data: unknown, callable: string): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new TeacherUnitsResponseError(callable);
  return data as Record<string, unknown>;
}

function readBoolean(v: unknown, callable: string): boolean {
  if (typeof v !== "boolean") throw new TeacherUnitsResponseError(callable);
  return v;
}

// Response correlation. A structurally valid unit must also be the unit the
// request named. Only immutable identity is compared (unitId, and grade,
// which the server never changes after create). Mutable fields (title,
// description, status, resourceIds, sortOrder, revision) are NOT compared:
// the server returns current state, which a replay, a no-op, or a
// concurrent edit can legitimately change.
function expectUnitId(unit: TeacherUnit, unitId: string, callable: string): TeacherUnit {
  if (unit.unitId !== unitId) throw new TeacherUnitsResponseError(callable);
  return unit;
}

function parseMutation(
  data: unknown,
  callable: string,
  unitId: string,
): TeacherUnitMutationResponse {
  const d = readData(data, callable);
  return Object.freeze({
    unit: expectUnitId(parseTeacherUnit(d.unit, callable), unitId, callable),
    noop: readBoolean(d.noop, callable),
  });
}

// The grade's ACTIVE units in canonical order (TEACHER_UNITS.md §9.2). The
// set is not required to equal the request: the post-commit read may see a
// concurrent create or archive.
function parseReorder(
  data: unknown,
  callable: string,
  grade: TeacherUnitGrade,
): TeacherUnitsReorderResponse {
  const d = readData(data, callable);
  const units = parseUnits(d.units, callable);
  if (
    !units.every((u) => u.grade === grade && u.status === "active") ||
    !isCanonicallyOrdered(units)
  ) {
    throw new TeacherUnitsResponseError(callable);
  }
  return Object.freeze({ units, noop: readBoolean(d.noop, callable) });
}

export function createFirebaseTeacherUnitsCallables(
  functions: Functions,
): TeacherUnitsCallables {
  const call = (name: string) => httpsCallable<Record<string, unknown>, unknown>(functions, name);
  const n = TEACHER_UNITS_CALLABLE_NAMES;
  const create = call(n.create);
  const list = call(n.list);
  const get = call(n.get);
  const update = call(n.update);
  const archive = call(n.archive);
  const restore = call(n.restore);
  const setResources = call(n.setResources);
  const reorder = call(n.reorder);

  // Request correlation is immutable: every adapter builds the exact
  // outgoing payload synchronously (copying nested arrays, so later caller
  // mutation cannot reach the dispatched request), captures the correlation
  // values as primitives from that payload, and only then awaits. Responses
  // are validated against those captured values, never against the
  // caller-owned `req`, which may be mutated while the call is pending.
  return Object.freeze({
    create: async (req) => {
      const payload = {
        grade: req.grade,
        title: req.title,
        ...(req.description !== undefined ? { description: req.description } : {}),
        idempotencyKey: req.idempotencyKey,
      };
      // Taken from the dispatched payload, never re-read from `req`: a
      // caller-owned accessor on another field could change `req.grade`
      // while the payload is being built.
      const grade = payload.grade;
      const { data } = await create(payload);
      const d = readData(data, n.create);
      const createdUnit = parseTeacherUnit(d.unit, n.create);
      // The server stamps the requested grade at creation and never changes
      // it; a replay returns the same unit. A different grade cannot be the
      // unit this request created.
      if (createdUnit.grade !== grade) throw new TeacherUnitsResponseError(n.create);
      return Object.freeze({
        unit: createdUnit,
        replayed: readBoolean(d.replayed, n.create),
      });
    },
    list: async (req = {}) => {
      const grade = req.grade;
      const includeArchived = req.includeArchived;
      const { data } = await list({
        ...(includeArchived !== undefined ? { includeArchived } : {}),
        ...(grade !== undefined ? { grade } : {}),
      });
      const units = parseUnits(readData(data, n.list).units, n.list);
      if (
        (grade !== undefined && !units.every((u) => u.grade === grade)) ||
        (includeArchived !== true && !units.every((u) => u.status === "active")) ||
        !isCanonicallyOrdered(units)
      ) {
        throw new TeacherUnitsResponseError(n.list);
      }
      return Object.freeze({ units });
    },
    get: async (req) => {
      const unitId = req.unitId;
      const { data } = await get({ unitId });
      return Object.freeze({
        unit: expectUnitId(parseTeacherUnit(readData(data, n.get).unit, n.get), unitId, n.get),
      });
    },
    update: async (req) => {
      const unitId = req.unitId;
      const { data } = await update({
        unitId,
        expectedRevision: req.expectedRevision,
        ...(req.title !== undefined ? { title: req.title } : {}),
        ...(req.description !== undefined ? { description: req.description } : {}),
      });
      return parseMutation(data, n.update, unitId);
    },
    archive: async (req) => {
      const unitId = req.unitId;
      const { data } = await archive({ unitId, expectedRevision: req.expectedRevision });
      return parseMutation(data, n.archive, unitId);
    },
    restore: async (req) => {
      const unitId = req.unitId;
      const { data } = await restore({ unitId, expectedRevision: req.expectedRevision });
      return parseMutation(data, n.restore, unitId);
    },
    setResources: async (req) => {
      const unitId = req.unitId;
      const { data } = await setResources({
        unitId,
        expectedRevision: req.expectedRevision,
        resourceIds: req.resourceIds.slice(),
      });
      return parseMutation(data, n.setResources, unitId);
    },
    reorder: async (req) => {
      const grade = req.grade;
      const { data } = await reorder({
        grade,
        units: req.units.map((u) => ({ unitId: u.unitId, expectedRevision: u.expectedRevision })),
      });
      return parseReorder(data, n.reorder, grade);
    },
  });
}
