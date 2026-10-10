// U2.1 - pure ordering arithmetic for teacher units. Firebase-free, no
// network, never mutates its inputs. Follows classes/classOrderMath.ts: a
// no-op returns the input array itself (callers can test `next === ids`).
//
// Two orderings use these helpers:
// - resources inside one unit (the full list goes to teacherUnitsSetResources);
// - active units inside one teacher-grade organization (the full set goes
//   to teacherUnitsReorder).

import type { TeacherUnit, TeacherUnitGrade, TeacherUnitsReorderRequest } from "./types";

// Move the element at `from` to index `to` (both in the current array).
// Out-of-range indexes and from === to are no-ops.
export function moveIndex<T>(items: ReadonlyArray<T>, from: number, to: number): ReadonlyArray<T> {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length ||
    from === to
  ) {
    return items;
  }
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

// Move `id` one position earlier (-1) or later (+1). Unknown ids and moves
// past either end are no-ops.
export function moveIdByStep(
  ids: ReadonlyArray<string>,
  id: string,
  direction: -1 | 1,
): ReadonlyArray<string> {
  const from = ids.indexOf(id);
  if (from === -1) return ids;
  return moveIndex(ids, from, from + direction);
}

export function canMove(ids: ReadonlyArray<string>, id: string, direction: -1 | 1): boolean {
  const from = ids.indexOf(id);
  if (from === -1) return false;
  const to = from + direction;
  return to >= 0 && to < ids.length;
}

export function sameOrder(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// Resource membership edits. Each returns the complete next list for
// teacherUnitsSetResources, or the input itself when nothing changes.
// The server stays authoritative for placeability, duplicates, and the
// 100-resource ceiling.
export function addResourceId(ids: ReadonlyArray<string>, id: string): ReadonlyArray<string> {
  if (ids.includes(id)) return ids;
  return [...ids, id];
}

export function removeResourceId(ids: ReadonlyArray<string>, id: string): ReadonlyArray<string> {
  if (!ids.includes(id)) return ids;
  return ids.filter((v) => v !== id);
}

export class TeacherUnitOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeacherUnitOrderError";
  }
}

// Build a teacherUnitsReorder request for one grade.
//
// `units` is the authoritative snapshot (from teacherUnitsList or the last
// server response); `orderedIds` is the desired order. The request must
// name exactly the grade's ACTIVE units, each once, with the revision from
// that snapshot. Archived units and other grades are never included. A
// desired order that names a unit outside that set, repeats one, or omits
// one throws: the caller's view is stale and must be refreshed, not padded.
export function buildGradeReorderRequest(
  grade: TeacherUnitGrade,
  units: ReadonlyArray<TeacherUnit>,
  orderedIds: ReadonlyArray<string>,
): TeacherUnitsReorderRequest {
  const active = new Map(
    units.filter((u) => u.grade === grade && u.status === "active").map((u) => [u.unitId, u]),
  );
  if (orderedIds.length === 0) throw new TeacherUnitOrderError("No units to reorder.");
  const seen = new Set<string>();
  const entries = orderedIds.map((id) => {
    const unit = active.get(id);
    if (unit === undefined) throw new TeacherUnitOrderError(`Unit ${id} is not an active Grade ${grade} unit.`);
    if (seen.has(id)) throw new TeacherUnitOrderError(`Unit ${id} appears twice.`);
    seen.add(id);
    return Object.freeze({ unitId: id, expectedRevision: unit.revision });
  });
  if (entries.length !== active.size) {
    throw new TeacherUnitOrderError("The order must include every active unit in the grade.");
  }
  return Object.freeze({ grade, units: Object.freeze(entries) });
}
