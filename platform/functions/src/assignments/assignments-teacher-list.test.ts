import type { CallableRequest } from "firebase-functions/v2/https";

const mockAssignmentsGet = jest.fn();
const mockWhere1 = jest.fn();
const mockWhere2 = jest.fn();
const mockWhere3 = jest.fn();

const mockAssignmentsCollectionRef = jest.fn(() => ({ where: mockWhere1 }));

const mockClassGet = jest.fn();
const mockClassDocRef: jest.Mock = jest.fn(() => ({ get: mockClassGet }));

// Current-aware dashboard dedup: `collapsePublishedToCurrent` calls the
// real (unmocked) `resolveValidCurrentAssignmentId`, which reads the
// pointer and (only if the pointer resolves) the pointed-to assignment
// through these two seams. Defaulting the pointer to "no document" means
// every pre-existing test in this file - none of which set up a Current
// pointer - keeps its exact prior behavior: any class+lesson group with
// more than one published item resolves "unresolved" and is returned in
// full, unchanged. Tests that specifically exercise collapsing configure
// these per-call.
const mockCurrentDocGet: jest.Mock = jest.fn(() =>
  Promise.resolve({ exists: false, data: () => undefined }),
);
const mockAssignmentsCurrentDocRef: jest.Mock = jest.fn(() => ({
  get: mockCurrentDocGet,
}));
const mockAssignmentGet: jest.Mock = jest.fn(() =>
  Promise.resolve({ exists: false, data: () => undefined }),
);
const mockAssignmentDocRef: jest.Mock = jest.fn(() => ({
  get: mockAssignmentGet,
}));

const mockRequireDistrictContext = jest.fn();

const mockLogInfo = jest.fn();

jest.mock("firebase-admin/firestore", () => ({}));

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    log: { info: mockLogInfo, warn: jest.fn(), error: jest.fn() },
    assignmentsCollectionRef: mockAssignmentsCollectionRef,
    classDocRef: mockClassDocRef,
    assignmentsCurrentDocRef: mockAssignmentsCurrentDocRef,
    assignmentDocRef: mockAssignmentDocRef,
    requireDistrictContext: mockRequireDistrictContext,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __assignmentsTeacherListHandler } from "./assignments-teacher-list";

const TEACHER_UID = "teacher-uid";
const SCHOOL_ID = "school-a";
const DISTRICT_ID = "district-1";

const VALID_CONTEXT = Object.freeze({
  uid: TEACHER_UID,
  role: "teacher" as const,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
});

function makeRequest(
  data: Record<string, unknown> = {},
): CallableRequest<unknown> {
  return {
    data,
    auth: { uid: TEACHER_UID, token: {} } as never,
    rawRequest: {} as never,
  };
}

function assignmentDoc(
  id: string,
  overrides: Record<string, unknown> = {},
): { readonly id: string; data(): unknown } {
  return {
    id,
    data: () => ({
      classId: "class-a",
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      lessonSlug: "lesson_g7_earths-layers",
      mode: "classroom",
      status: "published",
      createdAt: {},
      title: "Earth's Layers",
      ...overrides,
    }),
  };
}

function classDoc(
  id: string,
  overrides: Record<string, unknown> = {},
): { readonly exists: boolean; data(): unknown } {
  return {
    exists: true,
    data: () => ({
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      title: `Class ${id}`,
      grade: "7",
      block: "A",
      joinCode: "abc",
      status: "active",
      createdAt: {},
      ...overrides,
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWhere1.mockReturnValue({ where: mockWhere2 });
  mockWhere2.mockReturnValue({ where: mockWhere3 });
  mockWhere3.mockReturnValue({ get: mockAssignmentsGet });
  mockRequireDistrictContext.mockResolvedValue(VALID_CONTEXT);
});

describe("assignmentsTeacherList - authorization", () => {
  test("rejects non-teacher role", async () => {
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_CONTEXT,
      role: "student",
    });
    await expect(
      __assignmentsTeacherListHandler(makeRequest()),
    ).rejects.toBeInstanceOf(PlatformError);
  });

  test("propagates missing-district-context rejection", async () => {
    const err = new PlatformError("district.missing", "no district");
    mockRequireDistrictContext.mockRejectedValue(err);
    await expect(__assignmentsTeacherListHandler(makeRequest())).rejects.toBe(
      err,
    );
  });
});

