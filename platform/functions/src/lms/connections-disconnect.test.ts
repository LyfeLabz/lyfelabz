// connections-disconnect.test.ts
//
// Unit tests for lmsConnectionsDisconnect callable handler.
// Mocks: Firestore, audit log, structured log, token store, provider
// adapter, OAuth state store, and config bindings. The handler logic
// is exercised directly via __lmsConnectionsDisconnectHandler.

import type { CallableRequest } from "firebase-functions/v2/https";

// -------------------- Mocks --------------------

const mockConnectionGet = jest.fn();
const mockConnectionUpdate = jest.fn();
const mockConnectionDocRef = jest.fn(() => ({
  get: mockConnectionGet,
  update: mockConnectionUpdate,
}));
const mockRevocationDocRef = jest.fn(() => ({
  update: mockConnectionUpdate,
}));

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();
const mockWriteAuditEvent = jest.fn();

const mockTokenStore = {
  resolve: jest.fn(),
  revoke: jest.fn(),
  store: jest.fn(),
};

const mockRevokeGrant = jest.fn();
const mockGetProviderAdapter = jest.fn(() => ({
  revokeGrant: mockRevokeGrant,
}));

const mockOAuthStateStore = {
  revokeForTeacher: jest.fn(),
};

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__ts__" },
}));

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(handler: T) => handler,
}));

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    platformCallable: (_opts: unknown, handler: unknown) => handler,
    PlatformError,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    lmsConnectionDocRef: mockConnectionDocRef,
    lmsConnectionRevocationDocRef: mockRevocationDocRef,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

jest.mock("./tokens/token-store", () => ({
  getLmsTokenStore: () => mockTokenStore,
}));

jest.mock("./providers/registry", () => ({
  getProviderAdapter: mockGetProviderAdapter,
}));

jest.mock("./oauth-state/state-store", () => ({
  getLmsOAuthStateStore: () => mockOAuthStateStore,
}));

jest.mock("./providers/google-classroom/config-firebase", () => ({
  ensureGoogleClassroomProductionBindings: () => undefined,
  googleClassroomProductionSecrets: [],
}));

jest.mock("./shared/actor", () => ({
  assertAuthenticatedTeacherForLms: (req: CallableRequest<unknown>) => {
    const auth = req.auth as never as { uid: string; token: { schoolId?: string } };
    return {
      uid: auth.uid,
      schoolId: auth.token?.schoolId ?? "school-disconnect-test",
      districtId: undefined,
    };
  },
  requireNonEmptyString: (
    value: unknown,
    code: string,
    message: string,
  ): string => {
    if (typeof value !== "string" || value.length === 0) {
      const { PlatformError } = jest.requireActual(
        "../shared/errors/platform-error",
      );
      throw new PlatformError(code, message);
    }
    return value;
  },
}));

import { __lmsConnectionsDisconnectHandler } from "./connections-disconnect";

// -------------------- Helpers --------------------

const TEACHER_UID = "teacher-disconnect-test";
const CONNECTION_ID = "conn-disconnect-1";
const PROVIDER_ID = "googleClassroom";
const TOKEN_REF = "tokref-disconnect-1";

function makeRequest(
  data: unknown,
  uid = TEACHER_UID,
): CallableRequest<unknown> {
  return {
    data,
    auth: {
      uid,
      token: { role: "teacher", schoolId: "school-disconnect-test" },
    } as never,
    rawRequest: {} as never,
  };
}

function makeConnectionDoc(overrides: Partial<{
  teacherId: string;
  status: string;
  providerId: string;
  tokenRef: string;
}> = {}) {
  return {
    teacherId: TEACHER_UID,
    status: "active",
    providerId: PROVIDER_ID,
    tokenRef: TOKEN_REF,
    ...overrides,
  };
}

function mockExistingConnection(
  doc: ReturnType<typeof makeConnectionDoc> | null,
) {
  mockConnectionGet.mockResolvedValueOnce(
    doc === null
      ? { exists: false, data: () => undefined }
      : { exists: true, data: () => doc },
  );
}

// -------------------- Tests --------------------

