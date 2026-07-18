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

import { PlatformError } from "../shared/errors/platform-error";
import { __assignmentsRecipientListHandler } from "./assignments-recipient-list";

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
      lessonVersion: "1",
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
});

describe("assignmentsRecipientList - authorization", () => {
  test("rejects non-teacher role", async () => {
    mockRequireDistrictContext.mockResolvedValue({
      ...VALID_CONTEXT,
      role: "student",
    });
    await expect(
      __assignmentsRecipientListHandler(makeRequest()),
    ).rejects.toBeInstanceOf(PlatformError);
  });

  test("rejects when caller does not own the assignment", async () => {
    mockAssignmentGet.mockResolvedValue(
      assignmentDoc({ teacherId: "other-teacher" }),
    );
    await expect(
      __assignmentsRecipientListHandler(makeRequest()),
    ).rejects.toBeInstanceOf(PlatformError);
  });

  test("rejects when assignment is in another school", async () => {
    mockAssignmentGet.mockResolvedValue(assignmentDoc({ schoolId: "other-s" }));
    await expect(
      __assignmentsRecipientListHandler(makeRequest()),
    ).rejects.toBeInstanceOf(PlatformError);
  });

  test("rejects a missing assignmentId", async () => {
    await expect(
      __assignmentsRecipientListHandler(makeRequest({})),
    ).rejects.toBeInstanceOf(PlatformError);
  });

  test("rejects a forbidden request key", async () => {
    await expect(
      __assignmentsRecipientListHandler(
        makeRequest({ assignmentId: ASSIGNMENT_ID, studentId: "leak" }),
      ),
    ).rejects.toBeInstanceOf(PlatformError);
  });
});

describe("assignmentsRecipientList - projection", () => {
  test("returns the frozen recipients with resolved display names sorted by name", async () => {
    mockAssignmentGet.mockResolvedValue(assignmentDoc());
    mockRecipientsGet.mockResolvedValue({
      docs: [recipientDoc("s-b"), recipientDoc("s-a"), recipientDoc("s-c")],
    });
    const res = await __assignmentsRecipientListHandler(makeRequest());
    expect(res.assignmentId).toBe(ASSIGNMENT_ID);
    expect(res.recipients.map((r) => r.studentId)).toEqual([
      "s-a",
      "s-b",
      "s-c",
    ]);
    for (const r of res.recipients) {
      expect(r.studentDisplayName).toBe(`Student ${r.studentId}`);
    }
  });

  test("filters cross-district records defensively", async () => {
    mockAssignmentGet.mockResolvedValue(assignmentDoc());
    mockRecipientsGet.mockResolvedValue({
      docs: [
        recipientDoc("s-good"),
        recipientDoc("s-bad", { districtId: "other-district" }),
      ],
    });
    const res = await __assignmentsRecipientListHandler(makeRequest());
    expect(res.recipients.map((r) => r.studentId)).toEqual(["s-good"]);
  });

  test("returns an empty list when no recipients exist", async () => {
    mockAssignmentGet.mockResolvedValue(assignmentDoc());
    mockRecipientsGet.mockResolvedValue({ docs: [] });
    const res = await __assignmentsRecipientListHandler(makeRequest());
    expect(res.recipients).toEqual([]);
  });

  test("never surfaces attempt, session, score, or answer fields", async () => {
    mockAssignmentGet.mockResolvedValue(assignmentDoc());
    mockRecipientsGet.mockResolvedValue({ docs: [recipientDoc("s-1")] });
    const res = await __assignmentsRecipientListHandler(makeRequest());
    for (const r of res.recipients) {
      const keys = Object.keys(r);
      for (const forbidden of [
        "attemptId",
        "sessionId",
        "score",
        "percentage",
        "answer",
        "itemResults",
        "responses",
      ]) {
        expect(keys).not.toContain(forbidden);
      }
    }
  });
});
