import type { CallableRequest } from "firebase-functions/v2/https";

const mockUserGet = jest.fn();
const mockUserUpdate = jest.fn();
const mockUserRecordDocRef = jest.fn(() => ({
  get: mockUserGet,
  update: mockUserUpdate,
}));

const mockSchoolGet = jest.fn();
const mockSchoolDocRef = jest.fn(() => ({ get: mockSchoolGet }));

const mockWriteCustomClaims = jest.fn();
const mockWriteAuditEvent = jest.fn();

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

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
    schoolDocRef: mockSchoolDocRef,
    userRecordDocRef: mockUserRecordDocRef,
    writeCustomClaims: mockWriteCustomClaims,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __teachersRequestVerificationHandler } from "./teachers-request-verification";

function makeRequest(
  overrides: {
    uid?: string | null;
    data?: unknown;
    hasAuth?: boolean;
  } = {},
): CallableRequest<unknown> {
  const hasAuth = overrides.hasAuth ?? true;
  const uid = overrides.uid ?? "uid-teacher";
  const data =
    overrides.data === undefined
      ? {
          role: "teacher",
          schoolId: "school-123",
          displayName: "Test Teacher",
        }
      : overrides.data;
  return {
    data,
    auth: hasAuth ? ({ uid, token: {} } as never) : undefined,
    rawRequest: {} as never,
  };
}

function provisionedSnapshot() {
  return {
    exists: true,
    data: () => ({
      authUid: "uid-teacher",
      status: "provisioned" as const,
      createdAt: {} as never,
    }),
  };
}

function pendingTeacherSnapshot(
  overrides: {
    role?: string;
    schoolId?: string;
    displayName?: string;
  } = {},
) {
  return {
    exists: true,
    data: () => ({
      authUid: "uid-teacher",
      status: "pendingVerification" as const,
      createdAt: {} as never,
      role: overrides.role ?? "teacher",
      schoolId: overrides.schoolId ?? "school-123",
      displayName: overrides.displayName ?? "Test Teacher",
    }),
  };
}

function schoolSnapshotExists() {
  return {
    exists: true,
    data: () => ({
      name: "Test School",
      shortName: "Test",
      timezone: "America/New_York",
      createdAt: {} as never,
    }),
  };
}

