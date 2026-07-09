import type { CallableRequest } from "firebase-functions/v2/https";

const mockAssignmentGet = jest.fn();
const mockAssignmentUpdate = jest.fn();
const mockAssignmentDocRef = jest.fn(() => ({ get: mockAssignmentGet }));
const mockAssignmentArchiveDocRef = jest.fn(() => ({
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
    assignmentArchiveDocRef: mockAssignmentArchiveDocRef,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { __assignmentsArchiveHandler } from "./assignments-archive";

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
      status: "draft",
      createdAt: {} as never,
      ...overrides,
    }),
  };
}

describe("assignmentsArchive", () => {
  beforeEach(() => {
    mockAssignmentGet.mockReset();
    mockAssignmentUpdate.mockReset();
    mockAssignmentDocRef.mockClear();
    mockAssignmentArchiveDocRef.mockClear();
    mockWriteAuditEvent.mockReset();
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it.each(["draft", "published", "closed"] as const)(
    "archives an assignment currently in %s and emits a single audit event",
    async (fromStatus) => {
      mockAssignmentGet.mockResolvedValueOnce(
        existingSnapshot({ status: fromStatus }),
      );
      mockAssignmentUpdate.mockResolvedValueOnce(undefined);
      mockWriteAuditEvent.mockResolvedValueOnce({
        eventId: "evt-1",
        record: {},
      });

      const result = await __assignmentsArchiveHandler(makeRequest());

      expect(mockAssignmentUpdate).toHaveBeenCalledWith({ status: "archived" });
      expect(mockWriteAuditEvent).toHaveBeenCalledWith({
        actorUserId: "teacher-uid",
        actorRole: "teacher",
        action: "assignments.archived",
        targetType: "assignment",
        targetId: ASSIGNMENT_ID,
        schoolId: "school-a",
        payload: { classId: "class-abc", previousStatus: fromStatus },
      });
      expect(result).toEqual({
        assignmentId: ASSIGNMENT_ID,
        status: "archived",
        alreadyArchived: false,
      });
    },
  );

  it("is idempotent when already archived", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ status: "archived" }),
    );

    const result = await __assignmentsArchiveHandler(makeRequest());

    expect(result).toEqual({
      assignmentId: ASSIGNMENT_ID,
      status: "archived",
      alreadyArchived: true,
    });
    expect(mockAssignmentUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated and non-teacher callers", async () => {
    await expect(
      __assignmentsArchiveHandler(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({ code: "assignments.unauthenticated" });
    await expect(
      __assignmentsArchiveHandler(
        makeRequest({ token: { role: "student", schoolId: "school-a" } }),
      ),
    ).rejects.toMatchObject({ code: "assignments.unauthorized" });
  });

  it("rejects cross-teacher and cross-school owners with forbidden", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ teacherId: "someone-else" }),
    );
    await expect(
      __assignmentsArchiveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });

    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ schoolId: "school-b" }),
    );
    await expect(
      __assignmentsArchiveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });
    expect(mockAssignmentUpdate).not.toHaveBeenCalled();
  });

  it("rejects a not-found assignment and an invalid assignmentId", async () => {
    mockAssignmentGet.mockResolvedValueOnce({
      exists: false,
      data: () => undefined,
    });
    await expect(
      __assignmentsArchiveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.notFound" });

    await expect(
      __assignmentsArchiveHandler(
        makeRequest({ data: { assignmentId: "bad/id" } }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidAssignmentId" });
  });

  it("orders side effects: archive write, then audit event", async () => {
    const calls: string[] = [];
    mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
    mockAssignmentUpdate.mockImplementationOnce(() => {
      calls.push("update");
      return Promise.resolve();
    });
    mockWriteAuditEvent.mockImplementationOnce(() => {
      calls.push("audit");
      return Promise.resolve({ eventId: "evt-1", record: {} });
    });

    await __assignmentsArchiveHandler(makeRequest());

    expect(calls).toEqual(["update", "audit"]);
  });
});
