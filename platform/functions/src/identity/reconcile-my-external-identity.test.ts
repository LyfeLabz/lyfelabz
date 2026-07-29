/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Sprint 23C-I - reconcileMyExternalIdentity callable tests.

import type { CallableRequest } from "firebase-functions/v2/https";

const mockGetUser = jest.fn();
jest.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ getUser: mockGetUser }),
}));

const mockReconcile = jest.fn();
const mockWriteAuditEvent = jest.fn();
const mockLogError = jest.fn();

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    PlatformError,
    platformCallable: (handler: unknown) => handler,
    log: { info: jest.fn(), warn: jest.fn(), error: mockLogError },
    reconcileExternalIdentityForUser: mockReconcile,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import { reconcileMyExternalIdentityHandler } from "./reconcile-my-external-identity";

function makeRequest(
  auth: { uid: string } | null,
  data: unknown = {},
): CallableRequest<unknown> {
  return {
    data,
    auth: auth ? ({ uid: auth.uid, token: {} } as any) : (undefined as any),
    rawRequest: {} as any,
    acceptsStreaming: false,
  } as unknown as CallableRequest<unknown>;
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockReconcile.mockReset();
  mockWriteAuditEvent.mockReset();
  mockLogError.mockReset();
  mockWriteAuditEvent.mockResolvedValue({ eventId: "evt-1", record: {} });
});

