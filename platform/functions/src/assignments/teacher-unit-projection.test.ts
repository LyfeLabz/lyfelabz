import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Timestamp } from "firebase-admin/firestore";

// Teacher Units Expansion P1: direct tests for the projection policy gate
// (real Option B validator and the committed synthetic policy fixture) and
// the pure placement rules. Handler-level behavior is covered in
// `assignments-list-for-student.test.ts` and
// `assessment-student-assignments-for-class.test.ts`.

const mockPolicyGet: jest.Mock = jest.fn();
const mockDoc: jest.Mock = jest.fn(() => ({ get: mockPolicyGet }));
jest.mock("../shared/firestore/admin", () => ({
  getAdminFirestore: () => ({ doc: mockDoc }),
}));

const mockUnitQueryGet: jest.Mock = jest.fn();
const mockWarn = jest.fn();
jest.mock("../shared", () => {
  const actual = jest.requireActual("../shared");
  return {
    ...actual,
    log: { info: jest.fn(), warn: mockWarn, error: jest.fn() },
    teacherUnitsCollectionRef: () => {
      const query = {
        where: () => query,
        limit: () => query,
        get: () => mockUnitQueryGet(),
      };
      return query;
    },
  };
});

import { compareTeacherUnitViews, type TeacherUnitView } from "../teacherUnits/teacher-unit-access";
import { TEACHER_UNITS_LIST_MAX } from "../teacherUnits/teacher-units-list";
import {
  classGradeOf,
  placeCardsIntoUnits,
  projectTeacherUnitsForScopes,
} from "./teacher-unit-projection";
import { readTeacherUnitProjectionPolicy } from "./teacher-unit-projection-policy";

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../fixtures/teacher-units-option-b/v1.json"), "utf8"),
) as { policies: Record<string, Record<string, unknown>> };
const TIME_FIELDS = ["createdAt", "updatedAt", "lastEnabledAt", "lastClosedAt"];
function policy(name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const p: Record<string, unknown> = { ...fixture.policies[name] };
  for (const key of TIME_FIELDS) {
    const v = p[key] as { seconds: number; nanoseconds: number } | null;
    if (v !== null) p[key] = new Timestamp(v.seconds, v.nanoseconds);
  }
  return { ...p, ...overrides };
}

const ORIGINAL_PROJECT = process.env.GCLOUD_PROJECT;
afterAll(() => {
  if (ORIGINAL_PROJECT === undefined) delete process.env.GCLOUD_PROJECT;
  else process.env.GCLOUD_PROJECT = ORIGINAL_PROJECT;
});
beforeEach(() => {
  jest.clearAllMocks();
  process.env.GCLOUD_PROJECT = "lyfelabz-staging";
});

function serve(data: unknown): void {
  mockPolicyGet.mockResolvedValue({ exists: data !== undefined, data: () => data });
}

describe("readTeacherUnitProjectionPolicy", () => {
  test("reads the Option B policy document", async () => {
    serve(policy("enabled"));
    await readTeacherUnitProjectionPolicy();
    expect(mockDoc).toHaveBeenCalledWith("platformConfig/teacherUnitsAvailability");
  });

  test("valid enabled policy for this project -> enabled", async () => {
    serve(policy("enabled"));
    await expect(readTeacherUnitProjectionPolicy()).resolves.toBe("enabled");
  });

  test.each(["closed", "prepared", "closedAfterEnable", "recovered"])(
    "valid %s policy -> closed",
    async (name) => {
      serve(policy(name));
      await expect(readTeacherUnitProjectionPolicy()).resolves.toBe("closed");
    },
  );

  test("missing policy -> closed", async () => {
    serve(undefined);
    await expect(readTeacherUnitProjectionPolicy()).resolves.toBe("closed");
  });

  test("malformed enabled policy -> closed (logged)", async () => {
    serve(policy("enabled", { approvedBackendBuildId: null }));
    await expect(readTeacherUnitProjectionPolicy()).resolves.toBe("closed");
    expect(mockWarn).toHaveBeenCalledWith("assignments.unitProjectionPolicyInvalid", expect.any(Object));
  });

  test("enabled policy written for another project -> closed", async () => {
    process.env.GCLOUD_PROJECT = "lyfelabz-prod";
    serve(policy("enabled"));
    await expect(readTeacherUnitProjectionPolicy()).resolves.toBe("closed");
  });

  test("project number not pinned to the project id -> closed", async () => {
    serve(policy("enabled", { projectNumber: "182791689935" }));
    await expect(readTeacherUnitProjectionPolicy()).resolves.toBe("closed");
  });

  test("no runtime project id -> closed without reading", async () => {
    delete process.env.GCLOUD_PROJECT;
    serve(policy("enabled"));
    await expect(readTeacherUnitProjectionPolicy()).resolves.toBe("closed");
    expect(mockPolicyGet).not.toHaveBeenCalled();
  });

  test("read errors propagate (the projection treats them as unavailable)", async () => {
    mockPolicyGet.mockRejectedValue(new Error("unavailable"));
    await expect(readTeacherUnitProjectionPolicy()).rejects.toThrow("unavailable");
  });
});

function view(unitId: string, overrides: Partial<TeacherUnitView> = {}): TeacherUnitView {
  return {
    unitId,
    grade: "7",
    title: `T ${unitId}`,
    description: "d",
    color: null,
    status: "active",
    archivedAtMillis: null,
    createdAtMillis: 1,
    updatedAtMillis: 1,
    resourceIds: [],
    sortOrder: 1,
    revision: 1,
    ...overrides,
  };
}

