import type { UserRecord } from "firebase-admin/auth";

const mockCreate = jest.fn();
const mockUserDocRef = jest.fn(() => ({ create: mockCreate }));
const mockLogInfo = jest.fn();
const mockLogError = jest.fn();
const mockWriteAuditEvent = jest.fn();
const mockCaptured: { handler?: (user: UserRecord) => Promise<void> } = {};

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => "SERVER_TIMESTAMP",
  },
}));

jest.mock("firebase-functions/v1", () => ({
  auth: {
    user: () => ({
      onCreate: (fn: (user: UserRecord) => Promise<void>) => {
        mockCaptured.handler = fn;
        return fn;
      },
    }),
  },
}));

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    log: { info: mockLogInfo, error: mockLogError },
    userDocRef: mockUserDocRef,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import "./auth-on-user-create";

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  const base = {
    uid: "uid-abc",
    email: "student@example.com",
    displayName: "Test Student",
    photoURL: "https://example.com/avatar.png",
    providerData: [{ providerId: "google.com" }],
  };
  return { ...base, ...overrides } as unknown as UserRecord;
}

function invokeHandler(user: UserRecord): Promise<void> {
  if (!mockCaptured.handler) {
    throw new Error("authOnUserCreate handler was not captured.");
  }
  return mockCaptured.handler(user);
}

describe("authOnUserCreate", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockUserDocRef.mockClear();
    mockLogInfo.mockReset();
    mockLogError.mockReset();
    mockWriteAuditEvent.mockReset();
    mockWriteAuditEvent.mockResolvedValue({
      eventId: "evt-provisioned-1",
      record: {},
    });
  });

  it("provisions users/{uid} with canonical fields and optional email + displayName", async () => {
    mockCreate.mockResolvedValueOnce(undefined);

    await invokeHandler(makeUser());

    expect(mockUserDocRef).toHaveBeenCalledTimes(1);
    expect(mockUserDocRef).toHaveBeenCalledWith("uid-abc");
    expect(mockCreate).toHaveBeenCalledTimes(1);

    const payload = mockCreate.mock.calls[0][0];
    expect(payload).toEqual({
      authUid: "uid-abc",
      status: "provisioned",
      createdAt: "SERVER_TIMESTAMP",
      email: "student@example.com",
      displayName: "Test Student",
    });
  });

  it("omits optional email and displayName when the Auth record has neither", async () => {
    mockCreate.mockResolvedValueOnce(undefined);

    await invokeHandler(
      makeUser({
        email: undefined,
        displayName: undefined,
      }),
    );

    const payload = mockCreate.mock.calls[0][0];
    expect(payload).toEqual({
      authUid: "uid-abc",
      status: "provisioned",
      createdAt: "SERVER_TIMESTAMP",
    });
    expect(Object.prototype.hasOwnProperty.call(payload, "email")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload, "displayName")).toBe(
      false,
    );
  });

  it("does not persist uid, provider, or photoURL on the users/{uid} document", async () => {
    mockCreate.mockResolvedValueOnce(undefined);

    await invokeHandler(makeUser());

    const payload = mockCreate.mock.calls[0][0];
    const keys = Object.keys(payload);
    expect(keys).not.toContain("uid");
    expect(keys).not.toContain("provider");
    expect(keys).not.toContain("photoURL");
  });

  it("throws PlatformError('auth.invalidUserRecord') when the Auth record has no uid", async () => {
    const user = makeUser({ uid: "" });

    await expect(invokeHandler(user)).rejects.toBeInstanceOf(PlatformError);
    await expect(invokeHandler(user)).rejects.toMatchObject({
      code: "auth.invalidUserRecord",
    });

    expect(mockUserDocRef).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith(
      "auth.userCreateFailed",
      expect.objectContaining({ uid: null, cause: "auth.invalidUserRecord" }),
    );
  });

  it("is idempotent: a duplicate create (ALREADY_EXISTS) is swallowed and logged as skipped", async () => {
    const alreadyExists: Error & { code?: number } = new Error(
      "6 ALREADY_EXISTS: Document already exists",
    );
    alreadyExists.code = 6;
    mockCreate.mockRejectedValueOnce(alreadyExists);

    await expect(invokeHandler(makeUser())).resolves.toBeUndefined();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockLogInfo).toHaveBeenCalledWith(
      "auth.userCreateSkipped",
      expect.objectContaining({ uid: "uid-abc", reason: "already-exists" }),
    );
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("happy path emits exactly one auth.userProvisioned audit event with actorRole 'system' and no schoolId", async () => {
    mockCreate.mockResolvedValueOnce(undefined);

    await invokeHandler(makeUser());

    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    const event = mockWriteAuditEvent.mock.calls[0][0];
    expect(event).toEqual({
      actorUserId: "uid-abc",
      actorRole: "system",
      action: "auth.userProvisioned",
      targetType: "user",
      targetId: "uid-abc",
    });
    expect(Object.prototype.hasOwnProperty.call(event, "schoolId")).toBe(false);
  });

  it("idempotent-skip branch emits zero provisioning audit events", async () => {
    const alreadyExists: Error & { code?: number } = new Error(
      "6 ALREADY_EXISTS: Document already exists",
    );
    alreadyExists.code = 6;
    mockCreate.mockRejectedValueOnce(alreadyExists);

    await expect(invokeHandler(makeUser())).resolves.toBeUndefined();

    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });
});
