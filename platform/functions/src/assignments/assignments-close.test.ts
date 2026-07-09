import type { CallableRequest } from "firebase-functions/v2/https";

const mockAssignmentGet = jest.fn();
const mockAssignmentUpdate = jest.fn();
const mockAssignmentDocRef = jest.fn(() => ({ get: mockAssignmentGet }));
const mockAssignmentCloseDocRef = jest.fn(() => ({
  update: mockAssignmentUpdate,
}));

const mockWriteAuditEvent = jest.fn();

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

jest.mock("firebase-admin/firestore", () => ({}));

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    PlatformError,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    assignmentDocRef: mockAssignmentDocRef,
    assignmentCloseDocRef: mockAssignmentCloseDocRef,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { __assignmentsCloseHandler } from "./assignments-close";

const ASSIGNMENT_ID = "assign-1";

function makeRequest(
  overrides: {
    uid?: string;
    data?: unknown;
    hasAuth?: boolean;
    token?: Record<string, unknown> | null;
  } = {},
): CallableRequest<unknown> {
  const hasAuth = overrides.hasAuth ?? true;
  const uid = overrides.uid ?? "teacher-uid";
  const data =
    overrides.data === undefined
      ? { assignmentId: ASSIGNMENT_ID }
      : overrides.data;
  const token =
    overrides.token === undefined
      ? { role: "teacher", schoolId: "school-a" }
      : overrides.token;
  return {
    data,
    auth: hasAuth
      ? ({ uid, token: token ?? undefined } as never)
      : undefined,
    rawRequest: {} as never,
  };
}

function existingSnapshot(
  overrides: Record<string, unknown> = {},
) {
  return {
    exists: true,
    data: () => ({
      classId: "class-abc",
      teacherId: "teacher-uid",
      schoolId: "school-a",
      lessonSlug: "lesson_g7_earths-layers",
      lessonVersion: "1",
      mode: "classroom",
      status: "published",
      createdAt: {} as never,
      ...overrides,
    }),
  };
}

describe("assignmentsClose", () => {
  beforeEach(() => {
    mockAssignmentGet.mockReset();
    mockAssignmentUpdate.mockReset();
    mockAssignmentDocRef.mockClear();
    mockAssignmentCloseDocRef.mockClear();
    mockWriteAuditEvent.mockReset();
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it("advances published to closed and emits a single audit event", async () => {
    mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
    mockAssignmentUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    const result = await __assignmentsCloseHandler(makeRequest());

    expect(mockAssignmentUpdate).toHaveBeenCalledWith({ status: "closed" });
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: "teacher-uid",
      actorRole: "teacher",
      action: "assignments.closed",
      targetType: "assignment",
      targetId: ASSIGNMENT_ID,
      schoolId: "school-a",
      payload: { classId: "class-abc" },
    });
    expect(result).toEqual({
      assignmentId: ASSIGNMENT_ID,
      status: "closed",
      alreadyClosed: false,
    });
  });

  it("is idempotent when already closed", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ status: "closed" }),
    );

    const result = await __assignmentsCloseHandler(makeRequest());

    expect(result).toEqual({
      assignmentId: ASSIGNMENT_ID,
      status: "closed",
      alreadyClosed: true,
    });
    expect(mockAssignmentUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a close from draft or archived with invalidTransition", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ status: "draft" }),
    );
    await expect(
      __assignmentsCloseHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.invalidTransition" });

    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ status: "archived" }),
    );
    await expect(
      __assignmentsCloseHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.invalidTransition" });
  });

  it("rejects unauthenticated, non-teacher, cross-teacher, and cross-school callers", async () => {
    await expect(
      __assignmentsCloseHandler(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({ code: "assignments.unauthenticated" });
    await expect(
      __assignmentsCloseHandler(
        makeRequest({ token: { role: "student", schoolId: "school-a" } }),
      ),
    ).rejects.toMatchObject({ code: "assignments.unauthorized" });

    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ teacherId: "someone-else" }),
    );
    await expect(
      __assignmentsCloseHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });

    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ schoolId: "school-b" }),
    );
    await expect(
      __assignmentsCloseHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });
  });

  it("rejects a not-found assignment and an invalid assignmentId", async () => {
    mockAssignmentGet.mockResolvedValueOnce({
      exists: false,
      data: () => undefined,
    });
    await expect(
      __assignmentsCloseHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.notFound" });

    await expect(
      __assignmentsCloseHandler(
        makeRequest({ data: { assignmentId: "bad/id" } }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidAssignmentId" });
  });
});
