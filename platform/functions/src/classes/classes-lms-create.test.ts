import type { CallableRequest } from "firebase-functions/v2/https";

const mockClassGet = jest.fn();
const mockClassSet = jest.fn();
const mockClassDocRef = jest.fn(() => ({ get: mockClassGet }));
const mockClassLmsCreationDocRef = jest.fn(() => ({ set: mockClassSet }));

const mockWriteAuditEvent = jest.fn();
const mockRequireDistrictContext = jest.fn();

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

const SERVER_TIMESTAMP_SENTINEL = Symbol("serverTimestamp");

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
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
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    classDocRef: mockClassDocRef,
    classLmsCreationDocRef: mockClassLmsCreationDocRef,
    requireDistrictContext: mockRequireDistrictContext,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __classesLmsCreateHandler } from "./classes-lms-create";

const CLASS_ID = "class-lms-abc";
const TITLE = "Grade 7 Science, Block C";

const VALID_DISTRICT_CONTEXT = Object.freeze({
  uid: "teacher-uid",
  role: "teacher" as const,
  schoolId: "school-a",
  districtId: "district-1",
});

function makeRequest(
  overrides: { data?: unknown } = {},
): CallableRequest<unknown> {
  const data =
    overrides.data === undefined
      ? { classId: CLASS_ID, title: TITLE }
      : overrides.data;
  return {
    data,
    auth: { uid: "teacher-uid", token: {} } as never,
    rawRequest: {} as never,
  };
}

function absentSnapshot() {
  return { exists: false, data: () => undefined };
}

function needsSetupSnapshot(
  overrides: { teacherId?: string; schoolId?: string; title?: string } = {},
) {
  return {
    exists: true,
    data: () => ({
      teacherId: overrides.teacherId ?? "teacher-uid",
      schoolId: overrides.schoolId ?? "school-a",
      title: overrides.title ?? TITLE,
      status: "needsSetup",
      createdAt: {} as never,
    }),
  };
}

function activeSnapshot() {
  return {
    exists: true,
    data: () => ({
      teacherId: "teacher-uid",
      schoolId: "school-a",
      title: TITLE,
      grade: "7",
      block: "C",
      joinCode: "ABCDEF12",
      status: "active",
      createdAt: {} as never,
    }),
  };
}

