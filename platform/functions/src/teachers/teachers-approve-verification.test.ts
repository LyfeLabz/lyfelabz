import type { CallableRequest } from "firebase-functions/v2/https";

const mockUserGet = jest.fn();
const mockUserUpdate = jest.fn();
const mockUserRecordDocRef = jest.fn(() => ({
  get: mockUserGet,
  update: mockUserUpdate,
}));

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
    userRecordDocRef: mockUserRecordDocRef,
    writeCustomClaims: mockWriteCustomClaims,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __teachersApproveVerificationHandler } from "./teachers-approve-verification";

function makeRequest(
  overrides: {
    uid?: string;
    data?: unknown;
    hasAuth?: boolean;
    token?: Record<string, unknown>;
  } = {},
): CallableRequest<unknown> {
  const hasAuth = overrides.hasAuth ?? true;
  const uid = overrides.uid ?? "uid-admin";
  const data =
    overrides.data === undefined
      ? { targetUid: "uid-teacher" }
      : overrides.data;
  const token =
    overrides.token ?? { role: "platformAdministrator" };
  return {
    data,
    auth: hasAuth ? ({ uid, token } as never) : undefined,
    rawRequest: {} as never,
  };
}

function pendingTeacherSnapshot(overrides: { schoolId?: string } = {}) {
  return {
    exists: true,
    data: () => ({
      authUid: "uid-teacher",
      status: "pendingVerification" as const,
      createdAt: {} as never,
      role: "teacher",
      schoolId: overrides.schoolId ?? "school-123",
      displayName: "Test Teacher",
    }),
  };
}

function activeTeacherSnapshot(overrides: { schoolId?: string } = {}) {
  return {
    exists: true,
    data: () => ({
      authUid: "uid-teacher",
      status: "active" as const,
      createdAt: {} as never,
      role: "teacher",
      schoolId: overrides.schoolId ?? "school-123",
      displayName: "Test Teacher",
    }),
  };
}