describe("placeCardsIntoUnits", () => {
  test("unit precedence matches the canonical Teacher Units reader order", () => {
    const units = [
      view("c", { sortOrder: 2, resourceIds: ["L"] }),
      view("b", { sortOrder: 1, createdAtMillis: 9, resourceIds: ["L"] }),
      view("a", { sortOrder: 1, createdAtMillis: 9, resourceIds: ["L"] }),
      view("z", { sortOrder: 1, createdAtMillis: 3, resourceIds: ["L"] }),
    ];
    const canonicalFirst = units.slice().sort(compareTeacherUnitViews)[0]?.unitId;
    const placed = placeCardsIntoUnits(units, "7", [{ assignmentIds: ["x"], lessonSlug: "L" }]);
    expect(placed.map((u) => u.unitId)).toEqual([canonicalFirst]);
    expect(canonicalFirst).toBe("z");
  });

  test("no grade, no cards, or no eligible unit -> []", () => {
    const units = [view("u", { resourceIds: ["L"] })];
    const card = [{ assignmentIds: ["x"], lessonSlug: "L" }];
    expect(placeCardsIntoUnits(units, null, card)).toEqual([]);
    expect(placeCardsIntoUnits(units, "7", [])).toEqual([]);
    expect(placeCardsIntoUnits(units, "8", card)).toEqual([]);
    expect(placeCardsIntoUnits([view("u", { status: "archived", resourceIds: ["L"] })], "7", card)).toEqual([]);
  });

  test("ties at one resource position order by first assignment id", () => {
    const placed = placeCardsIntoUnits([view("u", { resourceIds: ["L"] })], "7", [
      { assignmentIds: ["b"], lessonSlug: "L" },
      { assignmentIds: ["a"], lessonSlug: "L" },
    ]);
    expect(placed[0]?.assignmentIds).toEqual(["a", "b"]);
  });

  test("output carries only unitId, title, color and assignmentIds", () => {
    const placed = placeCardsIntoUnits(
      [view("u", { color: "teal", resourceIds: ["L"] })],
      "7",
      [{ assignmentIds: ["x"], lessonSlug: "L" }],
    );
    expect(placed).toEqual([{ unitId: "u", title: "T u", color: "teal", assignmentIds: ["x"] }]);
  });
});

describe("projectTeacherUnitsForScopes", () => {
  const scope = {
    classId: "c1",
    teacherId: "t1",
    schoolId: "s1",
    grade: "7",
    cards: [{ assignmentIds: ["x"], lessonSlug: "L" }],
  };
  const doc = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });
  const record = (overrides: Record<string, unknown> = {}) => ({
    teacherId: "t1", schoolId: "s1", grade: "7", title: "Unit", description: "d", status: "active",
    color: "not-a-palette-token", archivedAt: null, createdAt: null, updatedAt: null,
    resourceIds: ["L"], sortOrder: 1, revision: 1, ...overrides,
  });

  beforeEach(() => serve(policy("enabled")));

  test("malformed or foreign unit records are skipped; off-palette color becomes null", async () => {
    mockUnitQueryGet.mockResolvedValue({
      docs: [
        doc("bad-ids", record({ resourceIds: "L", sortOrder: 0 })),
        doc("foreign", record({ teacherId: "t2", sortOrder: 0 })),
        doc("ok", record()),
      ],
    });
    await expect(projectTeacherUnitsForScopes([scope], "test")).resolves.toEqual([
      { unitId: "ok", title: "Unit", color: null, assignmentIds: ["x"] },
    ]);
  });

  test("read ceiling exceeded -> [] and a warning, never truncation", async () => {
    mockUnitQueryGet.mockResolvedValue({
      docs: Array.from({ length: TEACHER_UNITS_LIST_MAX + 1 }, (_, i) => doc(`u${i}`, record())),
    });
    await expect(projectTeacherUnitsForScopes([scope], "test")).resolves.toEqual([]);
    expect(mockWarn).toHaveBeenCalledWith("assignments.unitProjectionUnavailable", {
      caller: "test",
      reason: "teacherUnits.listLimitExceeded",
    });
  });

  test("units are loaded once per owner across scopes", async () => {
    mockUnitQueryGet.mockResolvedValue({ docs: [doc("ok", record())] });
    const res = await projectTeacherUnitsForScopes([scope, { ...scope, classId: "c2" }], "test");
    expect(res).toHaveLength(2);
    expect(mockUnitQueryGet).toHaveBeenCalledTimes(1);
  });

  test("scopes without a grade or cards never read the policy", async () => {
    await expect(
      projectTeacherUnitsForScopes([{ ...scope, grade: null }, { ...scope, cards: [] }], "test"),
    ).resolves.toEqual([]);
    expect(mockPolicyGet).not.toHaveBeenCalled();
  });
});

describe("classGradeOf", () => {
  test("active/archived classes carry a grade; needsSetup and malformed do not", () => {
    expect(classGradeOf({ status: "active", grade: "7" })).toBe("7");
    expect(classGradeOf({ status: "archived", grade: "6" })).toBe("6");
    expect(classGradeOf({ status: "needsSetup" })).toBeNull();
    expect(classGradeOf({ status: "active", grade: "" })).toBeNull();
    expect(classGradeOf(undefined)).toBeNull();
  });
});
