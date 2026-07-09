import type { CallableRequest } from "firebase-functions/v2/https";

const mockClassGet = jest.fn();
const mockClassUpdate = jest.fn();
const mockClassDocRef = jest.fn(() => ({ get: mockClassGet }));
const mockClassMetadataUpdateDocRef = jest.fn(() => ({
  update: mockClassUpdate,
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
    classDocRef: mockClassDocRef,
    classMetadataUpdateDocRef: mockClassMetadataUpdateDocRef,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { __classesUpdateMetadataHandler } from "./classes-update-metadata";

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
    overrides.data === undefined
      ? { classId: CLASS_ID, title: "Renamed Class" }
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
  overrides: {
    teacherId?: string;
    schoolId?: string;
    title?: string;
    grade?: string;
    block?: string;
    status?: "active" | "archived";
    academicTerm?: string;
  } = {},
) {
  return {
    exists: true,
    data: () => ({
      teacherId: overrides.teacherId ?? "teacher-uid",
      schoolId: overrides.schoolId ?? "school-a",
      title: overrides.title ?? "Original Title",
      grade: overrides.grade ?? "7",
      block: overrides.block ?? "C",
      joinCode: "ABCD1234",
      status: overrides.status ?? "active",
      createdAt: {} as never,
      ...(overrides.academicTerm !== undefined
        ? { academicTerm: overrides.academicTerm }
        : {}),
    }),
  };
}

function absentSnapshot() {
  return { exists: false, data: () => undefined };
}

describe("classesUpdateMetadata", () => {
  beforeEach(() => {
    mockClassGet.mockReset();
    mockClassUpdate.mockReset();
    mockClassDocRef.mockClear();
    mockClassMetadataUpdateDocRef.mockClear();
    mockWriteAuditEvent.mockReset();
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it("updates only the fields whose values differ and emits a single audit event", async () => {
    mockClassGet.mockResolvedValueOnce(existingSnapshot());
    mockClassUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    const result = await __classesUpdateMetadataHandler(
      makeRequest({
        data: {
          classId: CLASS_ID,
          title: "Renamed Class",
          grade: "7",
          block: "C",
          academicTerm: "Fall 2026",
        },
      }),
    );

    expect(mockClassUpdate).toHaveBeenCalledTimes(1);
    expect(mockClassUpdate).toHaveBeenCalledWith({
      title: "Renamed Class",
      academicTerm: "Fall 2026",
    });
    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: "teacher-uid",
      actorRole: "teacher",
      action: "classes.metadataUpdated",
      targetType: "class",
      targetId: CLASS_ID,
      schoolId: "school-a",
      payload: { changedFields: ["title", "academicTerm"] },
    });
    expect(result).toEqual({ classId: CLASS_ID, alreadyUpdated: false });
  });

  it("is idempotent when every submitted field already matches the record", async () => {
    mockClassGet.mockResolvedValueOnce(
      existingSnapshot({ title: "Renamed Class" }),
    );

    const result = await __classesUpdateMetadataHandler(makeRequest());

    expect(result).toEqual({ classId: CLASS_ID, alreadyUpdated: true });
    expect(mockClassUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller with classes.unauthenticated", async () => {
    await expect(
      __classesUpdateMetadataHandler(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({ code: "classes.unauthenticated" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("rejects non-teacher callers with classes.unauthorized", async () => {
    await expect(
      __classesUpdateMetadataHandler(
        makeRequest({
          token: { role: "platformAdministrator", schoolId: "school-a" },
        }),
      ),
    ).rejects.toMatchObject({ code: "classes.unauthorized" });
    await expect(
      __classesUpdateMetadataHandler(
        makeRequest({ token: { role: "student", schoolId: "school-a" } }),
      ),
    ).rejects.toMatchObject({ code: "classes.unauthorized" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("rejects a teacher who is not the owning teacher with classes.forbidden", async () => {
    mockClassGet.mockResolvedValueOnce(
      existingSnapshot({ teacherId: "someone-else" }),
    );

    await expect(
      __classesUpdateMetadataHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.forbidden" });
    expect(mockClassUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a cross-school update with classes.forbidden", async () => {
    mockClassGet.mockResolvedValueOnce(
      existingSnapshot({ schoolId: "school-b" }),
    );

    await expect(
      __classesUpdateMetadataHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.forbidden" });
    expect(mockClassUpdate).not.toHaveBeenCalled();
  });

  it("rejects an update against an archived class with classes.invalidStatus", async () => {
    mockClassGet.mockResolvedValueOnce(
      existingSnapshot({ status: "archived" }),
    );

    await expect(
      __classesUpdateMetadataHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.invalidStatus" });
    expect(mockClassUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a class that does not exist with classes.notFound", async () => {
    mockClassGet.mockResolvedValueOnce(absentSnapshot());

    await expect(
      __classesUpdateMetadataHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.notFound" });
    expect(mockClassUpdate).not.toHaveBeenCalled();
  });

  it("rejects a payload with no metadata fields with classes.invalidRequest", async () => {
    await expect(
      __classesUpdateMetadataHandler(
        makeRequest({ data: { classId: CLASS_ID } }),
      ),
    ).rejects.toMatchObject({ code: "classes.invalidRequest" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("rejects a payload with an invalid grade with classes.invalidGrade", async () => {
    await expect(
      __classesUpdateMetadataHandler(
        makeRequest({ data: { classId: CLASS_ID, grade: "not-a-grade!" } }),
      ),
    ).rejects.toMatchObject({ code: "classes.invalidGrade" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("rejects a payload with an invalid block with classes.invalidBlock", async () => {
    await expect(
      __classesUpdateMetadataHandler(
        makeRequest({ data: { classId: CLASS_ID, block: "Z" } }),
      ),
    ).rejects.toMatchObject({ code: "classes.invalidBlock" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("orders side effects: metadata update, then audit event", async () => {
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

    await __classesUpdateMetadataHandler(makeRequest());

    expect(calls).toEqual(["update", "audit"]);
  });
});