describe("teachersRequestVerification", () => {
  beforeEach(() => {
    mockUserGet.mockReset();
    mockUserUpdate.mockReset();
    mockUserRecordDocRef.mockClear();
    mockSchoolGet.mockReset();
    mockSchoolDocRef.mockClear();
    mockWriteCustomClaims.mockReset();
    mockWriteAuditEvent.mockReset();
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it("transitions a provisioned user to pendingVerification and returns the canonical response", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({
      eventId: "evt-1",
      record: {},
    });

    const result = await __teachersRequestVerificationHandler(makeRequest());

    expect(mockUserRecordDocRef).toHaveBeenCalledWith("uid-teacher");
    expect(mockSchoolDocRef).toHaveBeenCalledWith("school-123");
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      role: "teacher",
      schoolId: "school-123",
      displayName: "Test Teacher",
      status: "pendingVerification",
    });
    expect(result).toEqual({
      uid: "uid-teacher",
      status: "pendingVerification",
      role: "teacher",
      schoolId: "school-123",
      alreadyPending: false,
    });
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller with teachers.unauthenticated", async () => {
    await expect(
      __teachersRequestVerificationHandler(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({
      name: "PlatformError",
      code: "teachers.unauthenticated",
    });
    expect(mockUserRecordDocRef).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a non-teacher role in the request payload with teachers.invalidRole", async () => {
    await expect(
      __teachersRequestVerificationHandler(
        makeRequest({
          data: {
            role: "student",
            schoolId: "school-123",
            displayName: "Test",
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "teachers.invalidRole" });
    expect(mockUserRecordDocRef).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects an empty schoolId with teachers.invalidSchoolId", async () => {
    await expect(
      __teachersRequestVerificationHandler(
        makeRequest({
          data: { role: "teacher", schoolId: "   ", displayName: "Test" },
        }),
      ),
    ).rejects.toMatchObject({ code: "teachers.invalidSchoolId" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects an empty displayName with teachers.invalidDisplayName", async () => {
    await expect(
      __teachersRequestVerificationHandler(
        makeRequest({
          data: {
            role: "teacher",
            schoolId: "school-123",
            displayName: "",
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "teachers.invalidDisplayName" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
  });

  it("rejects a non-object request payload with teachers.invalidRequest", async () => {
    await expect(
      __teachersRequestVerificationHandler(makeRequest({ data: null })),
    ).rejects.toMatchObject({ code: "teachers.invalidRequest" });
    await expect(
      __teachersRequestVerificationHandler(
        makeRequest({ data: "not-an-object" }),
      ),
    ).rejects.toMatchObject({ code: "teachers.invalidRequest" });
  });

  it("rejects a missing user document with teachers.userNotFound", async () => {
    mockUserGet.mockResolvedValueOnce({
      exists: false,
      data: () => undefined,
    });

    await expect(
      __teachersRequestVerificationHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "teachers.userNotFound" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a missing school document with teachers.schoolNotFound and does not mutate state", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce({
      exists: false,
      data: () => undefined,
    });

    await expect(
      __teachersRequestVerificationHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "teachers.schoolNotFound" });

    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("is idempotent: an already-pending teacher with the same schoolId returns alreadyPending without re-writing", async () => {
    mockUserGet.mockResolvedValueOnce(pendingTeacherSnapshot());

    const result = await __teachersRequestVerificationHandler(makeRequest());

    expect(result).toEqual({
      uid: "uid-teacher",
      status: "pendingVerification",
      role: "teacher",
      schoolId: "school-123",
      alreadyPending: true,
    });
    expect(mockSchoolDocRef).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects an already-pending teacher whose role or schoolId conflicts with the request with teachers.invalidStatus", async () => {
    mockUserGet.mockResolvedValueOnce(
      pendingTeacherSnapshot({ schoolId: "school-different" }),
    );

    await expect(
      __teachersRequestVerificationHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "teachers.invalidStatus" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it.each([["active"], ["suspended"], ["archived"]] as const)(
    "rejects a caller whose status is %s with teachers.invalidStatus",
    async (status) => {
      mockUserGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          authUid: "uid-teacher",
          status,
          createdAt: {} as never,
        }),
      });

      await expect(
        __teachersRequestVerificationHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "teachers.invalidStatus" });
      expect(mockUserUpdate).not.toHaveBeenCalled();
      expect(mockWriteCustomClaims).not.toHaveBeenCalled();
      expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    },
  );

  it("invokes the canonical audit helper with action teachers.verificationRequested and the canonical target fields", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({
      eventId: "evt-1",
      record: {},
    });

    await __teachersRequestVerificationHandler(makeRequest());

    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: "uid-teacher",
      actorRole: "teacher",
      action: "teachers.verificationRequested",
      targetType: "user",
      targetId: "uid-teacher",
      schoolId: "school-123",
    });
  });

  it("never issues custom claims during the verification request", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({
      eventId: "evt-1",
      record: {},
    });

    await __teachersRequestVerificationHandler(makeRequest());

    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
  });

  it("orders side effects: user update, then audit event", async () => {
    const calls: string[] = [];
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockUserUpdate.mockImplementationOnce(() => {
      calls.push("update");
      return Promise.resolve();
    });
    mockWriteAuditEvent.mockImplementationOnce(() => {
      calls.push("audit");
      return Promise.resolve({ eventId: "evt-1", record: {} });
    });

    await __teachersRequestVerificationHandler(makeRequest());

    expect(calls).toEqual(["update", "audit"]);
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
  });

  it("propagates a downstream user update failure and does not write audit", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    const updateErr = new Error("firestore down");
    mockUserUpdate.mockRejectedValueOnce(updateErr);

    await expect(
      __teachersRequestVerificationHandler(makeRequest()),
    ).rejects.toBe(updateErr);
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("propagates a downstream audit helper failure", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());
    mockSchoolGet.mockResolvedValueOnce(schoolSnapshotExists());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    const auditErr = new PlatformError(
      "audit.writeFailed",
      "boom",
      new Error("network"),
    );
    mockWriteAuditEvent.mockRejectedValueOnce(auditErr);

    await expect(
      __teachersRequestVerificationHandler(makeRequest()),
    ).rejects.toBe(auditErr);
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
  });
});