describe("classesLmsCreate", () => {
  beforeEach(() => {
    mockClassGet.mockReset();
    mockClassSet.mockReset();
    mockClassDocRef.mockClear();
    mockClassLmsCreationDocRef.mockClear();
    mockWriteAuditEvent.mockReset();
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValue({ ...VALID_DISTRICT_CONTEXT });
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it("creates a needsSetup class with the narrow write shape", async () => {
    mockClassGet.mockResolvedValueOnce(absentSnapshot());
    mockClassSet.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });

    const result = await __classesLmsCreateHandler(makeRequest());

    expect(mockClassLmsCreationDocRef).toHaveBeenCalledWith(CLASS_ID);
    expect(mockClassSet).toHaveBeenCalledTimes(1);
    const written = mockClassSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(written).toEqual({
      teacherId: "teacher-uid",
      schoolId: "school-a",
      title: TITLE,
      status: "needsSetup",
      createdAt: SERVER_TIMESTAMP_SENTINEL,
    });
    // Absent fields per Spec §7.4.
    expect(written).not.toHaveProperty("grade");
    expect(written).not.toHaveProperty("block");
    expect(written).not.toHaveProperty("joinCode");
    expect(written).not.toHaveProperty("enrollmentSource");
    expect(written).not.toHaveProperty("lmsProviderRef");

    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: "teacher-uid",
      actorRole: "teacher",
      action: "classes.created",
      targetType: "class",
      targetId: CLASS_ID,
      schoolId: "school-a",
      districtId: "district-1",
      payload: { source: "lms" },
    });

    expect(result).toEqual({
      classId: CLASS_ID,
      status: "needsSetup",
      alreadyCreated: false,
    });
  });

  it("is idempotent on an existing needsSetup class with matching owner and title", async () => {
    mockClassGet.mockResolvedValueOnce(needsSetupSnapshot());

    const result = await __classesLmsCreateHandler(makeRequest());

    expect(result).toEqual({
      classId: CLASS_ID,
      status: "needsSetup",
      alreadyCreated: true,
    });
    expect(mockClassSet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects an existing active class at the same classId (Manual Create shape is not idempotent here)", async () => {
    mockClassGet.mockResolvedValueOnce(activeSnapshot());

    await expect(
      __classesLmsCreateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.conflict" });
    expect(mockClassSet).not.toHaveBeenCalled();
  });

  it("rejects a cross-teacher needsSetup duplicate", async () => {
    mockClassGet.mockResolvedValueOnce(
      needsSetupSnapshot({ teacherId: "someone-else" }),
    );

    await expect(
      __classesLmsCreateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.conflict" });
    expect(mockClassSet).not.toHaveBeenCalled();
  });

  it("rejects a cross-school needsSetup duplicate", async () => {
    mockClassGet.mockResolvedValueOnce(
      needsSetupSnapshot({ schoolId: "school-b" }),
    );

    await expect(
      __classesLmsCreateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.conflict" });
    expect(mockClassSet).not.toHaveBeenCalled();
  });

  it("rejects a needsSetup document with a different title", async () => {
    mockClassGet.mockResolvedValueOnce(
      needsSetupSnapshot({ title: "Something else" }),
    );

    await expect(
      __classesLmsCreateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "classes.conflict" });
  });

  it("propagates the canonical unauthenticated district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("unauthenticated", "no auth"),
    );

    await expect(
      __classesLmsCreateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("propagates the canonical account-inactive district error", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockRejectedValueOnce(
      new PlatformError("account-inactive", "not active"),
    );

    await expect(
      __classesLmsCreateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "account-inactive" });
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
      __classesLmsCreateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("rejects a platformAdministrator caller with role-forbidden", async () => {
    mockRequireDistrictContext.mockReset();
    mockRequireDistrictContext.mockResolvedValueOnce({
      uid: "admin-uid",
      role: "platformAdministrator",
      schoolId: "school-a",
      districtId: "district-1",
    });

    await expect(
      __classesLmsCreateHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "role-forbidden" });
  });

  it("rejects a non-object payload", async () => {
    await expect(
      __classesLmsCreateHandler(makeRequest({ data: null })),
    ).rejects.toMatchObject({ code: "classes.invalidRequest" });
    await expect(
      __classesLmsCreateHandler(makeRequest({ data: "x" })),
    ).rejects.toMatchObject({ code: "classes.invalidRequest" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("rejects an invalid classId payload", async () => {
    await expect(
      __classesLmsCreateHandler(
        makeRequest({ data: { classId: "bad/id", title: TITLE } }),
      ),
    ).rejects.toMatchObject({ code: "classes.invalidClassId" });
    await expect(
      __classesLmsCreateHandler(makeRequest({ data: { title: TITLE } })),
    ).rejects.toMatchObject({ code: "classes.invalidClassId" });
    expect(mockClassGet).not.toHaveBeenCalled();
  });

  it("rejects an empty title", async () => {
    await expect(
      __classesLmsCreateHandler(
        makeRequest({ data: { classId: CLASS_ID, title: "   " } }),
      ),
    ).rejects.toMatchObject({ code: "classes.invalidTitle" });
  });

  it("ignores unexpected keys on the request (closed parsing)", async () => {
    mockClassGet.mockResolvedValueOnce(absentSnapshot());
    mockClassSet.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-x", record: {} });

    await __classesLmsCreateHandler(
      makeRequest({
        data: {
          classId: CLASS_ID,
          title: TITLE,
          grade: "9",
          block: "Z",
          joinCode: "SNEAK123",
          teacherId: "attacker",
          schoolId: "attacker-school",
          status: "active",
          enrollmentSource: "lms",
          lmsProviderRef: "googleClassroom",
          providerId: "googleClassroom",
          lmsClassId: "upstream-123",
        },
      }),
    );

    const written = mockClassSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual([
      "createdAt",
      "schoolId",
      "status",
      "teacherId",
      "title",
    ]);
    expect(written.teacherId).toBe("teacher-uid");
    expect(written.schoolId).toBe("school-a");
    expect(written.status).toBe("needsSetup");
  });

  it("orders side effects: creation write, then audit event", async () => {
    const calls: string[] = [];
    mockClassGet.mockResolvedValueOnce(absentSnapshot());
    mockClassSet.mockImplementationOnce(() => {
      calls.push("set");
      return Promise.resolve();
    });
    mockWriteAuditEvent.mockImplementationOnce(() => {
      calls.push("audit");
      return Promise.resolve({ eventId: "evt-1", record: {} });
    });

    await __classesLmsCreateHandler(makeRequest());
    expect(calls).toEqual(["set", "audit"]);
  });

  it("propagates a downstream creation-write failure and does not write audit", async () => {
    mockClassGet.mockResolvedValueOnce(absentSnapshot());
    const err = new Error("firestore down");
    mockClassSet.mockRejectedValueOnce(err);

    await expect(__classesLmsCreateHandler(makeRequest())).rejects.toBe(err);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("does not touch teacher preferences", async () => {
    // Confirmed by construction: this test file's shared mock does not
    // register `teacherPreferencesUpdateDocRef`. If the handler ever
    // reaches for it, the module would fail to import.
    mockClassGet.mockResolvedValueOnce(absentSnapshot());
    mockClassSet.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "evt-1", record: {} });
    await expect(__classesLmsCreateHandler(makeRequest())).resolves.toBeDefined();
  });
});
