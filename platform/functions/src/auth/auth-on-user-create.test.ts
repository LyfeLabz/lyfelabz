import type { UserRecord } from "firebase-admin/auth";

const mockCreate = jest.fn();
const mockUserDocRef = jest.fn(() => ({ create: mockCreate }));
const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();
const mockWriteAuditEvent = jest.fn();
const mockCreateOrConfirm = jest.fn();
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
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    userDocRef: mockUserDocRef,
    writeAuditEvent: mockWriteAuditEvent,
    createOrConfirmExternalIdentity: mockCreateOrConfirm,
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
    providerData: [{ providerId: "google.com", uid: "1234567890" }],
  };
  return { ...base, ...overrides } as unknown as UserRecord;
}

function invokeHandler(user: UserRecord): Promise<void> {
  if (!mockCaptured.handler) {
    throw new Error("authOnUserCreate handler was not captured.");
  }
  return mockCaptured.handler(user);
}

beforeEach(() => {
  mockCreate.mockReset();
  mockUserDocRef.mockClear();
  mockLogInfo.mockReset();
  mockLogWarn.mockReset();
  mockLogError.mockReset();
  mockWriteAuditEvent.mockReset();
  mockCreateOrConfirm.mockReset();
  mockWriteAuditEvent.mockResolvedValue({
    eventId: "evt-provisioned-1",
    record: {},
  });
  mockCreateOrConfirm.mockResolvedValue({
    externalIdentityId: "hash-1",
    userId: "uid-abc",
    outcome: "created",
  });
});

