type FakeSnapshot = { exists: boolean; data: () => unknown };

const pointerRegistry = new Map<string, FakeSnapshot>();
const mockAssignmentsCurrentDocRef = jest.fn(
  (classId: string, lessonSlug: string) => ({
    get: () =>
      Promise.resolve(
        pointerRegistry.get(`${classId}/${lessonSlug}`) ?? {
          exists: false,
          data: () => undefined,
        },
      ),
  }),
);

const assignmentRegistry = new Map<string, FakeSnapshot>();
const mockAssignmentDocRef = jest.fn((assignmentId: string) => ({
  get: () =>
    Promise.resolve(
      assignmentRegistry.get(assignmentId) ?? {
        exists: false,
        data: () => undefined,
      },
    ),
}));

jest.mock("../shared", () => ({
  assignmentsCurrentDocRef: mockAssignmentsCurrentDocRef,
  assignmentDocRef: mockAssignmentDocRef,
}));

import { collapsePublishedToCurrent } from "./collapse-published-to-current";

const TEACHER_ID = "teacher-1";
const SCHOOL_ID = "school-a";
const DISTRICT_ID = "district-1";
const CLASS_ID = "class-abc";
const OTHER_CLASS_ID = "class-xyz";
const LESSON_SLUG = "lesson_g7_earths-layers";
const OTHER_LESSON_SLUG = "lesson_g7_water-cycle";

type Item = {
  readonly assignmentId: string;
  readonly classId: string;
  readonly lessonSlug: string;
  readonly publishedAt: number;
};

const item = (
  assignmentId: string,
  classId: string,
  lessonSlug: string,
  publishedAt: number,
): Item => ({ assignmentId, classId, lessonSlug, publishedAt });

const scope = () => ({
  teacherId: TEACHER_ID,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
});

function seedPointer(
  classId: string,
  lessonSlug: string,
  assignmentId: string,
): void {
  pointerRegistry.set(`${classId}/${lessonSlug}`, {
    exists: true,
    data: () => ({
      classId,
      lessonSlug,
      assignmentId,
      teacherId: TEACHER_ID,
      schoolId: SCHOOL_ID,
      setAt: { __sentinel: "timestamp" },
      setBy: TEACHER_ID,
      source: "teacherResolution",
    }),
  });
  assignmentRegistry.set(assignmentId, {
    exists: true,
    data: () => ({
      classId,
      teacherId: TEACHER_ID,
      schoolId: SCHOOL_ID,
      lessonSlug,
      mode: "classroom",
      status: "published",
      createdAt: { __sentinel: "timestamp" },
    }),
  });
}

beforeEach(() => {
  pointerRegistry.clear();
  assignmentRegistry.clear();
  mockAssignmentsCurrentDocRef.mockClear();
  mockAssignmentDocRef.mockClear();
});

describe("collapsePublishedToCurrent", () => {
  test("a single-item group is returned unchanged with no resolver read at all", async () => {
    const items = [item("a-1", CLASS_ID, LESSON_SLUG, 100)];
    const result = await collapsePublishedToCurrent(items, scope);
    expect(result).toEqual(items);
    expect(mockAssignmentsCurrentDocRef).not.toHaveBeenCalled();
  });

  test("multiple items + valid Current collapses to exactly the Current item, even when it is not the newest", async () => {
    seedPointer(CLASS_ID, LESSON_SLUG, "a-old");
    const items = [
      item("a-old", CLASS_ID, LESSON_SLUG, 100),
      item("a-new", CLASS_ID, LESSON_SLUG, 300),
      item("a-mid", CLASS_ID, LESSON_SLUG, 200),
    ];
    const result = await collapsePublishedToCurrent(items, scope);
    expect(result).toHaveLength(1);
    expect(result[0]?.assignmentId).toBe("a-old");
  });

  test("multiple items + no Current pointer returns every item unchanged (no heuristic fallback)", async () => {
    const items = [
      item("a-1", CLASS_ID, LESSON_SLUG, 100),
      item("a-2", CLASS_ID, LESSON_SLUG, 200),
    ];
    const result = await collapsePublishedToCurrent(items, scope);
    expect(result).toHaveLength(2);
    expect(new Set(result.map((r) => r.assignmentId))).toEqual(
      new Set(["a-1", "a-2"]),
    );
  });

  test("multiple items + a stale/cross-scope Current pointer returns every item unchanged", async () => {
    // Pointer exists but names an assignment from a different class -
    // resolveValidCurrentAssignmentId rejects this as assignmentClassMismatch.
    pointerRegistry.set(`${CLASS_ID}/${LESSON_SLUG}`, {
      exists: true,
      data: () => ({
        classId: CLASS_ID,
        lessonSlug: LESSON_SLUG,
        assignmentId: "a-stale",
        teacherId: TEACHER_ID,
        schoolId: SCHOOL_ID,
        setAt: { __sentinel: "timestamp" },
        setBy: TEACHER_ID,
        source: "publish",
      }),
    });
    assignmentRegistry.set("a-stale", {
      exists: true,
      data: () => ({
        classId: OTHER_CLASS_ID,
        teacherId: TEACHER_ID,
        schoolId: SCHOOL_ID,
        lessonSlug: LESSON_SLUG,
        mode: "classroom",
        status: "published",
        createdAt: { __sentinel: "timestamp" },
      }),
    });
    const items = [
      item("a-1", CLASS_ID, LESSON_SLUG, 100),
      item("a-2", CLASS_ID, LESSON_SLUG, 200),
    ];
    const result = await collapsePublishedToCurrent(items, scope);
    expect(result).toHaveLength(2);
  });

  test("a resolved Current whose assignmentId is not present in this item set falls back to the full bucket, not an empty result", async () => {
    seedPointer(CLASS_ID, LESSON_SLUG, "a-elsewhere");
    const items = [
      item("a-1", CLASS_ID, LESSON_SLUG, 100),
      item("a-2", CLASS_ID, LESSON_SLUG, 200),
    ];
    const result = await collapsePublishedToCurrent(items, scope);
    expect(result).toHaveLength(2);
  });

  test("does not collapse across different classes sharing the same lessonSlug", async () => {
    seedPointer(CLASS_ID, LESSON_SLUG, "a-current-1");
    const items = [
      item("a-current-1", CLASS_ID, LESSON_SLUG, 100),
      item("a-other-2", CLASS_ID, LESSON_SLUG, 200),
      item("a-b1", OTHER_CLASS_ID, LESSON_SLUG, 150),
    ];
    const result = await collapsePublishedToCurrent(items, scope);
    const ids = result.map((r) => r.assignmentId).sort();
    expect(ids).toEqual(["a-b1", "a-current-1"]);
  });

  test("does not collapse across different lessons in the same class", async () => {
    const items = [
      item("a-1", CLASS_ID, LESSON_SLUG, 100),
      item("a-2", CLASS_ID, OTHER_LESSON_SLUG, 200),
    ];
    const result = await collapsePublishedToCurrent(items, scope);
    const ids = result.map((r) => r.assignmentId).sort();
    expect(ids).toEqual(["a-1", "a-2"]);
  });
});