describe("reconcileMyExternalIdentity", () => {
  it("rejects an unauthenticated caller with identity.unauthenticated", async () => {
    await expect(
      reconcileMyExternalIdentityHandler(makeRequest(null)),
    ).rejects.toMatchObject({ code: "identity.unauthenticated" });
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("re-reads the Auth record through Admin SDK and passes derived providers to the store", async () => {
    mockGetUser.mockResolvedValueOnce({
      uid: "uid-1",
      providerData: [{ providerId: "google.com", uid: "9999" }],
    });
    mockReconcile.mockResolvedValueOnce({
      perProvider: [
        {
          providerId: "google.com",
          externalIdentityId: "hash-1",
          linkOutcome: "created",
        },
      ],
    });
    await reconcileMyExternalIdentityHandler(
      makeRequest({ uid: "uid-1" }, { providerAccountId: "9999" }),
    );
    expect(mockGetUser).toHaveBeenCalledWith("uid-1");
    expect(mockReconcile).toHaveBeenCalledWith({
      userId: "uid-1",
      source: "authReconciliation",
      observedProviders: [{ providerId: "google.com", providerAccountId: "9999" }],
    });
  });

  it("does NOT trust the client-supplied provider identifier", async () => {
    mockGetUser.mockResolvedValueOnce({
      uid: "uid-1",
      providerData: [{ providerId: "google.com", uid: "SERVER_TRUTH" }],
    });
    mockReconcile.mockResolvedValueOnce({ perProvider: [] });
    await reconcileMyExternalIdentityHandler(
      makeRequest(
        { uid: "uid-1" },
        { providerId: "google.com", providerAccountId: "CLIENT_LIE" },
      ),
    );
    const call = mockReconcile.mock.calls[0][0];
    expect(call.observedProviders).toEqual([
      { providerId: "google.com", providerAccountId: "SERVER_TRUTH" },
    ]);
    expect(JSON.stringify(call)).not.toContain("CLIENT_LIE");
  });

  it("emits identity.mappingCreated on the created path (and no other audit events for that provider)", async () => {
    mockGetUser.mockResolvedValueOnce({
      uid: "uid-1",
      providerData: [{ providerId: "google.com", uid: "42" }],
    });
    mockReconcile.mockResolvedValueOnce({
      perProvider: [
        {
          providerId: "google.com",
          externalIdentityId: "hash-created",
          linkOutcome: "created",
        },
      ],
    });
    await reconcileMyExternalIdentityHandler(makeRequest({ uid: "uid-1" }));
    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith({
      actorUserId: "uid-1",
      actorRole: "system",
      action: "identity.mappingCreated",
      targetType: "externalIdentity",
      targetId: "hash-created",
    });
  });

  it("emits identity.mappingRestored on the restored path", async () => {
    mockGetUser.mockResolvedValueOnce({
      uid: "uid-1",
      providerData: [{ providerId: "google.com", uid: "42" }],
    });
    mockReconcile.mockResolvedValueOnce({
      perProvider: [
        {
          providerId: "google.com",
          externalIdentityId: "hash-x",
          linkOutcome: "restored",
        },
      ],
    });
    await reconcileMyExternalIdentityHandler(makeRequest({ uid: "uid-1" }));
    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "identity.mappingRestored" }),
    );
  });

  it("emits identity.mappingConfirmed on the already-active path", async () => {
    mockGetUser.mockResolvedValueOnce({
      uid: "uid-1",
      providerData: [{ providerId: "google.com", uid: "42" }],
    });
    mockReconcile.mockResolvedValueOnce({
      perProvider: [
        {
          providerId: "google.com",
          externalIdentityId: "hash-x",
          linkOutcome: "confirmedNoop",
        },
      ],
    });
    await reconcileMyExternalIdentityHandler(makeRequest({ uid: "uid-1" }));
    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "identity.mappingConfirmed" }),
    );
  });

  it("emits identity.mappingRevoked when a previously-active mapping is revoked", async () => {
    mockGetUser.mockResolvedValueOnce({
      uid: "uid-1",
      providerData: [],
    });
    mockReconcile.mockResolvedValueOnce({
      perProvider: [
        {
          providerId: "google.com",
          externalIdentityId: "hash-x",
          revokeOutcome: "revoked",
        },
      ],
    });
    await reconcileMyExternalIdentityHandler(makeRequest({ uid: "uid-1" }));
    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "identity.mappingRevoked" }),
    );
  });

  it("emits no audit event for absent/alreadyRevoked no-op transitions", async () => {
    mockGetUser.mockResolvedValueOnce({
      uid: "uid-1",
      providerData: [],
    });
    mockReconcile.mockResolvedValueOnce({
      perProvider: [
        {
          providerId: "google.com",
          externalIdentityId: "hash-x",
          revokeOutcome: "absent",
        },
      ],
    });
    await reconcileMyExternalIdentityHandler(makeRequest({ uid: "uid-1" }));
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("returns the projection with no raw provider identifier and no profile metadata", async () => {
    mockGetUser.mockResolvedValueOnce({
      uid: "uid-1",
      email: "student@example.invalid",
      displayName: "Student",
      providerData: [{ providerId: "google.com", uid: "SECRET-42" }],
    });
    mockReconcile.mockResolvedValueOnce({
      perProvider: [
        {
          providerId: "google.com",
          externalIdentityId: "hash-1",
          linkOutcome: "created",
        },
      ],
    });
    const response = await reconcileMyExternalIdentityHandler(
      makeRequest({ uid: "uid-1" }),
    );
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain("SECRET-42");
    expect(serialized).not.toContain("student@example.invalid");
    expect(serialized).not.toContain("Student");
    expect(response.perProvider[0]).toEqual({
      providerId: "google.com",
      externalIdentityId: "hash-1",
      link: "created",
    });
  });

  it("wraps Auth read failures as identity.authReadFailed and logs a safe structural failure", async () => {
    mockGetUser.mockRejectedValueOnce(new Error("boom"));
    await expect(
      reconcileMyExternalIdentityHandler(makeRequest({ uid: "uid-1" })),
    ).rejects.toBeInstanceOf(PlatformError);
    expect(mockLogError).toHaveBeenCalledWith(
      "identity.reconcileAuthReadFailed",
      expect.objectContaining({ uid: "uid-1" }),
    );
    const errPayload = mockLogError.mock.calls[0][1];
    expect(JSON.stringify(errPayload)).not.toMatch(/@example|SECRET|provider/);
  });

  it("rejects a duplicate google.com provider on the Auth record as identity.invalidRequest", async () => {
    mockGetUser.mockResolvedValueOnce({
      uid: "uid-1",
      providerData: [
        { providerId: "google.com", uid: "42" },
        { providerId: "google.com", uid: "43" },
      ],
    });
    await expect(
      reconcileMyExternalIdentityHandler(makeRequest({ uid: "uid-1" })),
    ).rejects.toMatchObject({ code: "identity.invalidRequest" });
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("rejects a malformed provider entry (missing uid) as identity.malformedProviderRecord", async () => {
    mockGetUser.mockResolvedValueOnce({
      uid: "uid-1",
      providerData: [{ providerId: "google.com", uid: "" }],
    });
    await expect(
      reconcileMyExternalIdentityHandler(makeRequest({ uid: "uid-1" })),
    ).rejects.toMatchObject({ code: "identity.malformedProviderRecord" });
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("passes an empty observed list when the Auth record has no google.com provider", async () => {
    mockGetUser.mockResolvedValueOnce({
      uid: "uid-1",
      providerData: [{ providerId: "password" }],
    });
    mockReconcile.mockResolvedValueOnce({ perProvider: [] });
    await reconcileMyExternalIdentityHandler(makeRequest({ uid: "uid-1" }));
    expect(mockReconcile).toHaveBeenCalledWith(
      expect.objectContaining({ observedProviders: [] }),
    );
  });
});
