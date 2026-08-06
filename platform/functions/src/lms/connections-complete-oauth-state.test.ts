import type { CallableRequest } from "firebase-functions/v2/https";

// Sprint 23B security completion: coverage for the server-side OAuth
// state pre-check inside lmsConnectionsComplete. The callable rejects
// missing / mismatched / expired / consumed / cross-teacher state
// with a single uniform public code (`lms.invalidOAuthState`).
//
// The suite mocks Firestore, the token store, the provider registry,
// and the Google-Classroom production installer so it exercises only
// the callable's own logic. Fixture data is fictional.

const mockConnectionGet = jest.fn();
const mockConnectionSet = jest.fn();
const mockConnectionUpdate = jest.fn();
const mockConnectionDocRef = jest.fn(() => ({
  get: mockConnectionGet,
  update: mockConnectionUpdate,
}));
const mockConnectionCreationDocRef = jest.fn(() => ({
  set: mockConnectionSet,
}));

const mockWriteAuditEvent = jest.fn();
const mockLogInfo = jest.fn();

const mockTokenStore = {
  store: jest.fn(() => Promise.resolve("tokref-1")),
  resolve: jest.fn(),
  revoke: jest.fn(() => Promise.resolve()),
};
const mockCompleteOAuth = jest.fn();
// Google grant revocation must NEVER run during a successful scope
// widening (PDR-030d, blueprint §7). The adapter mock exposes revokeGrant
// so the regression tests can assert it is not invoked.
const mockAdapterRevokeGrant = jest.fn(() => Promise.resolve());
const mockGetAdapter = jest.fn(() => ({
  completeOAuth: mockCompleteOAuth,
  revokeGrant: mockAdapterRevokeGrant,
}));
const mockEnsureBindings = jest.fn();

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
    log: { info: mockLogInfo, warn: jest.fn(), error: jest.fn() },
    lmsConnectionDocRef: mockConnectionDocRef,
    lmsConnectionCreationDocRef: mockConnectionCreationDocRef,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

jest.mock("./tokens/token-store", () => ({
  getLmsTokenStore: () => mockTokenStore,
}));

jest.mock("./providers/registry", () => ({
  isRegisteredProvider: (id: string) => id === "googleClassroom",
  getProviderAdapter: () => mockGetAdapter(),
}));

jest.mock("./providers/google-classroom/config-firebase", () => ({
  ensureGoogleClassroomProductionBindings: () => mockEnsureBindings(),
  googleClassroomProductionSecrets: [],
}));

import type { PlatformError } from "../shared";

import { __lmsConnectionsCompleteHandler } from "./connections-complete";
import {
  getLmsOAuthStateStore,
  resetLmsOAuthStateStoreForTests,
} from "./oauth-state/state-store";

const TEACHER_UID = "fixture-teacher-uid";
const OTHER_TEACHER_UID = "fixture-teacher-uid-other";
const REDIRECT = "https://fixture.example.invalid/lms-callback";
const PROVIDER = "googleClassroom";

function makeRequest(data: unknown, uid = TEACHER_UID): CallableRequest<unknown> {
  return {
    data,
    auth: {
      uid,
      token: { role: "teacher", schoolId: "school-fixture" },
    } as never,
    rawRequest: {} as never,
  };
}

async function issueFixtureState(
  bind: {
    teacherId?: string;
    providerId?: string;
    redirectUri?: string;
  } = {},
): Promise<string> {
  const { state } = await getLmsOAuthStateStore().issue({
    teacherId: bind.teacherId ?? TEACHER_UID,
    providerId: (bind.providerId ?? PROVIDER) as never,
    redirectUri: bind.redirectUri ?? REDIRECT,
  });
  return state;
}