describe("assignmentsTeacherList - query shape", () => {
  test("queries by teacherId, schoolId, and published/closed statuses", async () => {
    mockAssignmentsGet.mockResolvedValue({ docs: [] });
    const res = await __assignmentsTeacherListHandler(makeRequest());
    expect(mockWhere1).toHaveBeenCalledWith("teacherId", "==", TEACHER_UID);
    expect(mockWhere2).toHaveBeenCalledWith("schoolId", "==", SCHOOL_ID);
    expect(mockWhere3).toHaveBeenCalledWith(
      "status",
      "in",
      // `archived` is read (never returned) so the Current-aware collapse
      // sees every occurrence of a class + lesson.
      ["published", "closed", "archived"],
    );
    expect(res.items).toEqual([]);
  });
});

describe("assignmentsTeacherList - response filtering", () => {
  test("returns owned published assignment with resolved className", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [assignmentDoc("a1")],
    });
    mockClassGet.mockResolvedValue(classDoc("class-a"));
    const res = await __assignmentsTeacherListHandler(makeRequest());
    expect(res.items).toEqual([
      {
        assignmentId: "a1",
        lessonSlug: "lesson_g7_earths-layers",
        title: "Earth's Layers",
        classId: "class-a",
        className: "Class class-a",
        status: "published",
        publishedAt: null,
      },
    ]);
  });

  test("excludes cross-owner assignment defensively", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [assignmentDoc("a2", { teacherId: "other-teacher" })],
    });
    const res = await __assignmentsTeacherListHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("excludes cross-district assignment defensively", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [assignmentDoc("a3", { schoolId: "other-school" })],
    });
    const res = await __assignmentsTeacherListHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("excludes assignment whose class is owned by another teacher", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [assignmentDoc("a4")],
    });
    mockClassGet.mockResolvedValue(
      classDoc("class-a", { teacherId: "other-teacher" }),
    );
    const res = await __assignmentsTeacherListHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("closed assignment retained", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [assignmentDoc("a5", { status: "closed" })],
    });
    mockClassGet.mockResolvedValue(classDoc("class-a"));
    const res = await __assignmentsTeacherListHandler(makeRequest());
    expect(res.items).toHaveLength(1);
    expect(res.items[0].status).toBe("closed");
  });

  test("deterministic ordering by (classId, assignmentId)", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [
        assignmentDoc("z", { classId: "class-b" }),
        assignmentDoc("a", { classId: "class-b" }),
        assignmentDoc("m", { classId: "class-a" }),
      ],
    });
    mockClassGet.mockImplementation(() => Promise.resolve(classDoc("c")));
    const res = await __assignmentsTeacherListHandler(makeRequest());
    expect(res.items.map((i) => i.assignmentId)).toEqual(["m", "a", "z"]);
  });

  test("returns no student or attempt fields", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [assignmentDoc("a6")],
    });
    mockClassGet.mockResolvedValue(classDoc("class-a"));
    const res = await __assignmentsTeacherListHandler(makeRequest());
    const item = res.items[0];
    const keys = Object.keys(item);
    for (const forbidden of [
      "studentId",
      "recipientId",
      "attemptId",
      "sessionId",
      "teacherId",
      "districtId",
      "schoolId",
      "answerKey",
      "explanation",
      "recipients",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  test("empty result returns empty items array", async () => {
    mockAssignmentsGet.mockResolvedValue({ docs: [] });
    const res = await __assignmentsTeacherListHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("Sprint 13G: projects instructions when the record carries them", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [
        assignmentDoc("a-with-instructions", {
          instructions: "Read the intro before answering.",
        }),
      ],
    });
    mockClassGet.mockResolvedValue(classDoc("class-a"));
    const res = await __assignmentsTeacherListHandler(makeRequest());
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      instructions: "Read the intro before answering.",
    });
  });

  test("Sprint 15: projects publishedAt as epoch ms for published records", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [
        assignmentDoc("a-published", {
          publishedAt: { toMillis: () => 1_700_000_000_000 },
        }),
      ],
    });
    mockClassGet.mockResolvedValue(classDoc("class-a"));
    const res = await __assignmentsTeacherListHandler(makeRequest());
    expect(res.items[0]).toMatchObject({ publishedAt: 1_700_000_000_000 });
  });

  test("Sprint 15: projects publishedAt as null for draft records", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [assignmentDoc("d-null", { status: "draft" })],
    });
    mockClassGet.mockResolvedValue(classDoc("class-a"));
    const res = await __assignmentsTeacherListHandler(
      makeRequest({ includeDrafts: true }),
    );
    expect(res.items[0]).toMatchObject({ publishedAt: null });
  });

  test("Sprint 13G: omits instructions when the record has no instructions", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [assignmentDoc("a-no-instructions")],
    });
    mockClassGet.mockResolvedValue(classDoc("class-a"));
    const res = await __assignmentsTeacherListHandler(makeRequest());
    expect(res.items).toHaveLength(1);
    expect(Object.keys(res.items[0])).not.toContain("instructions");
  });

  test("Sprint 13G: omits instructions when the record carries an empty string", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [assignmentDoc("a-blank-instructions", { instructions: "" })],
    });
    mockClassGet.mockResolvedValue(classDoc("class-a"));
    const res = await __assignmentsTeacherListHandler(makeRequest());
    expect(res.items).toHaveLength(1);
    expect(Object.keys(res.items[0])).not.toContain("instructions");
  });
});

