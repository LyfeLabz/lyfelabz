import type { TeacherUnit } from "./types";
import { compareTeacherUnits } from "./types";
import {
  TeacherUnitOrderError,
  addResourceId,
  buildGradeReorderRequest,
  canMove,
  moveIdByStep,
  moveIndex,
  removeResourceId,
  sameOrder,
} from "./unitOrderMath";

const unit = (unitId: string, over: Partial<TeacherUnit> = {}): TeacherUnit => ({
  unitId,
  grade: "7",
  title: unitId,
  description: "",
  status: "active",
  archivedAtMillis: null,
  createdAtMillis: 0,
  updatedAtMillis: 0,
  resourceIds: [],
  sortOrder: 0,
  revision: 1,
  ...over,
});

describe("moveIndex / moveIdByStep", () => {
  const ids = Object.freeze(["a", "b", "c", "d"]);

  test("moves by index without mutating input", () => {
    expect(moveIndex(ids, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveIndex(ids, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });

  test("same position and out of range return the input itself", () => {
    expect(moveIndex(ids, 1, 1)).toBe(ids);
    expect(moveIndex(ids, -1, 0)).toBe(ids);
    expect(moveIndex(ids, 0, 4)).toBe(ids);
    expect(moveIndex(ids, 0.5, 1)).toBe(ids);
  });

  test("up/down moves and boundary no-ops", () => {
    expect(moveIdByStep(ids, "b", -1)).toEqual(["b", "a", "c", "d"]);
    expect(moveIdByStep(ids, "b", 1)).toEqual(["a", "c", "b", "d"]);
    expect(moveIdByStep(ids, "a", -1)).toBe(ids);
    expect(moveIdByStep(ids, "d", 1)).toBe(ids);
    expect(moveIdByStep(ids, "zz", 1)).toBe(ids);
    expect(canMove(ids, "a", -1)).toBe(false);
    expect(canMove(ids, "a", 1)).toBe(true);
    expect(canMove(ids, "d", 1)).toBe(false);
  });

  test("every move keeps each id exactly once", () => {
    for (let from = 0; from < ids.length; from++) {
      for (let to = 0; to < ids.length; to++) {
        const next = moveIndex(ids, from, to);
        expect([...next].sort()).toEqual([...ids].sort());
      }
    }
  });

  test("sameOrder", () => {
    expect(sameOrder(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameOrder(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameOrder(["a"], ["a", "b"])).toBe(false);
  });
});

describe("resource membership edits", () => {
  test("add appends once; duplicate add is a no-op", () => {
    const ids = Object.freeze(["a"]);
    expect(addResourceId(ids, "b")).toEqual(["a", "b"]);
    expect(addResourceId(ids, "a")).toBe(ids);
    expect(ids).toEqual(["a"]);
  });

  test("remove keeps order; missing id is a no-op", () => {
    const ids = Object.freeze(["a", "b", "c"]);
    expect(removeResourceId(ids, "b")).toEqual(["a", "c"]);
    expect(removeResourceId(ids, "z")).toBe(ids);
  });
});

describe("buildGradeReorderRequest", () => {
  const units = [
    unit("u1", { revision: 4 }),
    unit("u2", { revision: 2 }),
    unit("u3", { revision: 9 }),
    unit("arch", { status: "archived", revision: 3 }),
    unit("g6", { grade: "6", revision: 1 }),
  ];

  test("names every active unit of the grade with its authoritative revision", () => {
    expect(buildGradeReorderRequest("7", units, ["u3", "u1", "u2"])).toEqual({
      grade: "7",
      units: [
        { unitId: "u3", expectedRevision: 9 },
        { unitId: "u1", expectedRevision: 4 },
        { unitId: "u2", expectedRevision: 2 },
      ],
    });
  });

  test("refuses archived, other-grade, unknown, repeated, or omitted units", () => {
    expect(() => buildGradeReorderRequest("7", units, ["u1", "u2", "u3", "arch"])).toThrow(
      TeacherUnitOrderError,
    );
    expect(() => buildGradeReorderRequest("7", units, ["u1", "u2", "u3", "g6"])).toThrow(
      TeacherUnitOrderError,
    );
    expect(() => buildGradeReorderRequest("7", units, ["u1", "u2", "nope"])).toThrow(
      TeacherUnitOrderError,
    );
    expect(() => buildGradeReorderRequest("7", units, ["u1", "u1", "u2", "u3"])).toThrow(
      TeacherUnitOrderError,
    );
    expect(() => buildGradeReorderRequest("7", units, ["u1", "u2"])).toThrow(
      TeacherUnitOrderError,
    );
    expect(() => buildGradeReorderRequest("8", units, [])).toThrow(TeacherUnitOrderError);
  });

  test("combines with moveIdByStep for a Move Up action", () => {
    const ordered = units
      .filter((u) => u.grade === "7" && u.status === "active")
      .sort(compareTeacherUnits)
      .map((u) => u.unitId);
    const next = moveIdByStep(ordered, "u2", -1);
    expect(buildGradeReorderRequest("7", units, next).units.map((e) => e.unitId)).toEqual([
      "u2",
      "u1",
      "u3",
    ]);
  });
});

describe("compareTeacherUnits", () => {
  test("new units (sortOrder 0) first, then sortOrder, createdAt, unitId", () => {
    const list = [
      unit("x", { sortOrder: 2 }),
      unit("y", { sortOrder: 1 }),
      unit("n2", { sortOrder: 0, createdAtMillis: 20 }),
      unit("n1", { sortOrder: 0, createdAtMillis: 10 }),
      unit("tieB", { sortOrder: 3, createdAtMillis: 5 }),
      unit("tieA", { sortOrder: 3, createdAtMillis: 5 }),
    ];
    expect([...list].sort(compareTeacherUnits).map((u) => u.unitId)).toEqual([
      "n1",
      "n2",
      "y",
      "x",
      "tieA",
      "tieB",
    ]);
  });
});
