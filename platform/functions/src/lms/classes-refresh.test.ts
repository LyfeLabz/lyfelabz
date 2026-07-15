import type { CallableRequest } from "firebase-functions/v2/https";

// Sprint 8E ("LMS Refresh and Reconciliation") coverage for the
// lmsClassesRefresh callable. The test suite exercises every health
// state named in LMS_INTEGRATION_ARCHITECTURE.md Amendment §6 plus the
// cross-teacher-protection invariant carried over from PDR-019b.

const mockLinkGet = jest.fn();
const mockLinkBreakUpdate = jest.fn();
const mockLinkBreakDocRef = jest.fn(() => ({ update: mockLinkBreakUpdate }));
const mockLinkDocRef = jest.fn(() => ({ get: mockLinkGet }));

const mockConnectionGet = jest.fn();
const mockConnectionUpdate = jest.fn();
const mockConnectionDocRef = jest.fn(() => ({ get: mockConnectionGet }));
const mockConnectionRevocationDocRef = jest.fn(() => ({
  update: mockConnectionUpdate,
}));

const mockWriteAuditEvent = jest.fn();

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

const mockTokenResolve = jest.fn();
const mockGetAdapter = jest.fn();

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => "__ts__",
    delete: () => "__delete__",
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
    lmsClassLinkDocRef: mockLinkDocRef,
    lmsClassLinkBreakDocRef: mockLinkBreakDocRef,
    lmsConnectionDocRef: mockConnectionDocRef,
    lmsConnectionRevocationDocRef: mockConnectionRevocationDocRef,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

jest.mock("./tokens/token-store", () => ({
  getLmsTokenStore: () => ({ resolve: mockTokenResolve }),
}));

jest.mock("./providers/registry", () => ({
  getProviderAdapter: () => mockGetAdapter(),
}));

import { __lmsClassesRefreshHandler } from "./classes-refresh";

const LINK_ID = "class-1__googleclassroom__deadbeef";
const CLASS_ID = "class-1";
const LMS_CLASS_ID = "lms-class-1";
const CONNECTION_ID = "googleclassroom__teacher-uid";
const UPSTREAM_ACCOUNT = "teacher@example.edu";

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
    overrides.data === undefined ? { linkId: LINK_ID } : overrides.data;
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

function linkSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      classId: CLASS_ID,
      ownerUid: "teacher-uid",
      schoolId: "school-a",
      providerId: "googleClassroom",
      lmsClassId: LMS_CLASS_ID,
      connectionId: CONNECTION_ID,
      status: "linked",
      linkedAt: {} as never,
      ...overrides,
    }),
  };
}

function connectionSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      teacherId: "teacher-uid",
      schoolId: "school-a",
      providerId: "googleClassroom",
      status: "active",
      scopes: [],
      tokenRef: "tokref-1",
      connectedAt: {} as never,
      ...overrides,
    }),
  };
}

function tokenBundle(
  overrides: Partial<{ upstreamAccountIdentifier: string }> = {},
) {
  return {
    providerId: "googleClassroom",
    teacherId: "teacher-uid",
    accessToken: "at",
    scopes: [],
    upstreamAccountIdentifier:
      overrides.upstreamAccountIdentifier ?? UPSTREAM_ACCOUNT,
  };
}

function makeAdapter(
  fetchImpl: (input: unknown) => Promise<unknown> | never,
): unknown {
  return { fetchClass: fetchImpl };
}

function makeError(code: string): Error {
  const err = new Error(code);
  (err as { code?: string }).code = code;
  return err;
}

