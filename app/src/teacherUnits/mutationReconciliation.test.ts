import { normalizeTeacherUnitError, type TeacherUnitErrorCategory } from "./errors";
import {
  createPendingReorderRecord,
  createPendingUnitMutationRecord,
  evaluateReorderReconciliation,
  evaluateUnitReconciliation,
  isUncertainMutationFailure,
  NOT_CHECKED,
  requestedStateHolds,
  shouldRereadAfter,
  type PendingUnitMutationIntent,
  type PendingUnitMutationRecord,
} from "./mutationReconciliation";
import type { TeacherUnit } from "./types";

// A3-4 S2 Phase 1: the pure present-state evaluator. Findings describe the
// unit as one read observed it; none decides whether the request committed.

const SCOPE = { teacherId: "teacherA", schoolId: "schoolA" };
const unit = (over: Partial<TeacherUnit> = {}): TeacherUnit => ({
  unitId: "Unit0000000000000001",
  grade: "7",
  title: "Plants",
  description: "Green things",
  status: "active",
  archivedAtMillis: null,
  createdAtMillis: 1,
  updatedAtMillis: 1,
  resourceIds: ["a", "b"],
  sortOrder: 0,
  revision: 4,
  ...over,
});
const record = (intent: PendingUnitMutationIntent, expectedRevision = 4): PendingUnitMutationRecord =>
  createPendingUnitMutationRecord({
    id: "p1",
    scope: SCOPE,
    unitId: "Unit0000000000000001",
    expectedRevision,
    intent,
    titleAtRequest: "Plants",
    requestedAtMillis: 10,
  });

const INTENTS: ReadonlyArray<{
  name: string;
  intent: PendingUnitMutationIntent;
  holds: Partial<TeacherUnit>;
  other: Partial<TeacherUnit>;
}> = [
  { name: "update", intent: { op: "update", title: "Seeds" }, holds: { title: "Seeds" }, other: { title: "Roots" } },
  {
    name: "update (both fields)",
    intent: { op: "update", title: "Seeds", description: "" },
    holds: { title: "Seeds", description: "" },
    other: { title: "Seeds", description: "Changed" },
  },
  { name: "archive", intent: { op: "archive" }, holds: { status: "archived", archivedAtMillis: 9 }, other: {} },
  { name: "restore", intent: { op: "restore" }, holds: { status: "active", archivedAtMillis: null }, other: { status: "archived", archivedAtMillis: 9 } },
  {
    name: "setResources",
    intent: { op: "setResources", purpose: "move", resourceIds: ["b", "a"] },
    holds: { resourceIds: ["b", "a"] },
    other: { resourceIds: ["a", "b", "c"] },
  },
];

describe.each(INTENTS)("evaluateUnitReconciliation: $name", ({ intent, holds, other }) => {
  // restore starts archived; everything else starts active.
  const base = intent.op === "restore" ? { status: "archived" as const, archivedAtMillis: 9 } : {};

  test("an unchanged revision that does not hold the request: not in effect now", () => {
    const ev = evaluateUnitReconciliation(record(intent), { kind: "unit", unit: unit({ ...base, revision: 4 }) });
    expect(ev).toEqual({ finding: "notInEffectNow", basis: "sameRevision", observedRevision: 4, commit: "undetermined" });
  });

  test("a newer revision that holds the request: consistent, never attributed to this request", () => {
    const ev = evaluateUnitReconciliation(record(intent), { kind: "unit", unit: unit({ ...base, ...holds, revision: 5 }) });
    expect(ev).toEqual({ finding: "consistentWithRequest", basis: "newerRevision", observedRevision: 5, commit: "undetermined" });
  });

  test("another actor produced the same state several revisions later: still only consistent", () => {
    const ev = evaluateUnitReconciliation(record(intent), { kind: "unit", unit: unit({ ...base, ...holds, revision: 12 }) });
    expect(ev.finding).toBe("consistentWithRequest");
    expect(ev.commit).toBe("undetermined");
  });

  test("a newer revision that does not hold the request: changed since", () => {
    const ev = evaluateUnitReconciliation(record(intent), { kind: "unit", unit: unit({ ...base, ...other, revision: 6 }) });
    expect(ev).toEqual({ finding: "changedSince", basis: "newerRevision", observedRevision: 6, commit: "undetermined" });
  });

  test("the read is unavailable, not found, or not yet made: unknown", () => {
    expect(evaluateUnitReconciliation(record(intent), { kind: "unavailable" })).toMatchObject({ finding: "unknown", basis: "readUnavailable" });
    expect(evaluateUnitReconciliation(record(intent), { kind: "notFound" })).toMatchObject({ finding: "unknown", basis: "notFound" });
    expect(evaluateUnitReconciliation(record(intent), { kind: "notChecked" })).toBe(NOT_CHECKED);
  });

  test("an older revision or another unit is inconsistent evidence, never interpreted", () => {
    expect(evaluateUnitReconciliation(record(intent), { kind: "unit", unit: unit({ ...base, ...holds, revision: 3 }) }))
      .toMatchObject({ finding: "unknown", basis: "inconsistent" });
    expect(
      evaluateUnitReconciliation(record(intent), { kind: "unit", unit: unit({ ...base, ...holds, unitId: "Other000000000000000", revision: 5 }) }),
    ).toMatchObject({ finding: "unknown", basis: "inconsistent" });
  });
});

