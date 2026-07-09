import type { CallableRequest } from "firebase-functions/v2/https";

const mockAssignmentGet = jest.fn();
const mockAssignmentUpdate = jest.fn();
const mockAssignmentDocRef = jest.fn(() => ({ get: mockAssignmentGet }));
const mockAssignmentPublishDocRef = jest.fn(() => ({
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
    assignmentPublishDocRef: mockAssignmentPublishDocRef,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { __assignmentsPublishHandler } from "./assignments-publish";

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

describe("assignmentsPublish", () => {
  beforeEach(() => {
    mockAssignmentGet.mockReset();
    mockAssignmentUpdate.mockReset();
    mockAssignmentDocRef.mockClear();
    mockAssignmentPublishDocRef.mockClear();
    mockWriteAuditEvent.mockReset();
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it("advances draft to published and emits a single audit event", async () => {
    mockAssignmentGet.mockResolvedValueOnce(existingSnapshot());
    mockAssignmentUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    const result = await __assignmentsPublishHandler(makeRequest());

    expect(mockAssignmentUpdate).toHaveBeenCalledWith({ status: "published" });
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: "teacher-uid",
      actorRole: "teacher",
      action: "assignments.published",
      targetType: "assignment",
      targetId: ASSIGNMENT_ID,
      schoolId: "school-a",
      payload: {
        classId: "class-abc",
        lessonSlug: "lesson_g7_earths-layers",
        lessonVersion: "1",
      },
    });
    expect(result).toEqual({
      assignmentId: ASSIGNMENT_ID,
      status: "published",
      alreadyPublished: false,
    });
  });

  it("is idempotent for an already-published assignment", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ status: "published" }),
    );

    const result = await __assignmentsPublishHandler(makeRequest());

    expect(result).toEqual({
      assignmentId: ASSIGNMENT_ID,
      status: "published",
      alreadyPublished: true,
    });
    expect(mockAssignmentUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a publish from closed or archived with invalidTransition", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ status: "closed" }),
    );
    await expect(
      __assignmentsPublishHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.invalidTransition" });

    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ status: "archived" }),
    );
    await expect(
      __assignmentsPublishHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.invalidTransition" });
    expect(mockAssignmentUpdate).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated and non-teacher callers", async () => {
    await expect(
      __assignmentsPublishHandler(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({ code: "assignments.unauthenticated" });
    await expect(
      __assignmentsPublishHandler(
        makeRequest({ token: { role: "student", schoolId: "school-a" } }),
      ),
    ).rejects.toMatchObject({ code: "assignments.unauthorized" });
  });

  it("rejects cross-teacher and cross-school owners", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ teacherId: "someone-else" }),
    );
    await expect(
      __assignmentsPublishHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });

    mockAssignmentGet.mockResolvedValueOnce(
      existingSnapshot({ schoolId: "school-b" }),
    );
    await expect(
      __assignmentsPublishHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });
  });

  it("rejects an invalid assignmentId payload", async () => {
    await expect(
      __assignmentsPublishHandler(
        makeRequest({ data: { assignmentId: "bad/id" } }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidAssignmentId" });
    await expect(
      __assignmentsPublishHandler(makeRequest({ data: {} })),
    ).rejects.toMatchObject({ code: "assignments.invalidAssignmentId" });
  });

  it("rejects a not-found assignment", async () => {
    mockAssignmentGet.mockResolvedValueOnce({
      exists: false,
      data: () => undefined,
    });
    await expect(
      __assignmentsPublishHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.notFound" });
  });

  it("orders side effects: publish write, then audit", async () => {
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

    await __assignmentsPublishHandler(makeRequest());

    expect(calls).toEqual(["update", "audit"]);
  });
});
