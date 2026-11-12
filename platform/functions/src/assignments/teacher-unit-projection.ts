import {
  PlatformError,
  classDocRef,
  log,
  teacherUnitsCollectionRef,
  type TeacherUnitColor,
  type TeacherUnitRecord,
} from "../shared";
import {
  compareTeacherUnitViews,
  toTeacherUnitView,
  type TeacherUnitView,
} from "../teacherUnits/teacher-unit-access";
import { TEACHER_UNITS_LIST_MAX } from "../teacherUnits/teacher-units-list";
import { readTeacherUnitProjectionPolicy } from "./teacher-unit-projection-policy";

// Teacher Units Expansion P1: authorized, read-only projection of a class
// owner's CURRENT active Teacher Units onto assignments the viewer is
// already authorized to see. Shared by `assignmentsListForStudent` (student
// My Science) and `assessmentStudentAssignmentsForClass` (owner / support
// teacher Student Detail).
//
// Units are organizational only. This module never decides assignment
// visibility, never reads or returns a resource that is not already one of
// the viewer's visible assignments, and never writes anything. Callers pass
// only cards they have ALREADY authorized and the class owner / school /
// grade they derived from authoritative server records; nothing here comes
// from the request payload.
//
// Projection rules (P1 approved decisions):
//   - only units owned by the class owner (`teacherId`) at the class's
//     school (`schoolId`) are read (same two-equality query shape as
//     `teacherUnitsList`; no new index);
//   - only `active` units whose grade equals the class grade are eligible;
//     a class with no grade (needsSetup) has no eligible units;
//   - each card is placed in at most ONE unit: the first unit, in canonical
//     unit order (`compareTeacherUnitViews`: sortOrder, createdAt, unitId),
//     whose `resourceIds` contains the card's lessonSlug;
//   - within a unit, cards follow the teacher's `resourceIds` order, then
//     the card's first assignment id;
//   - units with no placed card are omitted; descriptions, resourceIds,
//     sortOrder, revisions, timestamps and ownership ids never cross the
//     boundary.
//
// Membership is the teacher's CURRENT organization: assignments do not store
// unit membership, so renaming, reordering, archiving or editing a unit
// changes where an existing assignment appears (approved P1 display behavior).

// Response shape for one projected unit.
export type AssignmentUnitProjection = {
  readonly unitId: string;
  readonly title: string;
  // Null when the unit has no color or holds a value outside the palette.
  readonly color: TeacherUnitColor | null;
  // Every assignment id of every card placed in this unit, in card order.
  // A card's ids are contiguous and all belong to the same unit, so a client
  // locates a card's unit by any one of the card's ids.
  readonly assignmentIds: readonly string[];
};

// One displayed card the caller already authorized: one or more assignment
// ids (e.g. a history-only group) that all share one class + lesson.
export type UnitProjectionCard = {
  readonly assignmentIds: readonly string[];
  readonly lessonSlug: string;
};

// One class scope. All fields are server-derived by the caller.
export type UnitProjectionScope = {
  readonly classId: string;
  readonly teacherId: string;
  readonly schoolId: string;
  // The class grade (null when the class record has none), or a lazy
  // authoritative lookup, resolved only when the policy is enabled.
  readonly grade: string | null | (() => Promise<string | null>);
  // The authorized cards, or a promise of them so a caller can overlap the
  // policy and unit reads with its own remaining work. A rejected promise
  // yields an empty projection (the caller surfaces its own error).
  readonly cards: readonly UnitProjectionCard[] | Promise<readonly UnitProjectionCard[]>;
};

