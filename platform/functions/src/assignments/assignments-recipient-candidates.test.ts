import type { CallableRequest } from "firebase-functions/v2/https";

const mockAssignmentGet = jest.fn();
const mockAssignmentDocRef = jest.fn(() => ({ get: mockAssignmentGet }));
const mockRecipientsGet = jest.fn();
const mockRecipientsCollectionRef = jest.fn(() => ({
  get: mockRecipientsGet,
}));
const mockRequireDistrictContext = jest.fn();
const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();
const mockResolveDisplayName = jest.fn();
const mockLoadInitialRecipientPopulation = jest.fn();

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
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    assignmentDocRef: mockAssignmentDocRef,
    assignmentRecipientsCollectionRef: mockRecipientsCollectionRef,
    requireDistrictContext: mockRequireDistrictContext,
  };
});

jest.mock("../enrollments/resolve-roster-display-name", () => ({
  createRosterDisplayNameResolver: () => mockResolveDisplayName,
}));

jest.mock("./assignment-recipients", () => ({
  loadInitialRecipientPopulation: (...args: unknown[]) =>
    mockLoadInitialRecipientPopulation(...args),
}));

import { PlatformError } from "../shared/errors/platform-error";
import { __assignmentsRecipientCandidatesListHandler } from "./assignments-recipient-candidates";

const TEACHER_UID = "teacher-uid";
const SCHOOL_ID = "school-a";
const DISTRICT_ID = "district-1";
const ASSIGNMENT_ID = "assign-1";
const CLASS_ID = "class-abc";

const VALID_CONTEXT = Object.freeze({
  uid: TEACHER_UID,
  role: "teacher" as const,
  schoolId: SCHOOL_ID,
  districtId: DISTRICT_ID,
});

function makeRequest(
  overrides: Record<string, unknown> = { assignmentId: ASSIGNMENT_ID },
): CallableRequest<unknown> {
  return {
    data: overrides,
    rawRequest: {},
  } as unknown as CallableRequest<unknown>;
}

function assignmentDoc(
  overrides: Record<string, unknown> = {},
): { exists: boolean; data(): unknown } {
  return {
    exists: true,
    data: () => ({
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
      schoolId: SCHOOL_ID,
      lessonSlug: "lesson_x",
      mode: "classroom",
      status: "published",
      createdAt: {},
      ...overrides,
    }),
  };
}

function recipientDoc(studentId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: studentId,
    data: () => ({
      assignmentId: ASSIGNMENT_ID,
      studentId,
      classId: CLASS_ID,
      teacherId: TEACHER_UID,
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

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireDistrictContext.mockResolvedValue(VALID_CONTEXT);
  mockResolveDisplayName.mockImplementation((studentId: string) =>
    Promise.resolve({
      studentId,
      displayName: `Student ${studentId}`,
      source: "userProfile" as const,
    }),
  );
  mockLoadInitialRecipientPopulation.mockResolvedValue([]);
  mockRecipientsGet.mockResolvedValue({ docs: [] });
});

describe("assignmentsRecipientCandidatesList - authorization", () => {
  test("rejects non-teacher role", async () => {
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_CONTEXT,
      role: "student",
    });
    await expect(
      __assignmentsRecipientCandidatesListHandler(makeRequest()),
    ).rejects.toBeInstanceOf(PlatformError);
  });

  test("rejects when caller does not own the assignment", async () => {
    mockAssignmentGet.mockResolvedValue(
      assignmentDoc({ teacherId: "other-teacher" }),
    );
    await expect(
      __assignmentsRecipientCandidatesListHandler(makeRequest()),
    ).rejects.toBeInstanceOf(PlatformError);
  });

  test("rejects when assignment is in another school", async () => {
    mockAssignmentGet.mockResolvedValue(assignmentDoc({ schoolId: "other-s" }));
    await expect(
      __assignmentsRecipientCandidatesListHandler(makeRequest()),
    ).rejects.toBeInstanceOf(PlatformError);
  });

  test("rejects a missing assignmentId", async () => {
    await expect(
      __assignmentsRecipientCandidatesListHandler(makeRequest({})),
    ).rejects.toBeInstanceOf(PlatformError);
  });

  test("rejects a non-URL-safe assignmentId", async () => {
    await expect(
      __assignmentsRecipientCandidatesListHandler(
        makeRequest({ assignmentId: "bad id!" }),
      ),
    ).rejects.toBeInstanceOf(PlatformError);
  });

  test.each(["studentId", "classId", "schoolId", "teacherId", "districtId", "uid", "userId"])(
    "rejects a forbidden request key: %s",
    async (key) => {
      await expect(
        __assignmentsRecipientCandidatesListHandler(
          makeRequest({ assignmentId: ASSIGNMENT_ID, [key]: "leak" }),
        ),
      ).rejects.toBeInstanceOf(PlatformError);
    },
  );

  test("rejects a missing assignment", async () => {
    mockAssignmentGet.mockResolvedValue({ exists: false, data: () => null });
    await expect(
      __assignmentsRecipientCandidatesListHandler(makeRequest()),
    ).rejects.toBeInstanceOf(PlatformError);
  });
});

