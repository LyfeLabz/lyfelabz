type FakeSnapshot = { exists: boolean; data: () => unknown };

const pointerRegistry = new Map<string, FakeSnapshot>();
const assignmentRegistry = new Map<string, Record<string, unknown>>();
const mockClassQueries: string[] = [];

jest.mock("../shared", () => ({
  assignmentsCurrentDocRef: (classId: string, lessonSlug: string) => ({
    get: () =>
      Promise.resolve(
        pointerRegistry.get(`${classId}/${lessonSlug}`) ?? {
          exists: false,
          data: () => undefined,
        },
      ),
  }),
  assignmentDocRef: (id: string) => ({
    get: () => {
      const record = assignmentRegistry.get(id);
      return Promise.resolve({ exists: record !== undefined, data: () => record });
    },
  }),
  assignmentsCollectionRef: () => ({
    where: (_field: string, _op: string, classId: string) => ({
      get: () => {
        mockClassQueries.push(classId);
        return Promise.resolve({
          docs: Array.from(assignmentRegistry.entries())
            .filter(([, r]) => r.classId === classId)
            .map(([id, r]) => ({ id, data: () => r })),
        });
      },
    }),
  }),
}));

import {
  createClassAssignmentsLoader,
  isSupersededOccurrence,
  resolveCurrentOccurrenceGroup,
} from "./current-occurrence-group";

const TEACHER = "teacher-1";
const SCHOOL = "school-a";
const DISTRICT = "district-1";
const CLASS = "class-a";
const LESSON = "engineering-design";
const scope = { classId: CLASS, lessonSlug: LESSON, teacherId: TEACHER, schoolId: SCHOOL };

function seed(id: string, overrides: Record<string, unknown> = {}): void {
  assignmentRegistry.set(id, {
    classId: CLASS,
    lessonSlug: LESSON,
    teacherId: TEACHER,
    schoolId: SCHOOL,
    mode: "classroom",
    status: "published",
    ...overrides,
  });
}

function pointTo(assignmentId: string, lessonSlug = LESSON): void {
  pointerRegistry.set(`${CLASS}/${lessonSlug}`, {
    exists: true,
    data: () => ({
      classId: CLASS,
      lessonSlug,
      assignmentId,
      teacherId: TEACHER,
      schoolId: SCHOOL,
      setAt: { __sentinel: "timestamp" },
      setBy: TEACHER,
      source: "teacherResolution",
    }),
  });
}

beforeEach(() => {
  pointerRegistry.clear();
  assignmentRegistry.clear();
  mockClassQueries.length = 0;
});

describe("resolveCurrentOccurrenceGroup", () => {
  test("valid Current: every in-scope occurrence (any status) is a member; Current is the pointer's, not the newest", async () => {
    seed("a-A", { status: "closed" });
    seed("a-B");
    seed("a-C");
    seed("a-D", { status: "archived" });
    pointTo("a-B");
    const group = await resolveCurrentOccurrenceGroup(scope, DISTRICT);
    expect(group.resolution).toBe("valid");
    if (group.resolution !== "valid") return;
    expect(group.currentAssignmentId).toBe("a-B");
    expect(group.occurrences.map((o) => o.assignmentId).sort()).toEqual([
      "a-A",
      "a-B",
      "a-C",
      "a-D",
    ]);
  });

  test("scope excludes other lessons, other teachers, and other schools in the same class", async () => {
    seed("a-cur");
    seed("a-old");
    seed("x-lesson", { lessonSlug: "other-lesson" });
    seed("x-teacher", { teacherId: "someone-else" });
    seed("x-school", { schoolId: "school-z" });
    pointTo("a-cur");
    const group = await resolveCurrentOccurrenceGroup(scope, DISTRICT);
    if (group.resolution !== "valid") throw new Error("expected valid");
    expect(group.occurrences.map((o) => o.assignmentId).sort()).toEqual(["a-cur", "a-old"]);
  });

  test.each([
    ["missing pointer", () => undefined],
    ["pointer names a missing assignment", () => pointTo("a-gone")],
    ["pointer names an out-of-scope assignment", () => {
      seed("a-other", { teacherId: "someone-else" });
      pointTo("a-other");
    }],
  ])("no valid Current (%s) -> unresolved, and no class enumeration at all", async (_label, arrange) => {
    seed("a-1");
    seed("a-2");
    arrange();
    const group = await resolveCurrentOccurrenceGroup(scope, DISTRICT);
    expect(group).toEqual({ resolution: "unresolved" });
    expect(mockClassQueries).toEqual([]);
  });

  test("one shared loader enumerates a class once across several lesson groups", async () => {
    seed("a-cur");
    seed("b-cur", { lessonSlug: "other-lesson" });
    pointTo("a-cur");
    pointTo("b-cur", "other-lesson");
    const loader = createClassAssignmentsLoader();
    await resolveCurrentOccurrenceGroup(scope, DISTRICT, loader);
    await resolveCurrentOccurrenceGroup({ ...scope, lessonSlug: "other-lesson" }, DISTRICT, loader);
    expect(mockClassQueries).toEqual([CLASS]);
  });
});

describe("resolveCurrentOccurrenceGroup - managed but no longer operational", () => {
  test.each(["closed", "archived"])(
    "authoritative pointer naming a %s in-scope assignment -> inactive (never unresolved/legacy), pointed id kept",
    async (status) => {
      seed("a-old");
      seed("a-cur", { status });
      pointTo("a-cur");
      const group = await resolveCurrentOccurrenceGroup(scope, DISTRICT);
      expect(group.resolution).toBe("inactive");
      if (group.resolution !== "inactive") return;
      expect(group.currentAssignmentId).toBe("a-cur");
      expect(group.occurrences.map((o) => o.assignmentId).sort()).toEqual(["a-cur", "a-old"]);
    },
  );
});

describe("isSupersededOccurrence", () => {
  test("true only for a different occurrence when a VALID Current exists", async () => {
    seed("a-old");
    seed("a-cur");
    pointTo("a-cur");
    const old = assignmentRegistry.get("a-old") as never;
    const cur = assignmentRegistry.get("a-cur") as never;
    expect(await isSupersededOccurrence("a-old", old, DISTRICT)).toBe(true);
    expect(await isSupersededOccurrence("a-cur", cur, DISTRICT)).toBe(false);
  });

  test("closing the managed Current never makes an older published occurrence operational again", async () => {
    seed("a-old");
    seed("a-cur", { status: "closed" });
    pointTo("a-cur");
    const old = assignmentRegistry.get("a-old") as never;
    expect(await isSupersededOccurrence("a-old", old, DISTRICT)).toBe(true);
  });

  test("never superseded when no valid Current exists (legacy unresolved scope)", async () => {
    seed("a-old");
    const old = assignmentRegistry.get("a-old") as never;
    expect(await isSupersededOccurrence("a-old", old, DISTRICT)).toBe(false);
  });
});