describe("assignmentsTeacherList - Current-aware dashboard dedup (Sprint 30 cleanup)", () => {
  beforeEach(() => {
    // `jest.clearAllMocks()` in the outer beforeEach clears call history
    // only, not a prior test's `.mockResolvedValue`/`.mockImplementation`
    // override - reset both Current-pointer seams back to their "nothing
    // configured" default before every test in this block so one test's
    // pointer/assignment fixture can never leak into the next.
    mockCurrentDocGet.mockResolvedValue({ exists: false, data: () => undefined });
    mockAssignmentDocRef.mockImplementation(() => ({
      get: () => Promise.resolve({ exists: false, data: () => undefined }),
    }));
  });

  function seedCurrentPointer(assignmentId: string): void {
    mockCurrentDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        classId: "class-a",
        lessonSlug: "lesson_g7_earths-layers",
        assignmentId,
        teacherId: TEACHER_UID,
        schoolId: SCHOOL_ID,
        setAt: { __sentinel: "timestamp" },
        setBy: TEACHER_UID,
        source: "teacherResolution",
      }),
    });
  }

  test("one published assignment -> one operational card (no resolver call)", async () => {
    mockAssignmentsGet.mockResolvedValue({ docs: [assignmentDoc("a1")] });
    mockClassGet.mockResolvedValue(classDoc("class-a"));
    const res = await __assignmentsTeacherListHandler(makeRequest());
    expect(res.items).toHaveLength(1);
    expect(mockAssignmentsCurrentDocRef).not.toHaveBeenCalled();
  });

  test("four historical published occurrences + valid Current (not the newest) -> exactly one card representing Current", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [
        assignmentDoc("a-0909", { publishedAt: { toMillis: () => 1 } }),
        assignmentDoc("a-0910", { publishedAt: { toMillis: () => 2 } }),
        assignmentDoc("a-0956", { publishedAt: { toMillis: () => 3 } }),
        assignmentDoc("a-1016", { publishedAt: { toMillis: () => 4 } }),
      ],
    });
    mockClassGet.mockResolvedValue(classDoc("class-a"));
    // The known production example: Current is the SECOND occurrence
    // (9:10 AM), not the newest (10:16 AM) - proves resolution is by the
    // canonical pointer, never recency.
    seedCurrentPointer("a-0910");
    mockAssignmentDocRef.mockImplementation((id: string) => ({
      get: () =>
        Promise.resolve(
          id === "a-0910"
            ? {
                exists: true,
                data: () => ({
                  classId: "class-a",
                  teacherId: TEACHER_UID,
                  schoolId: SCHOOL_ID,
                  lessonSlug: "lesson_g7_earths-layers",
                  mode: "classroom",
                  status: "published",
                  createdAt: {},
                }),
              }
            : { exists: false, data: () => undefined },
        ),
    }));

    const res = await __assignmentsTeacherListHandler(makeRequest());
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.assignmentId).toBe("a-0910");
  });

  test("multiple published + NO valid Current -> every occurrence stays visible (no heuristic ever chosen)", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [assignmentDoc("a-0909"), assignmentDoc("a-0910")],
    });
    mockClassGet.mockResolvedValue(classDoc("class-a"));
    // mockCurrentDocGet default: pointer missing.
    const res = await __assignmentsTeacherListHandler(makeRequest());
    const ids = res.items.map((i) => i.assignmentId).sort();
    expect(ids).toEqual(["a-0909", "a-0910"]);
  });

  test("multiple published + a stale/invalid Current pointer -> every occurrence stays visible", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [assignmentDoc("a-0909"), assignmentDoc("a-0910")],
    });
    mockClassGet.mockResolvedValue(classDoc("class-a"));
    // Pointer names an assignment id that is not in this class+lesson's
    // returned set at all (e.g. a closed/deleted/cross-scope record).
    seedCurrentPointer("a-gone");
    // mockAssignmentDocRef default (reset above): "a-gone" resolves to
    // not-found, matching `resolveValidCurrentAssignmentId`'s own
    // `assignmentMissing` branch for a pointer naming a deleted/closed/
    // out-of-scope assignment.
    const res = await __assignmentsTeacherListHandler(makeRequest());
    const ids = res.items.map((i) => i.assignmentId).sort();
    expect(ids).toEqual(["a-0909", "a-0910"]);
  });

  test("same lesson in two different classes does NOT collapse", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [
        assignmentDoc("a-classA", { classId: "class-a" }),
        assignmentDoc("a-classB", { classId: "class-b" }),
      ],
    });
    mockClassDocRef.mockImplementation((id: string) => ({
      get: () => Promise.resolve(classDoc(id)),
    }));
    const res = await __assignmentsTeacherListHandler(makeRequest());
    const ids = res.items.map((i) => i.assignmentId).sort();
    expect(ids).toEqual(["a-classA", "a-classB"]);
  });

  test("two different lessons in one class do NOT collapse", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [
        assignmentDoc("a-lesson1", { lessonSlug: "lesson_g7_earths-layers" }),
        assignmentDoc("a-lesson2", { lessonSlug: "lesson_g7_water-cycle" }),
      ],
    });
    mockClassGet.mockResolvedValue(classDoc("class-a"));
    const res = await __assignmentsTeacherListHandler(makeRequest());
    const ids = res.items.map((i) => i.assignmentId).sort();
    expect(ids).toEqual(["a-lesson1", "a-lesson2"]);
  });

  test("closed historical occurrences are never affected by dedup and remain returned alongside a collapsed published card", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [
        assignmentDoc("a-published-1"),
        assignmentDoc("a-published-2"),
        assignmentDoc("a-closed-1", { status: "closed" }),
      ],
    });
    mockClassGet.mockResolvedValue(classDoc("class-a"));
    seedCurrentPointer("a-published-1");
    mockAssignmentDocRef.mockImplementation((id: string) => ({
      get: () =>
        Promise.resolve(
          id === "a-published-1"
            ? {
                exists: true,
                data: () => ({
                  classId: "class-a",
                  teacherId: TEACHER_UID,
                  schoolId: SCHOOL_ID,
                  lessonSlug: "lesson_g7_earths-layers",
                  mode: "classroom",
                  status: "published",
                  createdAt: {},
                }),
              }
            : { exists: false, data: () => undefined },
        ),
    }));
    const res = await __assignmentsTeacherListHandler(makeRequest());
    const ids = res.items.map((i) => i.assignmentId).sort();
    // a-published-2 was collapsed away (not Current); the closed record
    // is untouched by this feature and still returned alongside it.
    expect(ids).toEqual(["a-closed-1", "a-published-1"]);
  });
});