describe("authOnUserCreate - preserved provisioning behavior", () => {
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
    // Sprint 23C-I: the identity bridge is NOT invoked on the
    // idempotent-replay path either, preserving the
    // one-transition-per-audit invariant.
    expect(mockCreateOrConfirm).not.toHaveBeenCalled();
  });

  it("happy path emits exactly one auth.userProvisioned audit event with actorRole 'system' and no schoolId", async () => {
    mockCreate.mockResolvedValueOnce(undefined);

    await invokeHandler(makeUser());

    // `auth.userProvisioned` is call #1. The identity-bridge
    // `identity.mappingCreated` is call #2. Both are separate
    // transitions and are asserted to co-exist in the Sprint 23C-I
    // section below.
    expect(mockWriteAuditEvent).toHaveBeenCalled();
    const first = mockWriteAuditEvent.mock.calls[0][0];
    expect(first).toEqual({
      actorUserId: "uid-abc",
      actorRole: "system",
      action: "auth.userProvisioned",
      targetType: "user",
      targetId: "uid-abc",
    });
    expect(Object.prototype.hasOwnProperty.call(first, "schoolId")).toBe(false);
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

describe("authOnUserCreate - Sprint 23C-I identity bridge", () => {
  it("one Google provider - writes the mapping and emits identity.mappingCreated after auth.userProvisioned", async () => {
    mockCreate.mockResolvedValueOnce(undefined);
    mockCreateOrConfirm.mockResolvedValueOnce({
      externalIdentityId: "hash-created",
      userId: "uid-abc",
      outcome: "created",
    });

    await invokeHandler(makeUser());

    expect(mockCreateOrConfirm).toHaveBeenCalledWith({
      providerId: "google.com",
      providerAccountId: "1234567890",
      userId: "uid-abc",
      source: "authOnUserCreate",
    });

    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(2);
    expect(mockWriteAuditEvent.mock.calls[0][0].action).toBe(
      "auth.userProvisioned",
    );
    expect(mockWriteAuditEvent.mock.calls[1][0]).toEqual({
      actorUserId: "uid-abc",
      actorRole: "system",
      action: "identity.mappingCreated",
      targetType: "externalIdentity",
      targetId: "hash-created",
    });
  });

  it("no Google provider - identity bridge is NOT invoked; provisioning proceeds normally", async () => {
    mockCreate.mockResolvedValueOnce(undefined);
    await invokeHandler(
      makeUser({ providerData: [{ providerId: "password" }] } as any),
    );
    expect(mockCreateOrConfirm).not.toHaveBeenCalled();
    // Only `auth.userProvisioned`.
    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent.mock.calls[0][0].action).toBe(
      "auth.userProvisioned",
    );
  });

  it("multiple providers with exactly one google.com - identity bridge uses the single Google entry", async () => {
    mockCreate.mockResolvedValueOnce(undefined);
    mockCreateOrConfirm.mockResolvedValueOnce({
      externalIdentityId: "hash-2",
      userId: "uid-abc",
      outcome: "created",
    });
    await invokeHandler(
      makeUser({
        providerData: [
          { providerId: "google.com", uid: "99" },
          { providerId: "password" },
        ],
      } as any),
    );
    expect(mockCreateOrConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ providerAccountId: "99" }),
    );
  });

  it("malformed Google provider (missing uid) - bridge is NOT invoked; structured warn logged with no PII", async () => {
    mockCreate.mockResolvedValueOnce(undefined);
    await invokeHandler(
      makeUser({
        providerData: [{ providerId: "google.com", uid: "" }],
      } as any),
    );
    expect(mockCreateOrConfirm).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledWith(
      "identity.bridgeSkippedMalformed",
      expect.objectContaining({ uid: "uid-abc" }),
    );
    const payload = JSON.stringify(mockLogWarn.mock.calls[0][1]);
    expect(payload).not.toContain("student@example.com");
    expect(payload).not.toContain("Test Student");
  });

  it("duplicate google.com entries - bridge is NOT invoked; structured warn logged", async () => {
    mockCreate.mockResolvedValueOnce(undefined);
    await invokeHandler(
      makeUser({
        providerData: [
          { providerId: "google.com", uid: "1" },
          { providerId: "google.com", uid: "2" },
        ],
      } as any),
    );
    expect(mockCreateOrConfirm).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledWith(
      "identity.bridgeSkippedMalformed",
      expect.objectContaining({ uid: "uid-abc" }),
    );
  });

  it("collision refusal - emits identity.collisionDetected on the safe path; does NOT re-throw so trigger does not loop", async () => {
    mockCreate.mockResolvedValueOnce(undefined);
    mockCreateOrConfirm.mockRejectedValueOnce(
      new PlatformError("identity.collision", "conflict"),
    );
    await expect(invokeHandler(makeUser())).resolves.toBeUndefined();
    const collisionAudit = mockWriteAuditEvent.mock.calls.find(
      (c) => c[0].action === "identity.collisionDetected",
    );
    expect(collisionAudit).toBeDefined();
    // Collision audit target ID is a structural marker, NOT the raw
    // provider account identifier.
    expect(collisionAudit![0].targetId).not.toBe("1234567890");
    expect(mockLogWarn).toHaveBeenCalledWith(
      "identity.bridgeSkippedCollision",
      expect.objectContaining({ uid: "uid-abc", code: "identity.collision" }),
    );
  });

  it("second-active-for-user refusal - same safe path as collision", async () => {
    mockCreate.mockResolvedValueOnce(undefined);
    mockCreateOrConfirm.mockRejectedValueOnce(
      new PlatformError("identity.secondActiveForUser", "already-linked"),
    );
    await expect(invokeHandler(makeUser())).resolves.toBeUndefined();
    expect(mockLogWarn).toHaveBeenCalledWith(
      "identity.bridgeSkippedCollision",
      expect.objectContaining({
        code: "identity.secondActiveForUser",
      }),
    );
  });

  it("transient store failure is re-thrown so Firebase can retry the trigger", async () => {
    mockCreate.mockResolvedValueOnce(undefined);
    mockCreateOrConfirm.mockRejectedValueOnce(new Error("transient network"));
    await expect(invokeHandler(makeUser())).rejects.toThrow("transient network");
    expect(mockLogError).toHaveBeenCalledWith(
      "identity.bridgeWriteFailed",
      expect.objectContaining({ uid: "uid-abc" }),
    );
  });

  it("does NOT log the raw provider account identifier on any successful path", async () => {
    mockCreate.mockResolvedValueOnce(undefined);
    mockCreateOrConfirm.mockResolvedValueOnce({
      externalIdentityId: "hash-abc",
      userId: "uid-abc",
      outcome: "created",
    });
    await invokeHandler(makeUser());
    const allLogPayloads = JSON.stringify([
      ...mockLogInfo.mock.calls,
      ...mockLogWarn.mock.calls,
      ...mockLogError.mock.calls,
    ]);
    expect(allLogPayloads).not.toContain("1234567890");
  });

  it("restored outcome emits identity.mappingRestored (not created)", async () => {
    mockCreate.mockResolvedValueOnce(undefined);
    mockCreateOrConfirm.mockResolvedValueOnce({
      externalIdentityId: "hash-r",
      userId: "uid-abc",
      outcome: "restored",
    });
    await invokeHandler(makeUser());
    expect(
      mockWriteAuditEvent.mock.calls.find(
        (c) => c[0].action === "identity.mappingRestored",
      ),
    ).toBeDefined();
  });

  it("confirmedNoop outcome emits NO identity audit event (preserves one-audit-per-transition)", async () => {
    mockCreate.mockResolvedValueOnce(undefined);
    mockCreateOrConfirm.mockResolvedValueOnce({
      externalIdentityId: "hash-c",
      userId: "uid-abc",
      outcome: "confirmedNoop",
    });
    await invokeHandler(makeUser());
    const identityAudits = mockWriteAuditEvent.mock.calls.filter((c) =>
      String(c[0].action).startsWith("identity."),
    );
    expect(identityAudits).toHaveLength(0);
  });

  it("does not change user role, status, onboarding, or any users/{uid} field beyond the canonical provisioning payload", async () => {
    mockCreate.mockResolvedValueOnce(undefined);
    mockCreateOrConfirm.mockResolvedValueOnce({
      externalIdentityId: "hash-abc",
      userId: "uid-abc",
      outcome: "created",
    });
    await invokeHandler(makeUser());
    // The only users/{uid} write is the canonical provisioning
    // payload emitted by `buildPayload`. No update/set is performed
    // by the identity bridge branch.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const payload = mockCreate.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(
      ["authUid", "createdAt", "displayName", "email", "status"].sort(),
    );
  });
});