describe("lmsConnectionsDisconnect", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTokenStore.resolve.mockResolvedValue({
      accessToken: "access-token-fixture",
      refreshToken: "refresh-token-fixture",
    });
    mockTokenStore.revoke.mockResolvedValue(undefined);
    mockRevokeGrant.mockResolvedValue(undefined);
    mockOAuthStateStore.revokeForTeacher.mockResolvedValue(undefined);
    mockConnectionUpdate.mockResolvedValue(undefined);
    mockWriteAuditEvent.mockResolvedValue(undefined);
  });

  // ---- Authorization ----

  test("owner-authorized disconnect succeeds and returns connectionId", async () => {
    mockExistingConnection(makeConnectionDoc());
    const result = await __lmsConnectionsDisconnectHandler(
      makeRequest({ connectionId: CONNECTION_ID }),
    );
    expect(result.connectionId).toBe(CONNECTION_ID);
    expect(result.alreadyRevoked).toBe(false);
  });

  test("cross-owner disconnect is refused with lms.forbidden", async () => {
    mockExistingConnection(makeConnectionDoc({ teacherId: "other-teacher" }));
    await expect(
      __lmsConnectionsDisconnectHandler(
        makeRequest({ connectionId: CONNECTION_ID }),
      ),
    ).rejects.toMatchObject({ code: "lms.forbidden" });
  });

  test("missing connection rejects with lms.connectionNotFound", async () => {
    mockExistingConnection(null);
    await expect(
      __lmsConnectionsDisconnectHandler(
        makeRequest({ connectionId: CONNECTION_ID }),
      ),
    ).rejects.toMatchObject({
      code: "lms.connectionNotFound",
    });
  });

  // ---- Idempotency ----

  test("already-revoked connection returns alreadyRevoked:true without further writes", async () => {
    mockExistingConnection(makeConnectionDoc({ status: "revoked" }));
    const result = await __lmsConnectionsDisconnectHandler(
      makeRequest({ connectionId: CONNECTION_ID }),
    );
    expect(result.alreadyRevoked).toBe(true);
    expect(mockConnectionUpdate).not.toHaveBeenCalled();
    expect(mockTokenStore.revoke).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  // ---- Normal success path ----

  test("local token bundle is deleted on normal success", async () => {
    mockExistingConnection(makeConnectionDoc());
    await __lmsConnectionsDisconnectHandler(
      makeRequest({ connectionId: CONNECTION_ID }),
    );
    expect(mockTokenStore.revoke).toHaveBeenCalledWith(TOKEN_REF);
  });

  test("audit event is written on normal success", async () => {
    mockExistingConnection(makeConnectionDoc());
    await __lmsConnectionsDisconnectHandler(
      makeRequest({ connectionId: CONNECTION_ID }),
    );
    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "lms.connectionRevoked",
        targetId: CONNECTION_ID,
      }),
    );
  });

  test("connection is marked revoked on normal success", async () => {
    mockExistingConnection(makeConnectionDoc());
    await __lmsConnectionsDisconnectHandler(
      makeRequest({ connectionId: CONNECTION_ID }),
    );
    expect(mockConnectionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "revoked" }),
    );
  });

  test("no instructional class or link data is deleted by disconnect", async () => {
    mockExistingConnection(makeConnectionDoc());
    await __lmsConnectionsDisconnectHandler(
      makeRequest({ connectionId: CONNECTION_ID }),
    );
    // Only the connection doc (revocation) and the token store are touched.
    // No class or link collection references appear in the calls.
    const allCallArgs = [
      ...mockConnectionDocRef.mock.calls,
      ...mockRevocationDocRef.mock.calls,
    ]
      .flat()
      .map(String);
    for (const arg of allCallArgs) {
      expect(arg).not.toContain("lmsClassLinks");
      expect(arg).not.toContain("lmsClasses");
    }
  });

  // ---- Backend hardening: upstream revocation failure ----

  test("local token bundle is STILL deleted when upstream Google revocation fails", async () => {
    mockExistingConnection(makeConnectionDoc());
    mockRevokeGrant.mockRejectedValueOnce(new Error("upstream 503"));
    await __lmsConnectionsDisconnectHandler(
      makeRequest({ connectionId: CONNECTION_ID }),
    );
    // Local revocation must still happen.
    expect(mockTokenStore.revoke).toHaveBeenCalledWith(TOKEN_REF);
  });

  test("connection reaches revoked state when upstream revocation fails", async () => {
    mockExistingConnection(makeConnectionDoc());
    mockRevokeGrant.mockRejectedValueOnce(new Error("upstream 503"));
    const result = await __lmsConnectionsDisconnectHandler(
      makeRequest({ connectionId: CONNECTION_ID }),
    );
    expect(result.alreadyRevoked).toBe(false);
    expect(mockConnectionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "revoked" }),
    );
  });

  test("upstream revocation failure is logged as a warning, not an error thrown to the caller", async () => {
    mockExistingConnection(makeConnectionDoc());
    mockRevokeGrant.mockRejectedValueOnce(new Error("upstream 503"));
    await expect(
      __lmsConnectionsDisconnectHandler(
        makeRequest({ connectionId: CONNECTION_ID }),
      ),
    ).resolves.toBeDefined();
    expect(mockLogWarn).toHaveBeenCalledWith(
      "lms.upstreamRevocationFailed",
      expect.objectContaining({ connectionId: CONNECTION_ID }),
    );
  });

  // ---- Local token-store failure: fails closed ----

  test("local token-store failure: callable rejects - does not succeed", async () => {
    mockExistingConnection(makeConnectionDoc());
    mockTokenStore.revoke.mockRejectedValueOnce(new Error("token store unavailable"));
    await expect(
      __lmsConnectionsDisconnectHandler(
        makeRequest({ connectionId: CONNECTION_ID }),
      ),
    ).rejects.toBeDefined();
  });

  test("local token-store failure: connection is NOT marked revoked", async () => {
    mockExistingConnection(makeConnectionDoc());
    mockTokenStore.revoke.mockRejectedValueOnce(new Error("token store unavailable"));
    await expect(
      __lmsConnectionsDisconnectHandler(
        makeRequest({ connectionId: CONNECTION_ID }),
      ),
    ).rejects.toBeDefined();
    expect(mockConnectionUpdate).not.toHaveBeenCalled();
  });

  test("local token-store failure: success audit event is NOT emitted", async () => {
    mockExistingConnection(makeConnectionDoc());
    mockTokenStore.revoke.mockRejectedValueOnce(new Error("token store unavailable"));
    await expect(
      __lmsConnectionsDisconnectHandler(
        makeRequest({ connectionId: CONNECTION_ID }),
      ),
    ).rejects.toBeDefined();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  test("local token-store failure: error is retryable (does not record alreadyRevoked)", async () => {
    // After the failed attempt the connection status is still "active" so
    // a retry call will find an active connection and attempt disconnect again.
    mockExistingConnection(makeConnectionDoc());
    mockTokenStore.revoke.mockRejectedValueOnce(new Error("token store unavailable"));
    await expect(
      __lmsConnectionsDisconnectHandler(
        makeRequest({ connectionId: CONNECTION_ID }),
      ),
    ).rejects.toBeDefined();
    // The connection is still active - a subsequent call is not idempotent-early-returned.
    expect(mockConnectionUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "revoked" }),
    );
  });

  // ---- Sensitive logging ----

  test("no sensitive credential material appears in any log call", async () => {
    mockExistingConnection(makeConnectionDoc());
    await __lmsConnectionsDisconnectHandler(
      makeRequest({ connectionId: CONNECTION_ID }),
    );
    const allLogArgs = [
      ...mockLogInfo.mock.calls,
      ...mockLogWarn.mock.calls,
      ...mockLogError.mock.calls,
    ]
      .flat()
      .map((a) => JSON.stringify(a));
    const sensitiveTerms = [
      "access-token-fixture",
      "refresh-token-fixture",
      "accessToken",
      "refreshToken",
    ];
    for (const term of sensitiveTerms) {
      for (const arg of allLogArgs) {
        expect(arg).not.toContain(term);
      }
    }
  });
});