describe("assignmentsTeacherList - Sprint 13F draft enumeration", () => {
  test("default request omits drafts from status filter", async () => {
    mockAssignmentsGet.mockResolvedValue({ docs: [] });
    await __assignmentsTeacherListHandler(makeRequest());
    expect(mockWhere3).toHaveBeenCalledWith(
      "status",
      "in",
      // `archived` is read (never returned) so the Current-aware collapse
      // sees every occurrence of a class + lesson.
      ["published", "closed", "archived"],
    );
  });

  test("includeDrafts=true widens status filter to include drafts", async () => {
    mockAssignmentsGet.mockResolvedValue({ docs: [] });
    await __assignmentsTeacherListHandler(
      makeRequest({ includeDrafts: true }),
    );
    expect(mockWhere3).toHaveBeenCalledWith(
      "status",
      "in",
      ["published", "closed", "draft", "archived"],
    );
  });

  test("includeDrafts=true returns owned draft assignment", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [assignmentDoc("d1", { status: "draft" })],
    });
    mockClassGet.mockResolvedValue(classDoc("class-a"));
    const res = await __assignmentsTeacherListHandler(
      makeRequest({ includeDrafts: true }),
    );
    expect(res.items).toEqual([
      {
        assignmentId: "d1",
        lessonSlug: "lesson_g7_earths-layers",
        title: "Earth's Layers",
        classId: "class-a",
        className: "Class class-a",
        status: "draft",
        publishedAt: null,
      },
    ]);
  });

  test("includeDrafts=true still excludes another teacher's draft", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [
        assignmentDoc("d2", {
          status: "draft",
          teacherId: "other-teacher",
        }),
      ],
    });
    mockClassGet.mockResolvedValue(classDoc("class-a"));
    const res = await __assignmentsTeacherListHandler(
      makeRequest({ includeDrafts: true }),
    );
    expect(res.items).toEqual([]);
  });

  test("includeDrafts=true still excludes cross-district draft", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [
        assignmentDoc("d3", {
          status: "draft",
          schoolId: "other-school",
        }),
      ],
    });
    mockClassGet.mockResolvedValue(classDoc("class-a"));
    const res = await __assignmentsTeacherListHandler(
      makeRequest({ includeDrafts: true }),
    );
    expect(res.items).toEqual([]);
  });

  test("includeDrafts=true preserves published and closed items unchanged", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [
        assignmentDoc("p1"),
        assignmentDoc("c1", { status: "closed" }),
        assignmentDoc("d1", { status: "draft" }),
      ],
    });
    mockClassGet.mockImplementation(() =>
      Promise.resolve(classDoc("class-a")),
    );
    const res = await __assignmentsTeacherListHandler(
      makeRequest({ includeDrafts: true }),
    );
    const statuses = res.items.map((i) => i.status).sort();
    expect(statuses).toEqual(["closed", "draft", "published"]);
  });

  test("includeDrafts=false is the default and returns no drafts", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [assignmentDoc("d1", { status: "draft" })],
    });
    mockClassGet.mockResolvedValue(classDoc("class-a"));
    const res = await __assignmentsTeacherListHandler(
      makeRequest({ includeDrafts: false }),
    );
    expect(res.items).toEqual([]);
  });
});

