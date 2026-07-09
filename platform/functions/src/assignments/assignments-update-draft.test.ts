import type { CallableRequest } from "firebase-functions/v2/https";

const mockAssignmentGet = jest.fn();
const mockAssignmentUpdate = jest.fn();
const mockAssignmentDocRef = jest.fn(() => ({ get: mockAssignmentGet }));
const mockAssignmentDraftUpdateDocRef = jest.fn(() => ({
  update: mockAssignmentUpdate,
}));

const mockWriteAuditEvent = jest.fn();

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

class FakeTimestamp {
  constructor(readonly millis: number) {}
  toMillis(): number {
    return this.millis;
  }
}

jest.mock("firebase-admin/firestore", () => ({
  Timestamp: {
    fromMillis: (millis: number) => new FakeTimestamp(millis),
  },
}));

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
    assignmentDraftUpdateDocRef: mockAssignmentDraftUpdateDocRef,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { __assignmentsUpdateDraftHandler } from "./assignments-update-draft";

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
      ? { assignmentId: ASSIGNMENT_ID, title: "New Title" }
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

function existingAssignmentSnapshot(
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
      title: "Original Title",
      ...overrides,
    }),
  };
}

describe("assignmentsUpdateDraft", () => {
  beforeEach(() => {
    mockAssignmentGet.mockReset();
    mockAssignmentUpdate.mockReset();
    mockAssignmentDocRef.mockClear();
    mockAssignmentDraftUpdateDocRef.mockClear();
    mockWriteAuditEvent.mockReset();
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it("updates only the changed fields and emits a single audit event", async () => {
    mockAssignmentGet.mockResolvedValueOnce(existingAssignmentSnapshot());
    mockAssignmentUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    const result = await __assignmentsUpdateDraftHandler(
      makeRequest({
        data: {
          assignmentId: ASSIGNMENT_ID,
          title: "New Title",
          instructions: "Read carefully.",
        },
      }),
    );

    expect(mockAssignmentUpdate).toHaveBeenCalledWith({
      title: "New Title",
      instructions: "Read carefully.",
    });
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: "teacher-uid",
      actorRole: "teacher",
      action: "assignments.updated",
      targetType: "assignment",
      targetId: ASSIGNMENT_ID,
      schoolId: "school-a",
      payload: { changedFields: ["title", "instructions"] },
    });
    expect(result).toEqual({
      assignmentId: ASSIGNMENT_ID,
      alreadyUpdated: false,
    });
  });

  it("is idempotent when nothing changes", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingAssignmentSnapshot({ title: "New Title" }),
    );

    const result = await __assignmentsUpdateDraftHandler(makeRequest());

    expect(result).toEqual({
      assignmentId: ASSIGNMENT_ID,
      alreadyUpdated: true,
    });
    expect(mockAssignmentUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller", async () => {
    await expect(
      __assignmentsUpdateDraftHandler(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({ code: "assignments.unauthenticated" });
  });

  it("rejects non-teacher callers", async () => {
    await expect(
      __assignmentsUpdateDraftHandler(
        makeRequest({ token: { role: "student", schoolId: "school-a" } }),
      ),
    ).rejects.toMatchObject({ code: "assignments.unauthorized" });
  });

  it("rejects a payload with no metadata fields", async () => {
    await expect(
      __assignmentsUpdateDraftHandler(
        makeRequest({ data: { assignmentId: ASSIGNMENT_ID } }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidRequest" });
    expect(mockAssignmentGet).not.toHaveBeenCalled();
  });

  it("rejects a cross-teacher update with assignments.forbidden", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingAssignmentSnapshot({ teacherId: "someone-else" }),
    );
    await expect(
      __assignmentsUpdateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });
    expect(mockAssignmentUpdate).not.toHaveBeenCalled();
  });

  it("rejects a cross-school update with assignments.forbidden", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingAssignmentSnapshot({ schoolId: "school-b" }),
    );
    await expect(
      __assignmentsUpdateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.forbidden" });
  });

  it("rejects an update against a non-draft assignment", async () => {
    mockAssignmentGet.mockResolvedValueOnce(
      existingAssignmentSnapshot({ status: "published" }),
    );
    await expect(
      __assignmentsUpdateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.invalidStatus" });
    expect(mockAssignmentUpdate).not.toHaveBeenCalled();
  });

  it("rejects a not-found assignment", async () => {
    mockAssignmentGet.mockResolvedValueOnce({
      exists: false,
      data: () => undefined,
    });
    await expect(
      __assignmentsUpdateDraftHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "assignments.notFound" });
  });

  it("rejects invalid timestamps", async () => {
    await expect(
      __assignmentsUpdateDraftHandler(
        makeRequest({
          data: {
            assignmentId: ASSIGNMENT_ID,
            windowClosesAt: "not-a-date",
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "assignments.invalidWindowClosesAt" });
  });

  it("orders side effects: update, then audit", async () => {
    const calls: string[] = [];
    mockAssignmentGet.mockResolvedValueOnce(existingAssignmentSnapshot());
    mockAssignmentUpdate.mockImplementationOnce(() => {
      calls.push("update");
      return Promise.resolve();
    });
    mockWriteAuditEvent.mockImplementationOnce(() => {
      calls.push("audit");
      return Promise.resolve({ eventId: "evt-1", record: {} });
    });

    await __assignmentsUpdateDraftHandler(makeRequest());

    expect(calls).toEqual(["update", "audit"]);
  });
});
