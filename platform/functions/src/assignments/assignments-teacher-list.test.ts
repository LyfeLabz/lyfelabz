import type { CallableRequest } from "firebase-functions/v2/https";

const mockAssignmentsGet = jest.fn();
const mockWhere1 = jest.fn();
const mockWhere2 = jest.fn();
const mockWhere3 = jest.fn();

const mockAssignmentsCollectionRef = jest.fn(() => ({ where: mockWhere1 }));

const mockClassGet = jest.fn();
const mockClassDocRef = jest.fn(() => ({ get: mockClassGet }));

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
      lessonVersion: "1",
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
      ["published", "closed"],
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

describe("assignmentsTeacherList - Sprint 13F draft enumeration", () => {
  test("default request omits drafts from status filter", async () => {
    mockAssignmentsGet.mockResolvedValue({ docs: [] });
    await __assignmentsTeacherListHandler(makeRequest());
    expect(mockWhere3).toHaveBeenCalledWith(
      "status",
      "in",
      ["published", "closed"],
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
      ["published", "closed", "draft"],
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
