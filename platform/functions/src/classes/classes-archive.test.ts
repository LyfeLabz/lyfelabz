import type { CallableRequest } from "firebase-functions/v2/https";

const mockClassGet = jest.fn();
const mockClassUpdate = jest.fn();
const mockClassDocRef = jest.fn(() => ({ get: mockClassGet }));
const mockClassArchiveDocRef = jest.fn(() => ({ update: mockClassUpdate }));

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
    classDocRef: mockClassDocRef,
    classArchiveDocRef: mockClassArchiveDocRef,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { __classesArchiveHandler } from "./classes-archive";

const CLASS_ID = "class-abc";

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
    overrides.data === undefined ? { classId: CLASS_ID } : overrides.data;
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
  overrides: {
    teacherId?: string;
    schoolId?: string;
    status?: "active" | "archived";
  } = {},
) {
  return {
    exists: true,
    data: () => ({
      teacherId: overrides.teacherId ?? "teacher-uid",
      schoolId: overrides.schoolId ?? "school-a",
      title: "Original Title",
      grade: "7",
      block: "C",
      joinCode: "ABCD1234",
      status: overrides.status ?? "active",
      createdAt: {} as never,
    }),
  };
}

function absentSnapshot() {
  return { exists: false, data: () => undefined };
}

describe("classesArchive", () => {
  beforeEach(() => {
    mockClassGet.mockReset();
    mockClassUpdate.mockReset();
    mockClassDocRef.mockClear();
    mockClassArchiveDocRef.mockClear();
    mockWriteAuditEvent.mockReset();
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it("archives an active class and emits a single audit event", async () => {
    mockClassGet.mockResolvedValueOnce(existingSnapshot());
    mockClassUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    const result = await __classesArchiveHandler(makeRequest());

    expect(mockClassArchiveDocRef).toHaveBeenCalledWith(CLASS_ID);
    expect(mockClassUpdate).toHaveBeenCalledTimes(1);
    expect(mockClassUpdate).toHaveBeenCalledWith({ status: "archived" });
    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: "teacher-uid",
      actorRole: "teacher",
      action: "classes.archived",
      targetType: "class",
      targetId: CLASS_ID,
      schoolId: "school-a",
    });
    expect(result).toEqual({
      classId: CLASS_ID,
      status: "archived",
      alreadyArchived: false,
    });
  });

  it("is idempotent: an already-archived class returns alreadyArchived without re-writing", async () => {
    mockClassGet.mockResolvedValueOnce(
      existingSnapshot({ status: "archived" }),
    );

    const result = await __classesArchiveHandler(makeRequest());

    expect(result).toEqual({
      classId: CLASS_ID,
      status: "archived",
      alreadyArchived: true,
    });
    expect(mockClassArchiveDocRef).not.toHaveBeenCalled();
    expect(mockClassUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller with classes.unauthenticated", async () => {
    await expect(
      __classesArchiveHandler(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({ code: "classes.unauthenticated" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("rejects non-teacher callers with classes.unauthorized", async () => {
    await expect(
      __classesArchiveHandler(
        makeRequest({
          token: { role: "platformAdministrator", schoolId: "school-a" },
        }),
      ),
    ).rejects.toMatchObject({ code: "classes.unauthorized" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("rejects a cross-teacher archive with classes.forbidden", async () => {
    mockClassGet.mockResolvedValueOnce(
      existingSnapshot({ teacherId: "someone-else" }),
    );

    await expect(
      __classesArchiveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.forbidden" });
    expect(mockClassUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a cross-school archive with classes.forbidden", async () => {
    mockClassGet.mockResolvedValueOnce(
      existingSnapshot({ schoolId: "school-b" }),
    );

    await expect(
      __classesArchiveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.forbidden" });
    expect(mockClassUpdate).not.toHaveBeenCalled();
  });

  it("rejects a class that does not exist with classes.notFound", async () => {
    mockClassGet.mockResolvedValueOnce(absentSnapshot());

    await expect(
      __classesArchiveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.notFound" });
    expect(mockClassUpdate).not.toHaveBeenCalled();
  });

  it("rejects an invalid classId payload", async () => {
    await expect(
      __classesArchiveHandler(makeRequest({ data: { classId: "bad/id" } })),
    ).rejects.toMatchObject({ code: "classes.invalidClassId" });
    await expect(
      __classesArchiveHandler(makeRequest({ data: {} })),
    ).rejects.toMatchObject({ code: "classes.invalidClassId" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("orders side effects: archive write, then audit event", async () => {
    const calls: string[] = [];
    mockClassGet.mockResolvedValueOnce(existingSnapshot());
    mockClassUpdate.mockImplementationOnce(() => {
      calls.push("update");
      return Promise.resolve();
    });
    mockWriteAuditEvent.mockImplementationOnce(() => {
      calls.push("audit");
      return Promise.resolve({ eventId: "evt-1", record: {} });
    });

    await __classesArchiveHandler(makeRequest());

    expect(calls).toEqual(["update", "audit"]);
  });

  it("propagates a downstream archive-write failure and does not write audit", async () => {
    mockClassGet.mockResolvedValueOnce(existingSnapshot());
    const err = new Error("firestore down");
    mockClassUpdate.mockRejectedValueOnce(err);

    await expect(__classesArchiveHandler(makeRequest())).rejects.toBe(err);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });
});
