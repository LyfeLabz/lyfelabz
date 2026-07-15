import type { CallableRequest } from "firebase-functions/v2/https";

const mockUserGet = jest.fn();
const mockUserUpdate = jest.fn();
const mockUserRecordDocRef = jest.fn(() => ({
  get: mockUserGet,
  update: mockUserUpdate,
}));

const mockWriteCustomClaims = jest.fn();
const mockWriteAuditEvent = jest.fn();

const mockFieldValueDelete = jest.fn(() => "__DELETE__");

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    delete: (...args: unknown[]) => mockFieldValueDelete(...(args as [])),
  },
}));

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    userRecordDocRef: mockUserRecordDocRef,
    writeCustomClaims: mockWriteCustomClaims,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { __teachersDenyVerificationHandler } from "./teachers-deny-verification";

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

function pendingTeacherSnapshot() {
  return {
    exists: true,
    data: () => ({
      authUid: "uid-teacher",
      status: "pendingVerification" as const,
      createdAt: {} as never,
      role: "teacher",
      schoolId: "school-123",
      displayName: "Test Teacher",
    }),
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

describe("teachersDenyVerification", () => {
  beforeEach(() => {
    mockUserGet.mockReset();
    mockUserUpdate.mockReset();
    mockUserRecordDocRef.mockClear();
    mockWriteCustomClaims.mockReset();
    mockWriteAuditEvent.mockReset();
    mockFieldValueDelete.mockClear();
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
  });

  it("transitions a pendingVerification teacher to provisioned and returns the canonical response", async () => {
    mockUserGet.mockResolvedValueOnce(pendingTeacherSnapshot());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({
      eventId: "evt-1",
      record: {},
    });

    const result = await __teachersDenyVerificationHandler(makeRequest());

    expect(mockUserRecordDocRef).toHaveBeenCalledWith("uid-teacher");
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    expect(mockUserUpdate).toHaveBeenCalledWith({
      status: "provisioned",
      role: "__DELETE__",
      schoolId: "__DELETE__",
      displayName: "__DELETE__",
    });
    expect(result).toEqual({
      targetUid: "uid-teacher",
      status: "provisioned",
      schoolId: "school-123",
      alreadyProvisioned: false,
    });
  });

  it("rejects an unauthenticated caller with teachers.unauthenticated", async () => {
    await expect(
      __teachersDenyVerificationHandler(makeRequest({ hasAuth: false })),
    ).rejects.toMatchObject({ code: "teachers.unauthenticated" });
    expect(mockUserRecordDocRef).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a non-administrator caller with teachers.unauthorized", async () => {
    await expect(
      __teachersDenyVerificationHandler(
        makeRequest({ token: { role: "teacher" } }),
      ),
    ).rejects.toMatchObject({ code: "teachers.unauthorized" });
    expect(mockUserRecordDocRef).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a missing target user with teachers.userNotFound", async () => {
    mockUserGet.mockResolvedValueOnce({
      exists: false,
      data: () => undefined,
    });

    await expect(
      __teachersDenyVerificationHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "teachers.userNotFound" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it.each([["active"], ["suspended"], ["archived"]] as const)(
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
        __teachersDenyVerificationHandler(makeRequest()),
      ).rejects.toMatchObject({ code: "teachers.invalidStatus" });
      expect(mockUserUpdate).not.toHaveBeenCalled();
      expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    },
  );

  it("is idempotent: an already-provisioned target returns alreadyProvisioned without re-writing", async () => {
    mockUserGet.mockResolvedValueOnce(provisionedSnapshot());

    const result = await __teachersDenyVerificationHandler(makeRequest());

    expect(result).toEqual({
      targetUid: "uid-teacher",
      status: "provisioned",
      schoolId: null,
      alreadyProvisioned: true,
    });
    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("never issues custom claims during denial", async () => {
    mockUserGet.mockResolvedValueOnce(pendingTeacherSnapshot());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({
      eventId: "evt-1",
      record: {},
    });

    await __teachersDenyVerificationHandler(makeRequest());

    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
  });

  it("invokes the audit helper with teachers.verificationDenied and the canonical target fields", async () => {
    mockUserGet.mockResolvedValueOnce(pendingTeacherSnapshot());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({
      eventId: "evt-1",
      record: {},
    });

    await __teachersDenyVerificationHandler(makeRequest());

    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: "uid-admin",
      actorRole: "platformAdministrator",
      action: "teachers.verificationDenied",
      targetType: "user",
      targetId: "uid-teacher",
      schoolId: "school-123",
    });
  });

  it("orders side effects: user update, then audit event", async () => {
    const calls: string[] = [];
    mockUserGet.mockResolvedValueOnce(pendingTeacherSnapshot());
    mockUserUpdate.mockImplementationOnce(() => {
      calls.push("update");
      return Promise.resolve();
    });
    mockWriteAuditEvent.mockImplementationOnce(() => {
      calls.push("audit");
      return Promise.resolve({ eventId: "evt-1", record: {} });
    });

    await __teachersDenyVerificationHandler(makeRequest());

    expect(calls).toEqual(["update", "audit"]);
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
  });

  it("propagates a downstream audit helper failure", async () => {
    mockUserGet.mockResolvedValueOnce(pendingTeacherSnapshot());
    mockUserUpdate.mockResolvedValueOnce(undefined);
    const auditErr = new PlatformError(
      "audit.writeFailed",
      "boom",
      new Error("network"),
    );
    mockWriteAuditEvent.mockRejectedValueOnce(auditErr);

    await expect(
      __teachersDenyVerificationHandler(makeRequest()),
    ).rejects.toBe(auditErr);
    expect(mockWriteCustomClaims).not.toHaveBeenCalled();
  });
});
