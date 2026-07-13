import type { CallableRequest } from "firebase-functions/v2/https";

const mockClassGet = jest.fn();
const mockClassUpdate = jest.fn();
const mockClassDocRef = jest.fn(() => ({ get: mockClassGet }));
const mockClassArchiveDocRef = jest.fn(() => ({ update: mockClassUpdate }));

const mockWriteAuditEvent = jest.fn();
const mockRequireDistrictContext = jest.fn();

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
    requireDistrictContext: mockRequireDistrictContext,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __classesArchiveHandler } from "./classes-archive";

const CLASS_ID = "class-abc";

const VALID_DISTRICT_CONTEXT = Object.freeze({
  uid: "teacher-uid",
  role: "teacher" as const,
  schoolId: "school-a",
  districtId: "district-1",
});

function makeRequest(
  overrides: {
    data?: unknown;
  } = {},
): CallableRequest<unknown> {
  const data =
    overrides.data === undefined ? { classId: CLASS_ID } : overrides.data;
  return {
    data,
    auth: { uid: "teacher-uid", token: {} } as never,
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
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValue({ ...VALID_DISTRICT_CONTEXT });
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it("archives an active class and emits a single audit event", async () => {
    mockClassGet.mockResolvedValueOnce(existingSnapshot());
    mockClassUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    const result = await __classesArchiveHandler(makeRequest());

    expect(mockRequireDistrictContext).toHaveBeenCalledTimes(1);
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

  it("propagates the canonical unauthenticated district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("unauthenticated", "no auth"),
    );

    await expect(
      __classesArchiveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("propagates the canonical account-inactive district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("account-inactive", "not active"),
    );

    await expect(
      __classesArchiveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "account-inactive" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("propagates the canonical claim-stale district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("claim-stale", "stale claim"),
    );

    await expect(
      __classesArchiveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "claim-stale" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("propagates the canonical district-mismatch district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("district-mismatch", "mismatch"),
    );

    await expect(
      __classesArchiveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "district-mismatch" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("rejects a non-teacher active caller with role-forbidden", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValueOnce({
      uid: "student-uid",
      role: "student",
      schoolId: "school-a",
      districtId: "district-1",
    });

    await expect(
      __classesArchiveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("rejects a platformAdministrator active caller with role-forbidden", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValueOnce({
      uid: "admin-uid",
      role: "platformAdministrator",
      schoolId: "school-a",
      districtId: "district-1",
    });

    await expect(
      __classesArchiveHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
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