describe("requestedStateHolds", () => {
  test("update compares only the fields the request sent", () => {
    expect(requestedStateHolds(unit({ title: "Seeds", description: "anything" }), { op: "update", title: "Seeds" })).toBe(true);
    expect(requestedStateHolds(unit({ title: "Seeds" }), { op: "update", description: "" })).toBe(false);
  });
  test("membership order is significant", () => {
    expect(requestedStateHolds(unit({ resourceIds: ["a", "b"] }), { op: "setResources", purpose: "move", resourceIds: ["b", "a"] })).toBe(false);
  });
});

describe("records", () => {
  test("are deeply immutable and copy the dispatched resource list", () => {
    const ids = ["a", "b"];
    const r = record({ op: "setResources", purpose: "add", resourceIds: ids });
    ids.push("c");
    expect(r.intent).toEqual({ op: "setResources", purpose: "add", resourceIds: ["a", "b"] });
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.scope)).toBe(true);
    expect(Object.isFrozen(r.intent)).toBe(true);
    if (r.intent.op === "setResources") expect(Object.isFrozen(r.intent.resourceIds)).toBe(true);
  });
});

describe("outcome certainty classification", () => {
  const err = (code: string) => normalizeTeacherUnitError({ details: { code } });
  test.each([
    "teacherUnits.responseUnavailable",
    "teacherUnits.availabilityClosed",
    "teacherUnits.policyChanged",
    "teacherUnits.writeConflict",
    "teacherUnits.invalidStatus",
    "unavailable",
    "deadline-exceeded",
    "functions/internal",
    "permission-denied",
    "teacherUnits.notFound",
  ])("%s may follow a commit: uncertain", (code) => {
    expect(isUncertainMutationFailure(err(code))).toBe(true);
  });
  test.each([
    "teacherUnits.invalidTitle",
    "teacherUnits.invalidRequest",
    "teacherUnits.compatibilityRequired",
    "teacherUnits.invalidCompatibility",
    "teacherUnits.resourceNotPlaceable",
    "teacherUnits.duplicateResource",
  ])("%s is decided before any transaction: not uncertain", (code) => {
    expect(isUncertainMutationFailure(err(code))).toBe(false);
  });
  test("a request that was never sent (compatibility) is not uncertain", () => {
    expect(isUncertainMutationFailure({ category: "compatibilityBlocked" })).toBe(false);
  });
  test("only reads after failures a read can usefully reconcile", () => {
    const yes: TeacherUnitErrorCategory[] = ["network", "unexpected", "unconfirmed", "conflict", "invalidStatus"];
    const no: TeacherUnitErrorCategory[] = ["unauthorized", "notFound", "compatibilityBlocked", "invalidField", "resourceRejected"];
    for (const category of yes) expect(shouldRereadAfter({ category })).toBe(true);
    for (const category of no) expect(shouldRereadAfter({ category })).toBe(false);
  });
});

// Reorder has no UI or controller consumer; only its classification and
// evaluation exist.
describe("evaluateReorderReconciliation", () => {
  const u1 = unit({ unitId: "U1", revision: 2, sortOrder: 1 });
  const u2 = unit({ unitId: "U2", revision: 3, sortOrder: 2 });
  const rec = createPendingReorderRecord({
    id: "r1",
    scope: SCOPE,
    grade: "7",
    units: [
      { unitId: "U2", expectedRevision: 3 },
      { unitId: "U1", expectedRevision: 2 },
    ],
    requestedAtMillis: 1,
  });
  test("unchanged revisions in the old order: not in effect now", () => {
    expect(evaluateReorderReconciliation(rec, { kind: "units", units: [u1, u2] }).finding).toBe("notInEffectNow");
  });
  test("the requested order holds: consistent (by anyone)", () => {
    const now = [{ ...u2, sortOrder: 1, revision: 4 }, { ...u1, sortOrder: 2, revision: 3 }];
    expect(evaluateReorderReconciliation(rec, { kind: "units", units: now })).toMatchObject({
      finding: "consistentWithRequest",
      commit: "undetermined",
    });
  });
  test("membership or revisions changed and the order does not hold: changed since", () => {
    const u3 = unit({ unitId: "U3", revision: 1, sortOrder: 0 });
    expect(evaluateReorderReconciliation(rec, { kind: "units", units: [u3, u1, u2] }).finding).toBe("changedSince");
    expect(evaluateReorderReconciliation(rec, { kind: "units", units: [u1, { ...u2, revision: 9 }] }).finding).toBe("changedSince");
  });
  test("unavailable, not checked, or older revisions: unknown", () => {
    expect(evaluateReorderReconciliation(rec, { kind: "unavailable" }).finding).toBe("unknown");
    expect(evaluateReorderReconciliation(rec, { kind: "notChecked" })).toBe(NOT_CHECKED);
    expect(evaluateReorderReconciliation(rec, { kind: "units", units: [{ ...u1, revision: 1 }, u2] }).basis).toBe("inconsistent");
  });
});
