// Unit color across the client model: tolerant response parsing (an older
// backend or an unknown palette value reads as neutral), the exact request
// payloads, durable create attempts saved before colors (still readable and
// replayed unchanged), and reconciliation that never treats an uncertain
// color save as confirmed unless the color actually holds.

const invocations: Array<{ name: string; payload: unknown }> = [];
let nextResponse: unknown = null;

jest.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => async (payload: unknown) => {
    invocations.push({ name, payload });
    return { data: nextResponse };
  },
}));

import type { Functions } from "firebase/functions";

import { createFirebaseTeacherUnitsCallables, parseTeacherUnit } from "./wire";
import { parseCreateAttemptRecord } from "./createAttemptStore";
import { requestedStateHolds } from "./mutationReconciliation";
import { TEACHER_UNIT_COLORS, isTeacherUnitColor, unitColorKey } from "./unitColor";
import type { TeacherUnit } from "./types";

const ENVELOPE = Object.freeze({
  schemaVersion: 1 as const,
  clientContractVersion: "teacher-units-v2" as const,
  policyInstanceId: "0f8fad5b-d9cb-469f-a165-70867728950e",
  policyGeneration: 3,
  backendReleaseId: "a".repeat(64),
  placementFingerprint: "b".repeat(64),
});
const PERMIT = async () => () => ENVELOPE;
const UNIT_A = "AbCdEfGhIjKlMnOpQrSt";
const raw = (over: Record<string, unknown> = {}) => ({
  unitId: UNIT_A,
  grade: "7",
  title: "Earth Systems",
  description: "",
  status: "active",
  archivedAtMillis: null,
  createdAtMillis: 1000,
  updatedAtMillis: 2000,
  resourceIds: [],
  sortOrder: 0,
  revision: 3,
  ...over,
});

beforeEach(() => {
  invocations.length = 0;
});

describe("palette", () => {
  test("is the curated seven, mirrored from the server", () => {
    expect(TEACHER_UNIT_COLORS).toEqual(["teal", "blue", "purple", "green", "gold", "coral", "slate"]);
    expect(isTeacherUnitColor("#ff0000")).toBe(false);
    expect(unitColorKey(null)).toBe("none");
  });
});

describe("parseTeacherUnit", () => {
  test.each([
    ["absent (backend before colors)", undefined, null],
    ["null (neutral)", null, null],
    ["a palette token", "coral", "coral"],
    ["an unknown value", "chartreuse", null],
  ])("color %s", (_label, color, expected) => {
    const data = color === undefined ? raw() : raw({ color });
    expect(parseTeacherUnit(data, "teacherUnitsGet").color).toBe(expected);
  });
});

describe("request payloads", () => {
  test("update sends a color token or null, and omits it when unchanged", async () => {
    const c = createFirebaseTeacherUnitsCallables({} as Functions, PERMIT);
    nextResponse = { unit: raw({ color: "teal", revision: 4 }), noop: false };
    await c.update({ unitId: UNIT_A, expectedRevision: 3, color: "teal" });
    nextResponse = { unit: raw({ revision: 5 }), noop: false };
    await c.update({ unitId: UNIT_A, expectedRevision: 4, color: null });
    nextResponse = { unit: raw({ title: "New", revision: 6 }), noop: false };
    await c.update({ unitId: UNIT_A, expectedRevision: 5, title: "New" });
    expect(invocations.map((i) => i.payload)).toEqual([
      { unitId: UNIT_A, expectedRevision: 3, color: "teal", compatibility: ENVELOPE },
      { unitId: UNIT_A, expectedRevision: 4, color: null, compatibility: ENVELOPE },
      { unitId: UNIT_A, expectedRevision: 5, title: "New", compatibility: ENVELOPE },
    ]);
  });

  test("create sends a color only when one was chosen", async () => {
    const c = createFirebaseTeacherUnitsCallables({} as Functions, PERMIT);
    nextResponse = { unit: raw({ color: "gold" }), replayed: false };
    await c.create({ grade: "7", title: "Water", idempotencyKey: "key_00000001", expectedSchoolId: "schoolA", color: "gold" });
    nextResponse = { unit: raw(), replayed: false };
    await c.create({ grade: "7", title: "Air", idempotencyKey: "key_00000002", expectedSchoolId: "schoolA" });
    expect(invocations[0]?.payload).toMatchObject({ color: "gold" });
    expect(invocations[1]?.payload).not.toHaveProperty("color");
  });
});

describe("durable create attempts", () => {
  const SCOPE = { teacherId: "teacherA", schoolId: "schoolA" };
  const stored = (payload: Record<string, unknown>) =>
    JSON.stringify({
      v: 2,
      key: "key_00000001",
      payload,
      context: SCOPE,
      status: "inFlight",
      reason: null,
      createdAtMs: 1000,
    });

  test("a record saved before colors is still readable and stays colorless", () => {
    const r = parseCreateAttemptRecord(stored({ grade: "7", title: "Earth", description: "" }), SCOPE, "key_00000001");
    expect(r?.payload).toEqual({ grade: "7", title: "Earth", description: "" });
  });

  test("a colored record keeps its color; an invalid color makes the record unreadable", () => {
    expect(
      parseCreateAttemptRecord(stored({ grade: "7", title: "Earth", description: "", color: "slate" }), SCOPE, "key_00000001")
        ?.payload.color,
    ).toBe("slate");
    expect(
      parseCreateAttemptRecord(stored({ grade: "7", title: "Earth", description: "", color: "red" }), SCOPE, "key_00000001"),
    ).toBeNull();
  });
});

describe("reconciliation", () => {
  const unit = (color: TeacherUnit["color"]): TeacherUnit =>
    Object.freeze({ ...(raw() as unknown as TeacherUnit), color });
  test("an uncertain color update holds only when the color actually holds", () => {
    expect(requestedStateHolds(unit("teal"), { op: "update", color: "teal" })).toBe(true);
    expect(requestedStateHolds(unit(null), { op: "update", color: "teal" })).toBe(false);
    expect(requestedStateHolds(unit(null), { op: "update", color: null })).toBe(true);
    expect(requestedStateHolds(unit("gold"), { op: "update", title: "Earth Systems" })).toBe(true);
  });
});