describe("lmsClassesRefresh", () => {
  beforeEach(() => {
    // Reset accumulated calls and implementations from prior tests
    // while restoring the docRef factories to their default shapes so
    // handler code path continues to receive `{ get }` and `{ update }`.
    [
      mockLinkGet,
      mockLinkBreakUpdate,
      mockConnectionGet,
      mockConnectionUpdate,
      mockWriteAuditEvent,
      mockLogInfo,
      mockLogWarn,
      mockLogError,
      mockTokenResolve,
      mockGetAdapter,
    ].forEach((m) => m.mockReset());
    mockLinkDocRef.mockReset();
    mockLinkDocRef.mockImplementation(() => ({ get: mockLinkGet }));
    mockLinkBreakDocRef.mockReset();
    mockLinkBreakDocRef.mockImplementation(() => ({
      update: mockLinkBreakUpdate,
    }));
    mockConnectionDocRef.mockReset();
    mockConnectionDocRef.mockImplementation(() => ({ get: mockConnectionGet }));
    mockConnectionRevocationDocRef.mockReset();
    mockConnectionRevocationDocRef.mockImplementation(() => ({
      update: mockConnectionUpdate,
    }));
  });

  it("returns healthy for a matched upstream fetch and emits no audit event", async () => {
    mockLinkGet.mockResolvedValueOnce(linkSnapshot());
    mockConnectionGet.mockResolvedValueOnce(connectionSnapshot());
    mockTokenResolve.mockResolvedValueOnce(tokenBundle());
    mockGetAdapter.mockReturnValueOnce(
      makeAdapter(() =>
        Promise.resolve({
          lmsClassId: LMS_CLASS_ID,
          name: "Period 1",
          ownerUpstreamAccountIdentifier: UPSTREAM_ACCOUNT,
        }),
      ),
    );

    const result = await __lmsClassesRefreshHandler(makeRequest());

    expect(result.status).toBe("healthy");
    expect(result.changed).toBe(false);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    expect(mockLinkBreakUpdate).not.toHaveBeenCalled();
    expect(mockConnectionUpdate).not.toHaveBeenCalled();
  });

  it("returns ownershipDrift, marks the link broken, and audits lms.ownershipDrift when the upstream owner changed", async () => {
    mockLinkGet.mockResolvedValueOnce(linkSnapshot());
    mockConnectionGet.mockResolvedValueOnce(connectionSnapshot());
    mockTokenResolve.mockResolvedValueOnce(tokenBundle());
    mockGetAdapter.mockReturnValueOnce(
      makeAdapter(() =>
        Promise.resolve({
          lmsClassId: LMS_CLASS_ID,
          name: "Period 1",
          ownerUpstreamAccountIdentifier: "someone-else@example.edu",
        }),
      ),
    );
    mockLinkBreakUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "e1", record: {} });

    const result = await __lmsClassesRefreshHandler(makeRequest());

    expect(result.status).toBe("ownershipDrift");
    expect(result.changed).toBe(true);
    expect(mockLinkBreakUpdate).toHaveBeenCalledWith({
      status: "broken",
      unlinkedAt: "__ts__",
    });
    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "lms.ownershipDrift",
        targetType: "class",
        targetId: CLASS_ID,
      }),
    );
  });

  it("returns revoked and revokes the connection when the adapter reports access revoked", async () => {
    mockLinkGet.mockResolvedValueOnce(linkSnapshot());
    mockConnectionGet.mockResolvedValueOnce(connectionSnapshot());
    mockTokenResolve.mockResolvedValueOnce(tokenBundle());
    mockGetAdapter.mockReturnValueOnce(
      makeAdapter(() =>
        Promise.reject(makeError("lms.upstream.accessRevoked")),
      ),
    );
    mockConnectionUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "e2", record: {} });

    const result = await __lmsClassesRefreshHandler(makeRequest());

    expect(result.status).toBe("revoked");
    expect(result.changed).toBe(true);
    expect(mockConnectionUpdate).toHaveBeenCalledWith({
      status: "revoked",
      revokedAt: "__ts__",
    });
    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "lms.connectionRevoked",
        targetType: "lmsConnection",
      }),
    );
  });

  it("returns missingUpstream and marks the link broken when the upstream class is deleted", async () => {
    mockLinkGet.mockResolvedValueOnce(linkSnapshot());
    mockConnectionGet.mockResolvedValueOnce(connectionSnapshot());
    mockTokenResolve.mockResolvedValueOnce(tokenBundle());
    mockGetAdapter.mockReturnValueOnce(
      makeAdapter(() =>
        Promise.reject(makeError("lms.upstream.classMissing")),
      ),
    );
    mockLinkBreakUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "e3", record: {} });

    const result = await __lmsClassesRefreshHandler(makeRequest());

    expect(result.status).toBe("missingUpstream");
    expect(result.changed).toBe(true);
    expect(mockLinkBreakUpdate).toHaveBeenCalledWith({
      status: "broken",
      unlinkedAt: "__ts__",
    });
    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "lms.classUnlinked",
        payload: expect.objectContaining({ reason: "missingUpstream" }),
      }),
    );
  });

  it("returns disconnected without a state change when the mirror connection is already revoked", async () => {
    mockLinkGet.mockResolvedValueOnce(linkSnapshot());
    mockConnectionGet.mockResolvedValueOnce(
      connectionSnapshot({ status: "revoked" }),
    );

    const result = await __lmsClassesRefreshHandler(makeRequest());

    expect(result.status).toBe("disconnected");
    expect(result.changed).toBe(false);
    expect(mockTokenResolve).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("returns reconnectRequired when the connection is stale", async () => {
    mockLinkGet.mockResolvedValueOnce(linkSnapshot());
    mockConnectionGet.mockResolvedValueOnce(
      connectionSnapshot({ status: "stale" }),
    );

    const result = await __lmsClassesRefreshHandler(makeRequest());

    expect(result.status).toBe("reconnectRequired");
    expect(result.changed).toBe(false);
    expect(mockTokenResolve).not.toHaveBeenCalled();
  });

  it("returns reconnectRequired when the token bundle can no longer be resolved", async () => {
    mockLinkGet.mockResolvedValueOnce(linkSnapshot());
    mockConnectionGet.mockResolvedValueOnce(connectionSnapshot());
    mockTokenResolve.mockRejectedValueOnce(makeError("lms.tokenNotFound"));

    const result = await __lmsClassesRefreshHandler(makeRequest());

    expect(result.status).toBe("reconnectRequired");
    expect(result.changed).toBe(false);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("returns providerUnavailable when the adapter reports temporary upstream trouble", async () => {
    mockLinkGet.mockResolvedValueOnce(linkSnapshot());
    mockConnectionGet.mockResolvedValueOnce(connectionSnapshot());
    mockTokenResolve.mockResolvedValueOnce(tokenBundle());
    mockGetAdapter.mockReturnValueOnce(
      makeAdapter(() =>
        Promise.reject(makeError("lms.upstream.unavailable")),
      ),
    );

    const result = await __lmsClassesRefreshHandler(makeRequest());

    expect(result.status).toBe("providerUnavailable");
    expect(result.changed).toBe(false);
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("treats the scaffolded provider error as providerUnavailable so the placeholder adapter is safe", async () => {
    mockLinkGet.mockResolvedValueOnce(linkSnapshot());
    mockConnectionGet.mockResolvedValueOnce(connectionSnapshot());
    mockTokenResolve.mockResolvedValueOnce(tokenBundle());
    mockGetAdapter.mockReturnValueOnce(
      makeAdapter(() =>
        Promise.reject(makeError("lms.providerNotYetOperational")),
      ),
    );

    const result = await __lmsClassesRefreshHandler(makeRequest());

    expect(result.status).toBe("providerUnavailable");
  });

  it("refuses cross-teacher refresh with lms.forbidden", async () => {
    mockLinkGet.mockResolvedValueOnce(
      linkSnapshot({ ownerUid: "other-teacher" }),
    );
    await expect(
      __lmsClassesRefreshHandler(makeRequest()),
    ).rejects.toMatchObject({ code: "lms.forbidden" });
    expect(mockTokenResolve).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it("is idempotent for a link already marked broken", async () => {
    mockLinkGet.mockResolvedValueOnce(linkSnapshot({ status: "broken" }));

    const result = await __lmsClassesRefreshHandler(makeRequest());

    expect(result.status).toBe("missingUpstream");
    expect(result.changed).toBe(false);
    expect(mockConnectionGet).not.toHaveBeenCalled();
    expect(mockLinkBreakUpdate).not.toHaveBeenCalled();
  });

  it("returns reconnectRequired if the underlying connection document is missing", async () => {
    mockLinkGet.mockResolvedValueOnce(linkSnapshot());
    mockConnectionGet.mockResolvedValueOnce({ exists: false });

    const result = await __lmsClassesRefreshHandler(makeRequest());

    expect(result.status).toBe("reconnectRequired");
    expect(result.changed).toBe(false);
  });

  it("supports a subsequent healthy refresh after reconciliation was applied and a fresh link exists", async () => {
    // First refresh reports missingUpstream and breaks the link.
    mockLinkGet.mockResolvedValueOnce(linkSnapshot());
    mockConnectionGet.mockResolvedValueOnce(connectionSnapshot());
    mockTokenResolve.mockResolvedValueOnce(tokenBundle());
    mockGetAdapter.mockReturnValueOnce(
      makeAdapter(() =>
        Promise.reject(makeError("lms.upstream.classMissing")),
      ),
    );
    mockLinkBreakUpdate.mockResolvedValueOnce(undefined);
    mockWriteAuditEvent.mockResolvedValueOnce({ eventId: "e4", record: {} });

    const first = await __lmsClassesRefreshHandler(makeRequest());
    expect(first.status).toBe("missingUpstream");

    // A subsequent refresh on the same broken link surfaces the same
    // state without re-writing.
    mockLinkGet.mockResolvedValueOnce(linkSnapshot({ status: "broken" }));
    const second = await __lmsClassesRefreshHandler(makeRequest());
    expect(second.status).toBe("missingUpstream");
    expect(second.changed).toBe(false);
    expect(mockLinkBreakUpdate).toHaveBeenCalledTimes(1);
  });
});
