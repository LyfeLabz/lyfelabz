import type { CallableRequest } from "firebase-functions/v2/https";

const mockRecipientsGet = jest.fn();
const mockRecipientsWhere = jest.fn();
const mockRecipientsCollectionGroupRef = jest.fn(() => ({
  where: mockRecipientsWhere,
}));

const mockAssignmentGet = jest.fn();
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
    assignmentDocRef: mockAssignmentDocRef,
    assignmentRecipientsCollectionGroupRef: mockRecipientsCollectionGroupRef,
    requireDistrictContext: mockRequireDistrictContext,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __assignmentsListForStudentHandler } from "./assignments-list-for-student";

const STUDENT_UID = "student-uid";
const OTHER_UID = "other-student";
const TEACHER_UID = "teacher-uid";
const SCHOOL_ID = "school-a";
const DISTRICT_ID = "district-1";
const CLASS_ID = "class-a";

const VALID_CONTEXT = Object.freeze({
  uid: STUDENT_UID,
  role: "student" as const,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
});

function makeRequest(
  data: Record<string, unknown> | undefined | null = {},
  auth: { uid?: string } | null = { uid: STUDENT_UID },
): CallableRequest<unknown> {
  return {
    data,
    auth: auth ? ({ uid: auth.uid, token: {} } as never) : (null as never),
    rawRequest: {} as never,
  };
}

type RecipientOverrides = Partial<{
  assignmentId: string;
  studentId: string;
  teacherId: string;
  classId: string;
  schoolId: string;
  districtId: string;
  status: string;
  source: string;
}>;

function recipientDoc(
  assignmentId: string,
  overrides: RecipientOverrides = {},
): { data(): unknown } {
  return {
    data: () => ({
      assignmentId,
      studentId: STUDENT_UID,
      teacherId: TEACHER_UID,
      classId: CLASS_ID,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      assignedAt: {},
      assignedBy: TEACHER_UID,
      source: "classPublication",
      status: "assigned",
      ...overrides,
    }),
  };
}

type AssignmentOverrides = Partial<{
  classId: string;
  teacherId: string;
  schoolId: string;
  lessonSlug: string;
  lessonVersion: string;
  mode: string;
  status: string;
  title: string;
  publishedAt: unknown;
}>;

function assignmentSnap(
  exists: boolean,
  overrides: AssignmentOverrides = {},
): { readonly exists: boolean; readonly id: string; data(): unknown } {
  return {
    exists,
    id: overrides.classId ? "id-with-class" : "assignment-id",
    data: () => ({
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      lessonSlug: "lesson_g7_earths-layers",
      lessonVersion: "1",
      mode: "classroom",
      status: "published",
      createdAt: {},
      title: "Earth's Layers",
      publishedAt: { toMillis: () => 1_700_000_000_000 },
      ...overrides,
    }),
  };
}

// Set up an in-memory registry so mockAssignmentDocRef can return the doc
// keyed by assignmentId. Each test seeds the registry it needs.
const assignmentRegistry = new Map<string, ReturnType<typeof assignmentSnap>>();

function seedAssignment(
  id: string,
  overrides: AssignmentOverrides = {},
  exists = true,
) {
  const snap = assignmentSnap(exists, overrides);
  Object.defineProperty(snap, "id", { value: id, writable: false });
  assignmentRegistry.set(id, snap);
}

beforeEach(() => {
  jest.clearAllMocks();
  assignmentRegistry.clear();
  mockRecipientsWhere.mockReturnValue({ get: mockRecipientsGet });
  mockRequireDistrictContext.mockResolvedValue(VALID_CONTEXT);
  mockAssignmentDocRef.mockImplementation((id: string) => ({
    get: () =>
      Promise.resolve(
        assignmentRegistry.get(id) ?? { exists: false, id, data: () => undefined },
      ),
  }));
});

describe("assignmentsListForStudent - authorization", () => {
  test("propagates unauthenticated rejection from district context", async () => {
    const err = new PlatformError("unauthenticated", "no auth");
    mockRequireDistrictContext.mockRejectedValue(err);
    await expect(
      __assignmentsListForStudentHandler(makeRequest({}, null)),
    ).rejects.toBe(err);
  });

  test("rejects non-student role", async () => {
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_CONTEXT,
      role: "teacher",
    });
    await expect(
      __assignmentsListForStudentHandler(makeRequest()),
    ).rejects.toBeInstanceOf(PlatformError);
  });

  test("propagates stale-claim rejection from district context", async () => {
    const err = new PlatformError("claim-stale", "stale claim");
    mockRequireDistrictContext.mockRejectedValue(err);
    await expect(
      __assignmentsListForStudentHandler(makeRequest()),
    ).rejects.toBe(err);
  });

  test("propagates claim-state-mismatch from district context", async () => {
    const err = new PlatformError(
      "claim-state-mismatch",
      "mismatch",
    );
    mockRequireDistrictContext.mockRejectedValue(err);
    await expect(
      __assignmentsListForStudentHandler(makeRequest()),
    ).rejects.toBe(err);
  });
});

describe("assignmentsListForStudent - request shape", () => {
  test("rejects payload containing forbidden studentId key", async () => {
    await expect(
      __assignmentsListForStudentHandler(
        makeRequest({ studentId: OTHER_UID }),
      ),
    ).rejects.toBeInstanceOf(PlatformError);
  });

  test("rejects array payload", async () => {
    mockRecipientsGet.mockResolvedValue({ docs: [] });
    await expect(
      __assignmentsListForStudentHandler(
        makeRequest([] as unknown as Record<string, unknown>),
      ),
    ).rejects.toBeInstanceOf(PlatformError);
  });

  test("accepts undefined payload", async () => {
    mockRecipientsGet.mockResolvedValue({ docs: [] });
    const res = await __assignmentsListForStudentHandler(
      makeRequest(undefined),
    );
    expect(res.items).toEqual([]);
  });
});

