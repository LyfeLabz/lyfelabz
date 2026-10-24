// A3-4 S2 - pure reconciliation of uncertain Teacher Units mutations
// (docs/platform/TEACHER_UNITS.md "A3-4 S2"). Firebase-free, DOM-free,
// stateless.
//
// A non-create mutation whose outcome is uncertain (the response was lost,
// or a refusal was decided inside a transaction an earlier SDK attempt of
// the same request may have committed, A3-3 section 5.1) is described by an
// immutable pending record. An authoritative read of the unit afterwards is
// compared with that record and yields a PRESENT-STATE finding only:
//
// - consistentWithRequest: the unit now holds what the request asked for.
// - notInEffectNow: the unit is still at the request's base revision and
//   does not hold what it asked for.
// - changedSince: the unit has a newer revision and does not hold what the
//   request asked for.
// - unknown: no usable read (failed, not found, not checked, inconsistent).
//
// No finding says whether the original request committed. A matching state
// may have been produced by another session, a newer revision may be another
// actor's write, and an unchanged revision is only what one read observed.
// Revisions and timestamps are never used to infer who made a change.
// Nothing here dispatches, schedules, or resends a mutation.

import type { TeacherUnitError, TeacherUnitErrorCategory } from "./errors";
import type { TeacherUnitColor } from "./unitColor";
import { compareTeacherUnits, type TeacherUnit, type TeacherUnitGrade } from "./types";

// ---------- Outcome certainty ----------

// Failures that prove the request did not commit: it was never sent
// (`compatibilityBlocked`), or the server refused it in request validation
// before any transaction started (field, request-shape, resource-placement
// and ceiling checks; TEACHER_UNITS.md section 6).
const NOT_COMMITTED: ReadonlySet<TeacherUnitErrorCategory> = new Set<TeacherUnitErrorCategory>([
  "compatibilityBlocked",
  "invalidField",
  "invalidRequest",
  "resourceRejected",
  "limitExceeded",
]);

// Uncertain failures for which one automatic authoritative read is useful.
// Account refusals (`unauthorized`) would be refused for a read too, and a
// `notFound` refusal already reports what a read would see.
const REREAD_AFTER: ReadonlySet<TeacherUnitErrorCategory> = new Set<TeacherUnitErrorCategory>([
  "network",
  "unexpected",
  "unconfirmed",
  "conflict",
  "invalidStatus",
]);

// After a failed revision-guarded mutation that was (or may have been)
// dispatched: may it have committed? Every category other than a proven
// pre-dispatch or pre-transaction refusal is uncertain. Not used for create,
// whose idempotency key lifecycle is owned by the create coordinator.
export function isUncertainMutationFailure(error: Pick<TeacherUnitError, "category">): boolean {
  return !NOT_COMMITTED.has(error.category);
}

// Whether an uncertain failure warrants the single automatic reread.
export function shouldRereadAfter(error: Pick<TeacherUnitError, "category">): boolean {
  return REREAD_AFTER.has(error.category);
}

// ---------- Pending records ----------

export type PendingMutationScope = {
  readonly teacherId: string;
  readonly schoolId: string;
};

// What a request asked for, exactly as dispatched (titles trimmed, the
// complete resource list). `purpose` names the teacher action behind a
// membership write; it never changes evaluation.
export type PendingUnitMutationIntent =
  | {
      readonly op: "update";
      readonly title?: string;
      readonly description?: string;
      readonly color?: TeacherUnitColor | null;
    }
  | { readonly op: "archive" }
  | { readonly op: "restore" }
  | {
      readonly op: "setResources";
      readonly purpose: "add" | "remove" | "move" | "repair";
      readonly resourceIds: ReadonlyArray<string>;
    };

export type PendingUnitMutationOperation = PendingUnitMutationIntent["op"];

export type PendingUnitMutationRecord = {
  readonly id: string;
  readonly scope: PendingMutationScope;
  readonly unitId: string;
  // The revision the request carried (`expectedRevision`).
  readonly expectedRevision: number;
  readonly intent: PendingUnitMutationIntent;
  // The unit's title when the request was made, for wording only.
  readonly titleAtRequest: string;
  readonly requestedAtMillis: number;
};

function freezeIntent(intent: PendingUnitMutationIntent): PendingUnitMutationIntent {
  switch (intent.op) {
    case "update": {
      const out: {
        op: "update";
        title?: string;
        description?: string;
        color?: TeacherUnitColor | null;
      } = { op: "update" };
      if (intent.title !== undefined) out.title = intent.title;
      if (intent.description !== undefined) out.description = intent.description;
      if (intent.color !== undefined) out.color = intent.color;
      return Object.freeze(out);
    }
    case "setResources":
      return Object.freeze({
        op: "setResources",
        purpose: intent.purpose,
        resourceIds: Object.freeze(intent.resourceIds.slice()),
      });
    default:
      return Object.freeze({ op: intent.op });
  }
}

export function createPendingUnitMutationRecord(input: PendingUnitMutationRecord): PendingUnitMutationRecord {
  return Object.freeze({
    id: input.id,
    scope: Object.freeze({ teacherId: input.scope.teacherId, schoolId: input.scope.schoolId }),
    unitId: input.unitId,
    expectedRevision: input.expectedRevision,
    intent: freezeIntent(input.intent),
    titleAtRequest: input.titleAtRequest,
    requestedAtMillis: input.requestedAtMillis,
  });
}

// ---------- Evaluation ----------

export type ReconciliationFinding = "consistentWithRequest" | "notInEffectNow" | "changedSince" | "unknown";