describe("lmsConnectionsComplete - server-side OAuth state pre-check", () => {
  beforeEach(() => {
    [
      mockConnectionGet,
      mockConnectionSet,
      mockConnectionUpdate,
      mockWriteAuditEvent,
      mockLogInfo,
      mockCompleteOAuth,
      mockGetAdapter,
      mockAdapterRevokeGrant,
      mockEnsureBindings,
      mockTokenStore.store,
      mockTokenStore.resolve,
      mockTokenStore.revoke,
    ].forEach((m) => m.mockReset());
    mockAdapterRevokeGrant.mockResolvedValue(undefined);
    mockConnectionDocRef.mockReset();
    mockConnectionDocRef.mockImplementation(() => ({
      get: mockConnectionGet,
      update: mockConnectionUpdate,
    }));
    mockConnectionCreationDocRef.mockReset();
    mockConnectionCreationDocRef.mockImplementation(() => ({
      set: mockConnectionSet,
    }));
    mockGetAdapter.mockImplementation(() => ({
      completeOAuth: mockCompleteOAuth,
      revokeGrant: mockAdapterRevokeGrant,
    }));
    mockConnectionGet.mockResolvedValue({ exists: false });
    mockConnectionSet.mockResolvedValue(undefined);
    mockConnectionUpdate.mockResolvedValue(undefined);
    mockWriteAuditEvent.mockResolvedValue(undefined);
    mockTokenStore.store.mockResolvedValue("tokref-1");
    mockTokenStore.resolve.mockResolvedValue({
      providerId: "googleClassroom",
      teacherId: TEACHER_UID,
      accessToken: "old-access-token",
      refreshToken: "old-refresh-token",
      scopes: ["s1"],
      upstreamAccountIdentifier: "fixture-upstream-id",
    });
    mockTokenStore.revoke.mockResolvedValue(undefined);
    mockCompleteOAuth.mockResolvedValue({
      accessToken: "fixture-access-token",
      refreshToken: "fixture-refresh-token",
      scopes: ["s1"],
      expiresInSeconds: 3600,
      upstreamAccountIdentifier: "fixture-upstream-id",
    });
    resetLmsOAuthStateStoreForTests();
  });

  afterEach(() => {
    resetLmsOAuthStateStoreForTests();
  });

  const publicCode = "lms.invalidOAuthState";

  it("succeeds under a matching teacher/provider/redirect binding", async () => {
    const state = await issueFixtureState();
    const response = await __lmsConnectionsCompleteHandler(
      makeRequest({
        providerId: PROVIDER,
        code: "fixture-auth-code",
        state,
        redirectUri: REDIRECT,
      }),
    );
    expect(response.providerId).toBe(PROVIDER);
    expect(response.alreadyConnected).toBe(false);
    expect(mockCompleteOAuth).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing state with a uniform public code", async () => {
    await expect(
      __lmsConnectionsCompleteHandler(
        makeRequest({
          providerId: PROVIDER,
          code: "fixture-auth-code",
          state: "",
          redirectUri: REDIRECT,
        }),
      ),
    ).rejects.toMatchObject({ code: "lms.invalidState" });
  });

  it("rejects an unknown state without ever calling the adapter", async () => {
    let observed: unknown;
    try {
      await __lmsConnectionsCompleteHandler(
        makeRequest({
          providerId: PROVIDER,
          code: "fixture-auth-code",
          state: "0".repeat(64),
          redirectUri: REDIRECT,
        }),
      );
    } catch (err) {
      observed = err;
    }
    expect((observed as PlatformError).code).toBe(publicCode);
    expect(mockCompleteOAuth).not.toHaveBeenCalled();
  });

  it("rejects a state issued for a different teacher and does not exchange the code", async () => {
    const state = await issueFixtureState({ teacherId: OTHER_TEACHER_UID });
    let observed: unknown;
    try {
      await __lmsConnectionsCompleteHandler(
        makeRequest({
          providerId: PROVIDER,
          code: "fixture-auth-code",
          state,
          redirectUri: REDIRECT,
        }),
      );
    } catch (err) {
      observed = err;
    }
    expect((observed as PlatformError).code).toBe(publicCode);
    expect(mockCompleteOAuth).not.toHaveBeenCalled();
  });

  it("rejects a state issued against a different redirect URI", async () => {
    const state = await issueFixtureState({
      redirectUri: "https://fixture.example.invalid/other-callback",
    });
    let observed: unknown;
    try {
      await __lmsConnectionsCompleteHandler(
        makeRequest({
          providerId: PROVIDER,
          code: "fixture-auth-code",
          state,
          redirectUri: REDIRECT,
        }),
      );
    } catch (err) {
      observed = err;
    }
    expect((observed as PlatformError).code).toBe(publicCode);
    expect(mockCompleteOAuth).not.toHaveBeenCalled();
  });

  it("rejects a state already consumed by an earlier completion", async () => {
    const state = await issueFixtureState();
    await getLmsOAuthStateStore().consume({
      state,
      expectedProviderId: PROVIDER,
      expectedRedirectUri: REDIRECT,
    });
    let observed: unknown;
    try {
      await __lmsConnectionsCompleteHandler(
        makeRequest({
          providerId: PROVIDER,
          code: "fixture-auth-code",
          state,
          redirectUri: REDIRECT,
        }),
      );
    } catch (err) {
      observed = err;
    }
    expect((observed as PlatformError).code).toBe(publicCode);
    expect(mockCompleteOAuth).not.toHaveBeenCalled();
  });

  it("does not surface internal validation granularity in the public error message", async () => {
    let observed: unknown;
    try {
      await __lmsConnectionsCompleteHandler(
        makeRequest({
          providerId: PROVIDER,
          code: "fixture-auth-code",
          state: "0".repeat(64),
          redirectUri: REDIRECT,
        }),
      );
    } catch (err) {
      observed = err;
    }
    const message = (observed as PlatformError).message;
    expect(message).not.toContain("provider");
    expect(message).not.toContain("redirect");
    expect(message).not.toContain("teacher");
    expect(message).not.toContain("consumed");
    expect(message).not.toContain("expired");
  });

  it("does not include state, verifier, code, or tokens in the public error message", async () => {
    const state = await issueFixtureState();
    let observed: unknown;
    try {
      await __lmsConnectionsCompleteHandler(
        makeRequest({
          providerId: PROVIDER,
          code: "fixture-auth-code-secret",
          state,
          redirectUri: "https://fixture.example.invalid/other-callback",
        }),
      );
    } catch (err) {
      observed = err;
    }
    const message = (observed as PlatformError).message;
    expect(message).not.toContain(state);
    expect(message).not.toContain("fixture-auth-code-secret");
    expect(message).not.toContain("code_verifier");
  });

  it("returns consentOutcome=created on a new connection", async () => {
    const state = await issueFixtureState();
    const response = await __lmsConnectionsCompleteHandler(
      makeRequest({
        providerId: PROVIDER,
        code: "fixture-auth-code",
        state,
        redirectUri: REDIRECT,
      }),
    );
    expect(response.consentOutcome).toBe("created");
    expect(response.alreadyConnected).toBe(false);
  });

  it("returns alreadyConnected without consentOutcome on non-publication idempotent path", async () => {
    // Active connection, no publication intent (default).
    mockConnectionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        teacherId: TEACHER_UID,
        providerId: PROVIDER,
        status: "active",
        tokenRef: "tokref-existing",
        scopes: ["s1"],
      }),
    });
    const state = await issueFixtureState();
    const response = await __lmsConnectionsCompleteHandler(
      makeRequest({
        providerId: PROVIDER,
        code: "fixture-auth-code",
        state,
        redirectUri: REDIRECT,
      }),
    );
    expect(response.alreadyConnected).toBe(true);
    expect(response.consentOutcome).toBeUndefined();
    // Code exchange did not run.
    expect(mockCompleteOAuth).not.toHaveBeenCalled();
  });

  it("widens scope set and returns consentOutcome=widened on publication intent", async () => {
    // Active connection with initial scopes only.
    mockConnectionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        teacherId: TEACHER_UID,
        providerId: PROVIDER,
        status: "active",
        tokenRef: "tokref-existing",
        scopes: ["s1"],
      }),
    });
    // New grant adds a publication scope.
    mockCompleteOAuth.mockResolvedValue({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      scopes: ["s1", "s2-publication"],
      expiresInSeconds: 3600,
      upstreamAccountIdentifier: "fixture-upstream-id",
    });
    mockTokenStore.store.mockResolvedValue("tokref-widened");

    const { state } = await getLmsOAuthStateStore().issue({
      teacherId: TEACHER_UID,
      providerId: PROVIDER,
      redirectUri: REDIRECT,
      intent: "publication",
    });
    const response = await __lmsConnectionsCompleteHandler(
      makeRequest({
        providerId: PROVIDER,
        code: "fixture-auth-code",
        state,
        redirectUri: REDIRECT,
      }),
    );
    expect(response.alreadyConnected).toBe(true);
    expect(response.consentOutcome).toBe("widened");
    // New token stored.
    expect(mockTokenStore.store).toHaveBeenCalledTimes(1);
    // Connection doc updated (not created).
    expect(mockConnectionUpdate).toHaveBeenCalledTimes(1);
    expect(mockConnectionSet).not.toHaveBeenCalled();
    // Audit event NOT emitted for widening.
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    // Old token revoked from local store.
    expect(mockTokenStore.revoke).toHaveBeenCalledWith("tokref-existing");
    // Merged scopes written to connection doc.
    const updateArg = mockConnectionUpdate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updateArg.scopes).toContain("s1");
    expect(updateArg.scopes).toContain("s2-publication");
  });

  it("returns alreadyAuthorized when the new grant adds no new scopes", async () => {
    mockConnectionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        teacherId: TEACHER_UID,
        providerId: PROVIDER,
        status: "active",
        tokenRef: "tokref-existing",
        scopes: ["s1"],
      }),
    });
    // New grant returns the same scope already held.
    mockCompleteOAuth.mockResolvedValue({
      accessToken: "new-access-token",
      scopes: ["s1"],
      expiresInSeconds: 3600,
      upstreamAccountIdentifier: "fixture-upstream-id",
    });

    const { state } = await getLmsOAuthStateStore().issue({
      teacherId: TEACHER_UID,
      providerId: PROVIDER,
      redirectUri: REDIRECT,
      intent: "publication",
    });
    const response = await __lmsConnectionsCompleteHandler(
      makeRequest({
        providerId: PROVIDER,
        code: "fixture-auth-code",
        state,
        redirectUri: REDIRECT,
      }),
    );
    expect(response.consentOutcome).toBe("alreadyAuthorized");
    expect(response.alreadyConnected).toBe(true);
    // Nothing written for already-authorized.
    expect(mockConnectionUpdate).not.toHaveBeenCalled();
    expect(mockConnectionSet).not.toHaveBeenCalled();
  });

  it("rejects widening with lms.identityMismatch when upstream accounts differ", async () => {
    mockConnectionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        teacherId: TEACHER_UID,
        providerId: PROVIDER,
        status: "active",
        tokenRef: "tokref-existing",
        scopes: ["s1"],
      }),
    });
    // Old bundle has a different upstream account.
    mockTokenStore.resolve.mockResolvedValue({
      providerId: "googleClassroom",
      teacherId: TEACHER_UID,
      accessToken: "old-access-token",
      refreshToken: "old-refresh-token",
      scopes: ["s1"],
      upstreamAccountIdentifier: "account-A",
    });
    // New grant comes from a different account.
    mockCompleteOAuth.mockResolvedValue({
      accessToken: "new-access-token",
      scopes: ["s1", "s2-publication"],
      expiresInSeconds: 3600,
      upstreamAccountIdentifier: "account-B",
    });

    const { state } = await getLmsOAuthStateStore().issue({
      teacherId: TEACHER_UID,
      providerId: PROVIDER,
      redirectUri: REDIRECT,
      intent: "publication",
    });
    await expect(
      __lmsConnectionsCompleteHandler(
        makeRequest({
          providerId: PROVIDER,
          code: "fixture-auth-code",
          state,
          redirectUri: REDIRECT,
        }),
      ),
    ).rejects.toMatchObject({ code: "lms.identityMismatch" });
    // Connection document not modified.
    expect(mockConnectionUpdate).not.toHaveBeenCalled();
    expect(mockTokenStore.store).not.toHaveBeenCalled();
  });

  it("carries forward the old refresh token when the new grant omits one", async () => {
    mockConnectionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        teacherId: TEACHER_UID,
        providerId: PROVIDER,
        status: "active",
        tokenRef: "tokref-existing",
        scopes: ["s1"],
      }),
    });
    mockTokenStore.resolve.mockResolvedValue({
      providerId: "googleClassroom",
      teacherId: TEACHER_UID,
      accessToken: "old-access-token",
      refreshToken: "preserved-refresh-token",
      scopes: ["s1"],
      upstreamAccountIdentifier: "fixture-upstream-id",
    });
    // New grant omits refresh_token (Google incremental re-consent behavior).
    mockCompleteOAuth.mockResolvedValue({
      accessToken: "new-access-token",
      scopes: ["s1", "s2-publication"],
      expiresInSeconds: 3600,
      upstreamAccountIdentifier: "fixture-upstream-id",
    });
    mockTokenStore.store.mockResolvedValue("tokref-widened");

    const { state } = await getLmsOAuthStateStore().issue({
      teacherId: TEACHER_UID,
      providerId: PROVIDER,
      redirectUri: REDIRECT,
      intent: "publication",
    });
    await __lmsConnectionsCompleteHandler(
      makeRequest({
        providerId: PROVIDER,
        code: "fixture-auth-code",
        state,
        redirectUri: REDIRECT,
      }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storeArg = (mockTokenStore.store.mock.calls as any)[0]?.[0] as Record<string, unknown>;
    expect(storeArg?.refreshToken).toBe("preserved-refresh-token");
  });

  it("stores the replacement refresh token when the new grant provides one", async () => {
    mockConnectionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        teacherId: TEACHER_UID,
        providerId: PROVIDER,
        status: "active",
        tokenRef: "tokref-existing",
        scopes: ["s1"],
      }),
    });
    mockTokenStore.resolve.mockResolvedValue({
      providerId: "googleClassroom",
      teacherId: TEACHER_UID,
      accessToken: "old-access-token",
      refreshToken: "old-refresh-token",
      scopes: ["s1"],
      upstreamAccountIdentifier: "fixture-upstream-id",
    });
    mockCompleteOAuth.mockResolvedValue({
      accessToken: "new-access-token",
      refreshToken: "replacement-refresh-token",
      scopes: ["s1", "s2-publication"],
      expiresInSeconds: 3600,
      upstreamAccountIdentifier: "fixture-upstream-id",
    });
    mockTokenStore.store.mockResolvedValue("tokref-widened");

    const { state } = await getLmsOAuthStateStore().issue({
      teacherId: TEACHER_UID,
      providerId: PROVIDER,
      redirectUri: REDIRECT,
      intent: "publication",
    });
    await __lmsConnectionsCompleteHandler(
      makeRequest({
        providerId: PROVIDER,
        code: "fixture-auth-code",
        state,
        redirectUri: REDIRECT,
      }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storeArg = (mockTokenStore.store.mock.calls as any)[0]?.[0] as Record<string, unknown>;
    expect(storeArg?.refreshToken).toBe("replacement-refresh-token");
  });

  it("never revokes the upstream Google grant on a successful widening", async () => {
    mockConnectionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        teacherId: TEACHER_UID,
        providerId: PROVIDER,
        status: "active",
        tokenRef: "tokref-existing",
        scopes: ["s1"],
      }),
    });
    mockCompleteOAuth.mockResolvedValue({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      scopes: ["s1", "s2-publication"],
      expiresInSeconds: 3600,
      upstreamAccountIdentifier: "fixture-upstream-id",
    });
    mockTokenStore.store.mockResolvedValue("tokref-widened");

    const { state } = await getLmsOAuthStateStore().issue({
      teacherId: TEACHER_UID,
      providerId: PROVIDER,
      redirectUri: REDIRECT,
      intent: "publication",
    });
    const response = await __lmsConnectionsCompleteHandler(
      makeRequest({
        providerId: PROVIDER,
        code: "fixture-auth-code",
        state,
        redirectUri: REDIRECT,
      }),
    );
    expect(response.consentOutcome).toBe("widened");
    // The provider (Google) OAuth grant is NEVER revoked during widening:
    // the widened connection keeps using the same underlying grant.
    expect(mockAdapterRevokeGrant).not.toHaveBeenCalled();
    // Only the LOCAL token-store entry for the superseded bundle is cleaned up.
    expect(mockTokenStore.revoke).toHaveBeenCalledTimes(1);
    expect(mockTokenStore.revoke).toHaveBeenCalledWith("tokref-existing");
  });

  it("refuses widening with a sanitized failure when the existing token bundle cannot be resolved", async () => {
    mockConnectionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        teacherId: TEACHER_UID,
        providerId: PROVIDER,
        status: "active",
        tokenRef: "tokref-existing",
        scopes: ["s1"],
      }),
    });
    mockTokenStore.resolve.mockRejectedValue(
      new Error("token bundle missing"),
    );
    mockCompleteOAuth.mockResolvedValue({
      accessToken: "new-access-token",
      scopes: ["s1", "s2-publication"],
      expiresInSeconds: 3600,
      upstreamAccountIdentifier: "fixture-upstream-id",
    });

    const { state } = await getLmsOAuthStateStore().issue({
      teacherId: TEACHER_UID,
      providerId: PROVIDER,
      redirectUri: REDIRECT,
      intent: "publication",
    });
    await expect(
      __lmsConnectionsCompleteHandler(
        makeRequest({
          providerId: PROVIDER,
          code: "fixture-auth-code",
          state,
          redirectUri: REDIRECT,
        }),
      ),
    ).rejects.toMatchObject({ code: "lms.connectionTokenResolutionFailed" });
    // The existing connection is untouched: no new token, no doc update.
    expect(mockTokenStore.store).not.toHaveBeenCalled();
    expect(mockConnectionUpdate).not.toHaveBeenCalled();
  });

  it("aborts widening and preserves the connection when the new bundle store() fails", async () => {
    mockConnectionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        teacherId: TEACHER_UID,
        providerId: PROVIDER,
        status: "active",
        tokenRef: "tokref-existing",
        scopes: ["s1"],
      }),
    });
    mockCompleteOAuth.mockResolvedValue({
      accessToken: "new-access-token",
      scopes: ["s1", "s2-publication"],
      expiresInSeconds: 3600,
      upstreamAccountIdentifier: "fixture-upstream-id",
    });
    mockTokenStore.store.mockRejectedValue(new Error("store failed"));

    const { state } = await getLmsOAuthStateStore().issue({
      teacherId: TEACHER_UID,
      providerId: PROVIDER,
      redirectUri: REDIRECT,
      intent: "publication",
    });
    await expect(
      __lmsConnectionsCompleteHandler(
        makeRequest({
          providerId: PROVIDER,
          code: "fixture-auth-code",
          state,
          redirectUri: REDIRECT,
        }),
      ),
    ).rejects.toBeDefined();
    // The connection document is never updated, so the existing connection
    // still points at its old, valid tokenRef.
    expect(mockConnectionUpdate).not.toHaveBeenCalled();
    // No local cleanup of the old bundle either (widen aborted before commit).
    expect(mockTokenStore.revoke).not.toHaveBeenCalled();
  });

  it("leaves the connection on its old tokenRef when the connection update() fails", async () => {
    mockConnectionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        teacherId: TEACHER_UID,
        providerId: PROVIDER,
        status: "active",
        tokenRef: "tokref-existing",
        scopes: ["s1"],
      }),
    });
    mockCompleteOAuth.mockResolvedValue({
      accessToken: "new-access-token",
      scopes: ["s1", "s2-publication"],
      expiresInSeconds: 3600,
      upstreamAccountIdentifier: "fixture-upstream-id",
    });
    mockTokenStore.store.mockResolvedValue("tokref-widened-orphan");
    mockConnectionUpdate.mockRejectedValue(new Error("update failed"));

    const { state } = await getLmsOAuthStateStore().issue({
      teacherId: TEACHER_UID,
      providerId: PROVIDER,
      redirectUri: REDIRECT,
      intent: "publication",
    });
    await expect(
      __lmsConnectionsCompleteHandler(
        makeRequest({
          providerId: PROVIDER,
          code: "fixture-auth-code",
          state,
          redirectUri: REDIRECT,
        }),
      ),
    ).rejects.toBeDefined();
    // The new bundle is orphaned and inert; the old bundle is NOT cleaned up,
    // so the existing connection remains usable on its original tokenRef.
    expect(mockTokenStore.revoke).not.toHaveBeenCalled();
    expect(mockConnectionSet).not.toHaveBeenCalled();
  });

  it("still reports widened when the best-effort old-bundle cleanup fails", async () => {
    mockConnectionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        teacherId: TEACHER_UID,
        providerId: PROVIDER,
        status: "active",
        tokenRef: "tokref-existing",
        scopes: ["s1"],
      }),
    });
    mockCompleteOAuth.mockResolvedValue({
      accessToken: "new-access-token",
      scopes: ["s1", "s2-publication"],
      expiresInSeconds: 3600,
      upstreamAccountIdentifier: "fixture-upstream-id",
    });
    mockTokenStore.store.mockResolvedValue("tokref-widened");
    mockTokenStore.revoke.mockRejectedValue(new Error("cleanup failed"));

    const { state } = await getLmsOAuthStateStore().issue({
      teacherId: TEACHER_UID,
      providerId: PROVIDER,
      redirectUri: REDIRECT,
      intent: "publication",
    });
    const response = await __lmsConnectionsCompleteHandler(
      makeRequest({
        providerId: PROVIDER,
        code: "fixture-auth-code",
        state,
        redirectUri: REDIRECT,
      }),
    );
    // Cleanup is hygiene, not lifecycle: its failure never fails the widen.
    expect(response.consentOutcome).toBe("widened");
    expect(mockConnectionUpdate).toHaveBeenCalledTimes(1);
  });
});
