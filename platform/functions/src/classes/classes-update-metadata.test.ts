import type { CallableRequest } from "firebase-functions/v2/https";

const mockClassGet = jest.fn();
const mockClassUpdate = jest.fn();
const mockClassDocRef = jest.fn(() => ({ get: mockClassGet }));
const mockClassMetadataUpdateDocRef = jest.fn(() => ({
  update: mockClassUpdate,
}));

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
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    classDocRef: mockClassDocRef,
    classMetadataUpdateDocRef: mockClassMetadataUpdateDocRef,
    requireDistrictContext: mockRequireDistrictContext,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __classesUpdateMetadataHandler } from "./classes-update-metadata";

const VALID_DISTRICT_CONTEXT = Object.freeze({
  uid: "teacher-uid",
  role: "teacher" as const,
  schoolId: "school-a",
  districtId: "district-1",
});

const CLASS_ID = "class-abc";

function makeRequest(
  overrides: {
    data?: unknown;
  } = {},
): CallableRequest<unknown> {
  const data =
    overrides.data === undefined
      ? { classId: CLASS_ID, title: "Renamed Class" }
      : overrides.data;
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
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValue({ ...VALID_DISTRICT_CONTEXT });
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

  it("propagates the canonical unauthenticated district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("unauthenticated", "no auth"),
    );
    await expect(
      __classesUpdateMetadataHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("propagates the canonical account-inactive district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("account-inactive", "not active"),
    );
    await expect(
      __classesUpdateMetadataHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "account-inactive" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("propagates the canonical claim-stale district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("claim-stale", "stale claim"),
    );
    await expect(
      __classesUpdateMetadataHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "claim-stale" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("propagates the canonical district-mismatch district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("district-mismatch", "mismatch"),
    );
    await expect(
      __classesUpdateMetadataHandler(makeRequest()),
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
      __classesUpdateMetadataHandler(makeRequest()),
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
      __classesUpdateMetadataHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
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