describe("assignmentsRecipientCandidatesList - candidate calculation", () => {
  test("returns enrolled students who are not recipients, sorted by name", async () => {
    mockAssignmentGet.mockResolvedValue(assignmentDoc());
    mockLoadInitialRecipientPopulation.mockResolvedValue([
      "s-a",
      "s-b",
      "s-c",
    ]);
    mockRecipientsGet.mockResolvedValue({ docs: [recipientDoc("s-b")] });
    const res = await __assignmentsRecipientCandidatesListHandler(makeRequest());
    expect(res.assignmentId).toBe(ASSIGNMENT_ID);
    // s-b is already a recipient, so only s-a and s-c are addable.
    expect(res.candidates.map((c) => c.studentId)).toEqual(["s-a", "s-c"]);
    for (const c of res.candidates) {
      expect(c.studentDisplayName).toBe(`Student ${c.studentId}`);
    }
  });

  test("passes the assignment's class and owning school to the population read", async () => {
    mockAssignmentGet.mockResolvedValue(assignmentDoc());
    mockLoadInitialRecipientPopulation.mockResolvedValue([]);
    await __assignmentsRecipientCandidatesListHandler(makeRequest());
    expect(mockLoadInitialRecipientPopulation).toHaveBeenCalledWith(
      CLASS_ID,
      SCHOOL_ID,
    );
  });

  test("an already-assigned enrolled student is not offered", async () => {
    mockAssignmentGet.mockResolvedValue(assignmentDoc());
    mockLoadInitialRecipientPopulation.mockResolvedValue(["s-1"]);
    mockRecipientsGet.mockResolvedValue({ docs: [recipientDoc("s-1")] });
    const res = await __assignmentsRecipientCandidatesListHandler(makeRequest());
    expect(res.candidates).toEqual([]);
  });

  test("returns an empty candidate list when the class has no enrollments", async () => {
    mockAssignmentGet.mockResolvedValue(assignmentDoc());
    mockLoadInitialRecipientPopulation.mockResolvedValue([]);
    const res = await __assignmentsRecipientCandidatesListHandler(makeRequest());
    expect(res.candidates).toEqual([]);
  });

  test("a cross-district recipient record is ignored, so an enrolled student it names is still offered", async () => {
    mockAssignmentGet.mockResolvedValue(assignmentDoc());
    mockLoadInitialRecipientPopulation.mockResolvedValue(["s-x"]);
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("s-x", { districtId: "other-district" })],
    });
    const res = await __assignmentsRecipientCandidatesListHandler(makeRequest());
    expect(res.candidates.map((c) => c.studentId)).toEqual(["s-x"]);
  });

  test("a revoked (non-assigned) recipient record does not suppress an enrolled candidate", async () => {
    mockAssignmentGet.mockResolvedValue(assignmentDoc());
    mockLoadInitialRecipientPopulation.mockResolvedValue(["s-y"]);
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("s-y", { status: "revoked" })],
    });
    const res = await __assignmentsRecipientCandidatesListHandler(makeRequest());
    expect(res.candidates.map((c) => c.studentId)).toEqual(["s-y"]);
  });

  test("never surfaces attempt, session, score, or answer fields", async () => {
    mockAssignmentGet.mockResolvedValue(assignmentDoc());
    mockLoadInitialRecipientPopulation.mockResolvedValue(["s-1"]);
    const res = await __assignmentsRecipientCandidatesListHandler(makeRequest());
    for (const c of res.candidates) {
      const keys = Object.keys(c);
      for (const forbidden of [
        "attemptId",
        "sessionId",
        "score",
        "percentage",
        "answer",
        "itemResults",
        "responses",
        "providerId",
        "providerAccountId",
        "email",
      ]) {
        expect(keys).not.toContain(forbidden);
      }
    }
  });
});

describe("assignmentsRecipientCandidatesList - lifecycle gating", () => {
  test("a draft assignment yields no candidates and never reads enrollments", async () => {
    mockAssignmentGet.mockResolvedValue(assignmentDoc({ status: "draft" }));
    const res = await __assignmentsRecipientCandidatesListHandler(makeRequest());
    expect(res.candidates).toEqual([]);
    expect(mockLoadInitialRecipientPopulation).not.toHaveBeenCalled();
  });

  test("a closed assignment yields no candidates and never reads enrollments", async () => {
    mockAssignmentGet.mockResolvedValue(assignmentDoc({ status: "closed" }));
    const res = await __assignmentsRecipientCandidatesListHandler(makeRequest());
    expect(res.candidates).toEqual([]);
    expect(mockLoadInitialRecipientPopulation).not.toHaveBeenCalled();
  });

  test("a published assignment missing its class reference is refused", async () => {
    mockAssignmentGet.mockResolvedValue(assignmentDoc({ classId: "" }));
    await expect(
      __assignmentsRecipientCandidatesListHandler(makeRequest()),
    ).rejects.toBeInstanceOf(PlatformError);
  });
});
