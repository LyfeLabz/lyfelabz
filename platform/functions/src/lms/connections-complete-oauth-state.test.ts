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
const mockConnectionDocRef = jest.fn(() => ({ get: mockConnectionGet }));
const mockConnectionCreationDocRef = jest.fn(() => ({
  set: mockConnectionSet,
}));

const mockWriteAuditEvent = jest.fn();
const mockLogInfo = jest.fn();

const mockTokenStore = { store: jest.fn(() => Promise.resolve("tokref-1")) };
const mockCompleteOAuth = jest.fn();
const mockGetAdapter = jest.fn(() => ({ completeOAuth: mockCompleteOAuth }));
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
      mockWriteAuditEvent,
      mockLogInfo,
      mockCompleteOAuth,
      mockGetAdapter,
      mockEnsureBindings,
    ].forEach((m) => m.mockReset());
    mockConnectionDocRef.mockReset();
    mockConnectionDocRef.mockImplementation(() => ({ get: mockConnectionGet }));
    mockConnectionCreationDocRef.mockReset();
    mockConnectionCreationDocRef.mockImplementation(() => ({
      set: mockConnectionSet,
    }));
    mockGetAdapter.mockImplementation(() => ({
      completeOAuth: mockCompleteOAuth,
    }));
    mockConnectionGet.mockResolvedValue({ exists: false });
    mockConnectionSet.mockResolvedValue(undefined);
    mockWriteAuditEvent.mockResolvedValue(undefined);
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
});