describe("teachersApproveVerification", () => {
  beforeEach(() => {
    mockUserGet.mockReset();
    mockUserUpdate.mockReset();
    mockUserRecordDocRef.mockClear();
    mockWriteCustomClaims.mockReset();
    mockWriteAuditEvent.mockReset();
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it("transitions a pendingVerification teacher to active and returns the canonical response", async () => {
    mockUserGet.mockResolvedValueOnce(pendingTeacherSnapshot());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    mockWriteCustomClaims.mockResolvedValueOnce({
      role: "teacher",
      schoolId: "school-123",
    });
    mockWriteAuditEvent.mockResolvedValueOnce({
      eventId: "evt-1",
      record: {},
    });

    const result = await __teachersApproveVerificationHandler(makeRequest());

    expect(mockUserRecordDocRef).toHaveBeenCalledWith("uid-teacher");
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    expect(mockUserUpdate).toHaveBeenCalledWith({ status: "active" });
    expect(result).toEqual({
      targetUid: "uid-teacher",
      status: "active",
      role: "teacher",
      schoolId: "school-123",
      alreadyActive: false,
    });
  });

  it("rejects an unauthenticated caller with teachers.unauthenticated", async () => {
    await expect(
      __teachersApproveVerificationHandler(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({
      name: "PlatformError",
      code: "teachers.unauthenticated",
    });
    expect(mockUserRecordDocRef).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a non-administrator caller with teachers.unauthorized", async () => {
    await expect(
      __teachersApproveVerificationHandler(
        makeRequest({ token: { role: "teacher" } }),
      ),
    ).rejects.toMatchObject({ code: "teachers.unauthorized" });
    await expect(
      __teachersApproveVerificationHandler(
        makeRequest({ token: { role: "student" } }),
      ),
    ).rejects.toMatchObject({ code: "teachers.unauthorized" });
    await expect(
      __teachersApproveVerificationHandler(makeRequest({ token: {} })),
    ).rejects.toMatchObject({ code: "teachers.unauthorized" });
    expect(mockUserRecordDocRef).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a missing target user with teachers.userNotFound", async () => {
    mockUserGet.mockResolvedValueOnce({
      exists: false,
      data: () => undefined,
    });

    await expect(
      __teachersApproveVerificationHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "teachers.userNotFound" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it.each([["provisioned"], ["suspended"], ["archived"]] as const)(
    "rejects a target whose status is %s with teachers.invalidStatus",
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
        __teachersApproveVerificationHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "teachers.invalidStatus" });
      expect(mockUserUpdate).not.toHaveBeenCalled();
      expect(mockWriteCustomClaims).not.toHaveBeenCalled();
      expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    },
  );

  it("is idempotent: an already-active teacher returns alreadyActive without re-writing", async () => {
    mockUserGet.mockResolvedValueOnce(activeTeacherSnapshot());

    const result = await __teachersApproveVerificationHandler(makeRequest());

    expect(result).toEqual({
      targetUid: "uid-teacher",
      status: "active",
      role: "teacher",
      schoolId: "school-123",
      alreadyActive: true,
    });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("invokes writeCustomClaims with the canonical shape", async () => {
    mockUserGet.mockResolvedValueOnce(pendingTeacherSnapshot());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    mockWriteCustomClaims.mockResolvedValueOnce({
      role: "teacher",
      schoolId: "school-123",
    });
    mockWriteAuditEvent.mockResolvedValueOnce({
      eventId: "evt-1",
      record: {},
    });

    await __teachersApproveVerificationHandler(makeRequest());

    expect(mockWriteCustomClaims).toHaveBeenCalledTimes(1);
    expect(mockWriteCustomClaims).toHaveBeenCalledWith({
      uid: "uid-teacher",
      status: "active",
      role: "teacher",
      schoolId: "school-123",
    });
  });

  it("invokes the audit helper with teachers.verificationApproved and the canonical target fields", async () => {
    mockUserGet.mockResolvedValueOnce(pendingTeacherSnapshot());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    mockWriteCustomClaims.mockResolvedValueOnce({
      role: "teacher",
      schoolId: "school-123",
    });
    mockWriteAuditEvent.mockResolvedValueOnce({
      eventId: "evt-1",
      record: {},
    });

    await __teachersApproveVerificationHandler(makeRequest());

    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: "uid-admin",
      actorRole: "platformAdministrator",
      action: "teachers.verificationApproved",
      targetType: "user",
      targetId: "uid-teacher",
      schoolId: "school-123",
    });
  });

  it("orders side effects: user update, then claims, then audit event", async () => {
    const calls: string[] = [];
    mockUserGet.mockResolvedValueOnce(pendingTeacherSnapshot());
    mockUserUpdate.mockImplementationOnce(() => {
      calls.push("update");
      return Promise.resolve();
    });
    mockWriteCustomClaims.mockImplementationOnce(() => {
      calls.push("claims");
      return Promise.resolve({ role: "teacher", schoolId: "school-123" });
    });
    mockWriteAuditEvent.mockImplementationOnce(() => {
      calls.push("audit");
      return Promise.resolve({ eventId: "evt-1", record: {} });
    });

    await __teachersApproveVerificationHandler(makeRequest());

    expect(calls).toEqual(["update", "claims", "audit"]);
  });

  it("propagates a downstream claims failure and does not write audit", async () => {
    mockUserGet.mockResolvedValueOnce(pendingTeacherSnapshot());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    const claimsErr = new PlatformError(
      "claims.writeFailed",
      "boom",
      new Error("network"),
    );
    mockWriteCustomClaims.mockRejectedValueOnce(claimsErr);

    await expect(
      __teachersApproveVerificationHandler(makeRequest()),
    ).rejects.toBe(claimsErr);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("propagates a downstream audit helper failure", async () => {
    mockUserGet.mockResolvedValueOnce(pendingTeacherSnapshot());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    mockWriteCustomClaims.mockResolvedValueOnce({
      role: "teacher",
      schoolId: "school-123",
    });
    const auditErr = new PlatformError(
      "audit.writeFailed",
      "boom",
      new Error("network"),
    );
    mockWriteAuditEvent.mockRejectedValueOnce(auditErr);

    await expect(
      __teachersApproveVerificationHandler(makeRequest()),
    ).rejects.toBe(auditErr);
  });

  it("rejects an invalid targetUid with teachers.invalidTargetUid", async () => {
    await expect(
      __teachersApproveVerificationHandler(
        makeRequest({ data: { targetUid: "   " } }),
      ),
    ).rejects.toMatchObject({ code: "teachers.invalidTargetUid" });
    await expect(
      __teachersApproveVerificationHandler(makeRequest({ data: {} })),
    ).rejects.toMatchObject({ code: "teachers.invalidTargetUid" });
    expect(mockUserRecordDocRef).not.toHaveBeenCalled();
  });
});