// Pure placement of authorized cards into eligible units. `units` must
// already be restricted to the scope's owner and school.
export function placeCardsIntoUnits(
  units: readonly TeacherUnitView[],
  grade: string | null,
  cards: readonly UnitProjectionCard[],
): AssignmentUnitProjection[] {
  if (grade === null || cards.length === 0) return [];
  const eligible = units
    .filter((unit) => unit.status === "active" && unit.grade === grade)
    .slice()
    .sort(compareTeacherUnitViews);
  if (eligible.length === 0) return [];

  type Placed = { readonly card: UnitProjectionCard; readonly position: number };
  const placed = new Map<string, Placed[]>();
  for (const card of cards) {
    if (card.assignmentIds.length === 0) continue;
    for (const unit of eligible) {
      const position = unit.resourceIds.indexOf(card.lessonSlug);
      if (position === -1) continue;
      const bucket = placed.get(unit.unitId);
      if (bucket) bucket.push({ card, position });
      else placed.set(unit.unitId, [{ card, position }]);
      break;
    }
  }

  const result: AssignmentUnitProjection[] = [];
  for (const unit of eligible) {
    const bucket = placed.get(unit.unitId);
    if (!bucket || bucket.length === 0) continue;
    bucket.sort((a, b) => {
      if (a.position !== b.position) return a.position - b.position;
      const ka = a.card.assignmentIds[0] ?? "";
      const kb = b.card.assignmentIds[0] ?? "";
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    result.push({
      unitId: unit.unitId,
      title: unit.title,
      color: unit.color,
      assignmentIds: bucket.flatMap(({ card }) => card.assignmentIds),
    });
  }
  return result;
}

// Defensive record check: a malformed unit is skipped, never projected.
function isProjectableRecord(
  record: TeacherUnitRecord | undefined,
  teacherId: string,
  schoolId: string,
): record is TeacherUnitRecord {
  if (!record) return false;
  if (record.teacherId !== teacherId || record.schoolId !== schoolId) return false;
  if (typeof record.title !== "string" || record.title.length === 0) return false;
  if (!Array.isArray(record.resourceIds)) return false;
  if (typeof record.sortOrder !== "number" || !Number.isFinite(record.sortOrder)) return false;
  return true;
}

async function loadOwnerUnits(
  teacherId: string,
  schoolId: string,
): Promise<TeacherUnitView[]> {
  const snapshot = await teacherUnitsCollectionRef()
    .where("teacherId", "==", teacherId)
    .where("schoolId", "==", schoolId)
    .limit(TEACHER_UNITS_LIST_MAX + 1)
    .get();
  if (snapshot.docs.length > TEACHER_UNITS_LIST_MAX) {
    throw new PlatformError(
      "teacherUnits.listLimitExceeded",
      "Too many units to project in one request.",
    );
  }
  const views: TeacherUnitView[] = [];
  for (const doc of snapshot.docs) {
    const record = doc.data();
    if (!isProjectableRecord(record, teacherId, schoolId)) continue;
    views.push(toTeacherUnitView(doc.id, record));
  }
  return views;
}

// Orchestration. Returns `[]` when the policy is closed, when no scope has
// both a grade and a card, or when the optional projection cannot be
// produced (policy/unit read failure, read ceiling exceeded). Such failures
// are logged and never fail the enclosing assignment request. Authorization
// is the CALLER's job and happens before this is invoked, so nothing here can
// mask an authorization refusal.
//
// Scopes are projected in order (callers sort them deterministically); a
// unit may appear once per scope, so entries are per (class, unit) and never
// mix assignments from different classes or teachers.
export async function projectTeacherUnitsForScopes(
  scopes: readonly UnitProjectionScope[],
  logContext: string,
): Promise<AssignmentUnitProjection[]> {
  const candidates = scopes.filter(
    (scope) => scope.grade !== null && (!Array.isArray(scope.cards) || scope.cards.length > 0),
  );
  if (candidates.length === 0) return [];
  try {
    // Policy first: when closed, no class or unit document is read.
    if ((await readTeacherUnitProjectionPolicy()) !== "enabled") return [];
    const unitsByOwner = new Map<string, Promise<TeacherUnitView[]>>();
    const loadFor = (scope: UnitProjectionScope): Promise<TeacherUnitView[]> => {
      const key = `${scope.teacherId}\u0000${scope.schoolId}`;
      let pending = unitsByOwner.get(key);
      if (!pending) {
        pending = loadOwnerUnits(scope.teacherId, scope.schoolId);
        unitsByOwner.set(key, pending);
      }
      return pending;
    };
    // The class grade lookup and the owner's unit query are independent
    // reads (both keyed by server-derived scope fields), so they run
    // concurrently; placement still requires the authoritative grade.
    const perScope = await Promise.all(
      candidates.map(async (scope) => {
        const [grade, units, cards] = await Promise.all([
          typeof scope.grade === "function" ? scope.grade() : Promise.resolve(scope.grade),
          loadFor(scope),
          Promise.resolve(scope.cards),
        ]);
        return grade === null ? [] : placeCardsIntoUnits(units, grade, cards);
      }),
    );
    return perScope.flat();
  } catch (err) {
    try {
      log.warn("assignments.unitProjectionUnavailable", {
        caller: logContext,
        reason: err instanceof PlatformError ? err.code : "unhandled",
      });
    } catch {
      // Logging is observability, not lifecycle.
    }
    return [];
  }
}

// The grade of a class record, or null (needsSetup / missing / malformed).
export function classGradeOf(record: { readonly status?: unknown; readonly grade?: unknown } | undefined): string | null {
  if (!record) return null;
  if (record.status !== "active" && record.status !== "archived") return null;
  return typeof record.grade === "string" && record.grade.length > 0 ? record.grade : null;
}

// Student path: the grade of the class an assignment belongs to, read from
// the authoritative class record and cross-checked against the frozen
// ownership the caller already verified (assignment + recipient). Any
// mismatch or missing record yields null (no eligible units), never an error.
export async function loadVerifiedClassGrade(
  classId: string,
  teacherId: string,
  schoolId: string,
): Promise<string | null> {
  const snapshot = await classDocRef(classId).get();
  const record = snapshot.exists ? snapshot.data() : undefined;
  if (!record) return null;
  if (record.teacherId !== teacherId || record.schoolId !== schoolId) return null;
  return classGradeOf(record);
}