// Reassignment model: the teacher operational view uses the same canonical
// three-state Current resolution as students. Managed-inactive (the
// authoritative pointer names a closed/archived Current) must never make an
// older published occurrence operational again.
describe("assignmentsTeacherList - managed-inactive Current (reassignment model)", () => {
  const LESSON = "lesson_g7_earths-layers";

  function routeAssignments(byId: Record<string, Record<string, unknown>>): void {
    mockAssignmentDocRef.mockImplementation((id: string) => ({
      get: () =>
        Promise.resolve(
          byId[id]
            ? {
                exists: true,
                data: () => ({
                  classId: "class-a",
                  teacherId: TEACHER_UID,
                  schoolId: SCHOOL_ID,
                  lessonSlug: LESSON,
                  mode: "classroom",
                  status: "published",
                  createdAt: {},
                  ...byId[id],
                }),
              }
            : { exists: false, data: () => undefined },
        ),
    }));
  }

  function pointTo(assignmentId: string): void {
    mockCurrentDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        classId: "class-a",
        lessonSlug: LESSON,
        assignmentId,
        teacherId: TEACHER_UID,
        schoolId: SCHOOL_ID,
        setAt: { __sentinel: "timestamp" },
        setBy: TEACHER_UID,
        source: "teacherResolution",
      }),
    });
  }

  beforeEach(() => {
    mockCurrentDocGet.mockResolvedValue({ exists: false, data: () => undefined });
    mockAssignmentDocRef.mockImplementation(() => ({
      get: () => Promise.resolve({ exists: false, data: () => undefined }),
    }));
    mockClassGet.mockResolvedValue(classDoc("class-a"));
  });

  const ids = (items: ReadonlyArray<{ assignmentId: string }>) =>
    items.map((i) => i.assignmentId).sort();

  test("unresolved legacy (never had a Current): every published occurrence stays, no Current guessed", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [assignmentDoc("a-old1"), assignmentDoc("a-old2")],
    });
    const res = await __assignmentsTeacherListHandler(makeRequest());
    expect(ids(res.items)).toEqual(["a-old1", "a-old2"]);
  });

  test("valid Current: only the Current occurrence is operational", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [assignmentDoc("a-old"), assignmentDoc("a-cur")],
    });
    pointTo("a-cur");
    routeAssignments({ "a-cur": {} });
    const res = await __assignmentsTeacherListHandler(makeRequest());
    expect(ids(res.items)).toEqual(["a-cur"]);
  });

  test("CLOSED Current: no older published occurrence becomes operational; the closed Current stays as a closed item", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [
        assignmentDoc("a-old1"),
        assignmentDoc("a-old2"),
        assignmentDoc("a-cur", { status: "closed" }),
      ],
    });
    pointTo("a-cur");
    routeAssignments({ "a-cur": { status: "closed" } });
    const res = await __assignmentsTeacherListHandler(makeRequest());
    expect(res.items.map((i) => [i.assignmentId, i.status])).toEqual([["a-cur", "closed"]]);
  });

  test("ARCHIVED Current with a lone older published occurrence: the older one is not resurrected (archived is never returned)", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [assignmentDoc("a-old"), assignmentDoc("a-cur", { status: "archived" })],
    });
    pointTo("a-cur");
    routeAssignments({ "a-cur": { status: "archived" } });
    const res = await __assignmentsTeacherListHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("a lone published occurrence that IS the valid Current stays operational even with closed history", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [assignmentDoc("a-cur"), assignmentDoc("a-older", { status: "closed" })],
    });
    pointTo("a-cur");
    routeAssignments({ "a-cur": {} });
    const res = await __assignmentsTeacherListHandler(makeRequest());
    expect(res.items.map((i) => [i.assignmentId, i.status]).sort()).toEqual([
      ["a-cur", "published"],
      ["a-older", "closed"],
    ]);
  });

  test("a lone published occurrence with NO other occurrence keeps the cheap path (no Current read)", async () => {
    mockAssignmentsGet.mockResolvedValue({ docs: [assignmentDoc("a-only")] });
    const res = await __assignmentsTeacherListHandler(makeRequest());
    expect(ids(res.items)).toEqual(["a-only"]);
    expect(mockAssignmentsCurrentDocRef).not.toHaveBeenCalled();
  });

  test("closing Current in one class never affects another class's legacy occurrences", async () => {
    mockAssignmentsGet.mockResolvedValue({
      docs: [
        assignmentDoc("a-old"),
        assignmentDoc("a-cur", { status: "closed" }),
        assignmentDoc("b-1", { classId: "class-b" }),
        assignmentDoc("b-2", { classId: "class-b" }),
      ],
    });
    mockClassGet.mockImplementation(() => Promise.resolve(classDoc("x")));
    mockAssignmentsCurrentDocRef.mockImplementation((classId: string) => ({
      get: () =>
        classId === "class-a"
          ? Promise.resolve({
              exists: true,
              data: () => ({
                classId: "class-a",
                lessonSlug: LESSON,
                assignmentId: "a-cur",
                teacherId: TEACHER_UID,
                schoolId: SCHOOL_ID,
                setAt: { __sentinel: "timestamp" },
                setBy: TEACHER_UID,
                source: "teacherResolution",
              }),
            })
          : Promise.resolve({ exists: false, data: () => undefined }),
    }));
    routeAssignments({ "a-cur": { status: "closed" } });
    const res = await __assignmentsTeacherListHandler(makeRequest());
    expect(res.items.map((i) => [i.assignmentId, i.status]).sort()).toEqual([
      ["a-cur", "closed"],
      ["b-1", "published"],
      ["b-2", "published"],
    ]);
    mockAssignmentsCurrentDocRef.mockImplementation(() => ({ get: mockCurrentDocGet }));
  });
});