export type ReconciliationBasis =
  // The read returned the unit at the request's base revision.
  | "sameRevision"
  // The read returned the unit at a newer revision.
  | "newerRevision"
  // The read returned an OLDER revision than the request carried, or a
  // different unit: inconsistent evidence, never interpreted.
  | "inconsistent"
  // The read (or the refusal itself) reported the unit not found.
  | "notFound"
  // The read failed.
  | "readUnavailable"
  // No read after the uncertain outcome has been observed yet.
  | "notChecked";

export type ReconciliationEvaluation = {
  readonly finding: ReconciliationFinding;
  readonly basis: ReconciliationBasis;
  readonly observedRevision: number | null;
  // Always "undetermined": a present-state finding never decides whether
  // the original request committed.
  readonly commit: "undetermined";
};

export type UnitObservation =
  | { readonly kind: "unit"; readonly unit: TeacherUnit }
  // Two observations of the same revision with different content: the
  // evidence cannot be interpreted until a higher revision is observed.
  | { readonly kind: "conflicting" }
  | { readonly kind: "notFound" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "notChecked" };

const evaluation = (
  finding: ReconciliationFinding,
  basis: ReconciliationBasis,
  observedRevision: number | null,
): ReconciliationEvaluation => Object.freeze({ finding, basis, observedRevision, commit: "undetermined" });

export const NOT_CHECKED: ReconciliationEvaluation = evaluation("unknown", "notChecked", null);

const sameIds = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

// Whether `unit` holds everything `intent` asked for. Exactly the server's
// own "result already holds" rule for each operation.
export function requestedStateHolds(unit: TeacherUnit, intent: PendingUnitMutationIntent): boolean {
  switch (intent.op) {
    case "update":
      return (
        (intent.title === undefined || unit.title === intent.title) &&
        (intent.description === undefined || unit.description === intent.description) &&
        (intent.color === undefined || unit.color === intent.color)
      );
    case "archive":
      return unit.status === "archived";
    case "restore":
      return unit.status === "active";
    case "setResources":
      return sameIds(unit.resourceIds, intent.resourceIds);
  }
}

export function evaluateUnitReconciliation(
  record: PendingUnitMutationRecord,
  observation: UnitObservation,
): ReconciliationEvaluation {
  switch (observation.kind) {
    case "notChecked":
      return NOT_CHECKED;
    case "unavailable":
      return evaluation("unknown", "readUnavailable", null);
    case "notFound":
      return evaluation("unknown", "notFound", null);
    case "conflicting":
      return evaluation("unknown", "inconsistent", null);
  }
  const unit = observation.unit;
  if (unit.unitId !== record.unitId || unit.revision < record.expectedRevision) {
    return evaluation("unknown", "inconsistent", unit.revision);
  }
  const basis: ReconciliationBasis = unit.revision === record.expectedRevision ? "sameRevision" : "newerRevision";
  if (requestedStateHolds(unit, record.intent)) return evaluation("consistentWithRequest", basis, unit.revision);
  return evaluation(basis === "sameRevision" ? "notInEffectNow" : "changedSince", basis, unit.revision);
}

// ---------- Reorder (classification only; no UI consumer) ----------
//
// `teacherUnitsReorder` names a grade's complete active organization with a
// revision per unit. Its uncertain outcomes follow the same rules: never
// resent, and a read of the grade's active units yields a present-state
// finding only.

export type PendingReorderRecord = {
  readonly id: string;
  readonly scope: PendingMutationScope;
  readonly grade: TeacherUnitGrade;
  readonly units: ReadonlyArray<{ readonly unitId: string; readonly expectedRevision: number }>;
  readonly requestedAtMillis: number;
};

export type GradeObservation =
  | { readonly kind: "units"; readonly units: ReadonlyArray<TeacherUnit> }
  | { readonly kind: "unavailable" }
  | { readonly kind: "notChecked" };

export function createPendingReorderRecord(input: PendingReorderRecord): PendingReorderRecord {
  return Object.freeze({
    id: input.id,
    scope: Object.freeze({ teacherId: input.scope.teacherId, schoolId: input.scope.schoolId }),
    grade: input.grade,
    units: Object.freeze(
      input.units.map((u) => Object.freeze({ unitId: u.unitId, expectedRevision: u.expectedRevision })),
    ),
    requestedAtMillis: input.requestedAtMillis,
  });
}

export function evaluateReorderReconciliation(
  record: PendingReorderRecord,
  observation: GradeObservation,
): ReconciliationEvaluation {
  if (observation.kind === "notChecked") return NOT_CHECKED;
  if (observation.kind === "unavailable") return evaluation("unknown", "readUnavailable", null);
  const active = observation.units
    .filter((u) => u.grade === record.grade && u.status === "active")
    .slice()
    .sort(compareTeacherUnits);
  const byId = new Map(active.map((u) => [u.unitId, u]));
  const requested = record.units.map((u) => u.unitId);
  let newer = false;
  for (const entry of record.units) {
    const seen = byId.get(entry.unitId);
    if (seen === undefined) continue;
    if (seen.revision < entry.expectedRevision) return evaluation("unknown", "inconsistent", null);
    if (seen.revision > entry.expectedRevision) newer = true;
  }
  const sameMembership = active.length === requested.length && requested.every((id) => byId.has(id));
  if (!sameMembership) newer = true;
  const basis: ReconciliationBasis = newer ? "newerRevision" : "sameRevision";
  if (sameMembership && sameIds(active.map((u) => u.unitId), requested)) {
    return evaluation("consistentWithRequest", basis, null);
  }
  return evaluation(newer ? "changedSince" : "notInEffectNow", basis, null);
}