describe("assignmentsListForStudent - query shape", () => {
  test("queries the recipients collection group filtered by caller uid", async () => {
    mockRecipientsGet.mockResolvedValue({ docs: [] });
    await __assignmentsListForStudentHandler(makeRequest());
    expect(mockRecipientsCollectionGroupRef).toHaveBeenCalledTimes(1);
    expect(mockRecipientsWhere).toHaveBeenCalledWith(
      "studentId",
      "==",
      STUDENT_UID,
    );
  });

  test("empty result returns empty items array", async () => {
    mockRecipientsGet.mockResolvedValue({ docs: [] });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });
});

describe("assignmentsListForStudent - response filtering", () => {
  test("returns published assignment for authorized recipient", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a1")],
    });
    seedAssignment("a1");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([
      {
        assignmentId: "a1",
        lessonSlug: "lesson_g7_earths-layers",
        title: "Earth's Layers",
        status: "published",
        publishedAt: 1_700_000_000_000,
      },
    ]);
  });

  test("excludes recipient whose frozen studentId does not match caller", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a2", { studentId: OTHER_UID })],
    });
    seedAssignment("a2");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("excludes cross-district recipient defensively", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a3", { districtId: "other-district" })],
    });
    seedAssignment("a3");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("excludes cross-school recipient defensively", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a4", { schoolId: "other-school" })],
    });
    seedAssignment("a4");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("excludes recipient whose status is not 'assigned'", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a5", { status: "revoked" })],
    });
    seedAssignment("a5");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("excludes draft assignment", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a6")],
    });
    seedAssignment("a6", { status: "draft" });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("excludes closed assignment", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a7")],
    });
    seedAssignment("a7", { status: "closed" });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("excludes archived assignment", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a8")],
    });
    seedAssignment("a8", { status: "archived" });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("excludes practice-mode assignment", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a9")],
    });
    seedAssignment("a9", { mode: "practice" });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("excludes assignment whose ownership drifted from the recipient snapshot", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a10")],
    });
    seedAssignment("a10", { teacherId: "other-teacher" });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("excludes assignment whose schoolId drifted from caller school", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a11")],
    });
    seedAssignment("a11", { schoolId: "other-school" });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("excludes assignment whose classId drifted from recipient classId", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a12")],
    });
    seedAssignment("a12", { classId: "other-class" });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("gracefully drops recipient whose parent assignment is missing", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a13")],
    });
    // no seed
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("gracefully drops recipient whose lessonSlug is missing on the assignment", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a14")],
    });
    seedAssignment("a14", { lessonSlug: "" });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("gracefully drops malformed recipient record (empty assignmentId)", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("", { assignmentId: "" })],
    });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
    expect(mockAssignmentDocRef).not.toHaveBeenCalled();
  });

  test("gracefully drops recipient record whose data() returns undefined", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [{ data: () => undefined }],
    });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toEqual([]);
  });

  test("dedupes duplicate recipient records for the same assignment", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a15"), recipientDoc("a15")],
    });
    seedAssignment("a15");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items).toHaveLength(1);
    expect(res.items[0].assignmentId).toBe("a15");
  });

  test("falls back to lessonSlug when title is missing", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a16")],
    });
    seedAssignment("a16", { title: "" });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items[0].title).toBe("lesson_g7_earths-layers");
  });

  test("projects publishedAt as null when the assignment record lacks a timestamp", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a17")],
    });
    seedAssignment("a17", { publishedAt: undefined });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items[0].publishedAt).toBeNull();
  });
});

describe("assignmentsListForStudent - projection safety", () => {
  test("returns no teacher, recipient, session, or answer-key fields", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a18")],
    });
    seedAssignment("a18");
    const res = await __assignmentsListForStudentHandler(makeRequest());
    const keys = Object.keys(res.items[0]);
    for (const forbidden of [
      "teacherId",
      "classId",
      "className",
      "districtId",
      "schoolId",
      "studentId",
      "recipientId",
      "recipients",
      "attemptId",
      "sessionId",
      "answerKey",
      "explanation",
      "instructions",
      "windowClosesAt",
      "availableAt",
      "mode",
      "lessonVersion",
      "lmsPublicationRef",
      "createdAt",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe("assignmentsListForStudent - ordering", () => {
  test("orders by publishedAt desc, then assignmentId asc as tiebreaker", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [
        recipientDoc("z"),
        recipientDoc("a"),
        recipientDoc("m"),
      ],
    });
    seedAssignment("z", {
      publishedAt: { toMillis: () => 1_000 },
    });
    seedAssignment("a", {
      publishedAt: { toMillis: () => 3_000 },
    });
    seedAssignment("m", {
      publishedAt: { toMillis: () => 3_000 },
    });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items.map((i) => i.assignmentId)).toEqual(["a", "m", "z"]);
  });

  test("orders null publishedAt after present publishedAt", async () => {
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("a"), recipientDoc("b")],
    });
    seedAssignment("a", { publishedAt: undefined });
    seedAssignment("b", {
      publishedAt: { toMillis: () => 5_000 },
    });
    const res = await __assignmentsListForStudentHandler(makeRequest());
    expect(res.items.map((i) => i.assignmentId)).toEqual(["b", "a"]);
  });
});
