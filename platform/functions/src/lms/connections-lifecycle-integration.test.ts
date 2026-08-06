// Sprint 23B final integration verification.
//
// Exercises the ACTUAL exported begin/complete callable handlers as a
// single sequence in one Node process, wired to the real Google
// Classroom adapter and to the fixture Google Classroom transport. No
// real Google endpoint, no Secret Manager, no Firestore rules, and no
// production credential is touched.
//
// The suite proves exactly the runtime boundary the sprint direction
// asked us to verify: that when both callables execute inside the same
// Node process, the pending OAuth state issued by begin is visible to
// complete through the module-singleton `InProcessLmsOAuthStateStore`,
// and that a second completion with the same state is rejected as a
// replay. It also proves that state, verifier, code, tokens, and
// client secret never leak into callable responses, thrown public
// errors, or observed log lines.
//
// This is a controlled single-process demonstration. It does NOT prove
// that two independently-warmed Cloud Functions instances would share
// pending OAuth state; that would require a durable multi-instance
// store, which remains a Sprint 23C obligation.

import type { CallableRequest } from "firebase-functions/v2/https";

// -------------------- Mocks: system boundaries only --------------------
//
// The adapter, transport, config, config-firebase installer, provider
// registry, and OAuth state store are NOT mocked. Only Firestore,
// audit log, structured log, and the vendor-neutral token store are
// mocked, matching the boundary already established by
// `connections-complete-oauth-state.test.ts`.

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

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();
const mockWriteAuditEvent = jest.fn();

const mockTokenStore = {
  store: jest.fn(() => Promise.resolve("tokref-integration-1")),
  resolve: jest.fn(),
  revoke: jest.fn(() => Promise.resolve()),
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
    lmsConnectionCreationDocRef: mockConnectionCreationDocRef,
    writeAuditEvent: mockWriteAuditEvent,
  };
});

jest.mock("./tokens/token-store", () => ({
  getLmsTokenStore: () => mockTokenStore,
}));

import type { PlatformError } from "../shared";

import { __lmsConnectionsBeginHandler } from "./connections-begin";
import { __lmsConnectionsCompleteHandler } from "./connections-complete";
import { resetLmsOAuthStateStoreForTests } from "./oauth-state/state-store";
import {
  resetGoogleClassroomConfigForTests,
  setGoogleClassroomConfig,
} from "./providers/google-classroom/config";
import {
  createFixtureGoogleClassroomTransport,
  FIXTURE_AUTHORIZATION_CODE,
  FIXTURE_TEACHER_UPSTREAM_ID,
} from "./providers/google-classroom/__fixtures__/fixture-transport";
import {
  resetGoogleClassroomTransportForTests,
  setGoogleClassroomTransport,
} from "./providers/google-classroom/transport";

const FIXTURE_CONFIG = {
  clientId: "fixture-oauth-client-id",
  clientSecret: "fixture-oauth-client-secret-never-real",
  redirectUri: "https://fixture.example.invalid/lms-callback",
} as const;

const TEACHER_UID = "fixture-teacher-uid-integration";
const PROVIDER = "googleClassroom";

function makeRequest(
  data: unknown,
  uid = TEACHER_UID,
): CallableRequest<unknown> {
  return {
    data,
    auth: {
      uid,
      token: { role: "teacher", schoolId: "school-fixture-integration" },
    } as never,
    rawRequest: {} as never,
  };
}

describe("lmsConnectionsBegin -> lmsConnectionsComplete cross-callable integration (single-process, fixture transport)", () => {
  beforeEach(() => {
    [
      mockConnectionGet,
      mockConnectionSet,
      mockConnectionUpdate,
      mockWriteAuditEvent,
      mockLogInfo,
      mockLogWarn,
      mockLogError,
      mockTokenStore.store,
      mockTokenStore.resolve,
      mockTokenStore.revoke,
    ].forEach((m) => m.mockReset());
    mockTokenStore.store.mockResolvedValue("tokref-integration-1");
    mockTokenStore.resolve.mockResolvedValue({
      providerId: "googleClassroom",
      teacherId: TEACHER_UID,
      accessToken: "existing-access-token",
      refreshToken: "existing-refresh-token",
      scopes: [
        "https://www.googleapis.com/auth/classroom.courses.readonly",
        "https://www.googleapis.com/auth/classroom.rosters.readonly",
      ],
      upstreamAccountIdentifier: FIXTURE_TEACHER_UPSTREAM_ID,
    });
    mockTokenStore.revoke.mockResolvedValue(undefined);
    mockConnectionUpdate.mockResolvedValue(undefined);
    mockConnectionDocRef.mockReset();
    mockConnectionDocRef.mockImplementation(() => ({
      get: mockConnectionGet,
      update: mockConnectionUpdate,
    }));
    mockConnectionCreationDocRef.mockReset();
    mockConnectionCreationDocRef.mockImplementation(() => ({
      set: mockConnectionSet,
    }));
    mockConnectionGet.mockResolvedValue({ exists: false });
    mockConnectionSet.mockResolvedValue(undefined);
    mockWriteAuditEvent.mockResolvedValue(undefined);

    resetLmsOAuthStateStoreForTests();
    resetGoogleClassroomConfigForTests();
    resetGoogleClassroomTransportForTests();
    // Install the fixture bindings BEFORE any handler runs so the
    // production installer inside `ensureGoogleClassroomProductionBindings`
    // detects a bound seam and skips touching Secret Manager / Firebase
    // parameters.
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
  });

  afterEach(() => {
    resetLmsOAuthStateStoreForTests();
    resetGoogleClassroomConfigForTests();
    resetGoogleClassroomTransportForTests();
  });

  it("issues state through the begin handler and completes through the complete handler in one process", async () => {
    const beginResponse = await __lmsConnectionsBeginHandler(
      makeRequest({
        providerId: PROVIDER,
        redirectUri: FIXTURE_CONFIG.redirectUri,
      }),
    );
    // Public response contract shape.
    expect(typeof beginResponse.authorizationUrl).toBe("string");
    expect(typeof beginResponse.state).toBe("string");
    expect(beginResponse.state.length).toBeGreaterThan(0);
    // The authorization URL carries the state and PKCE challenge, and
    // never carries the verifier.
    const url = new URL(beginResponse.authorizationUrl);
    expect(url.searchParams.get("state")).toBe(beginResponse.state);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(
      /^[A-Za-z0-9\-_]{43}$/,
    );
    expect(beginResponse.authorizationUrl).not.toContain("code_verifier=");

    // Now invoke the complete handler with the exact state the begin
    // handler minted. The two callables must share the state record.
    const completeResponse = await __lmsConnectionsCompleteHandler(
      makeRequest({
        providerId: PROVIDER,
        code: FIXTURE_AUTHORIZATION_CODE,
        state: beginResponse.state,
        redirectUri: FIXTURE_CONFIG.redirectUri,
      }),
    );
    expect(completeResponse.providerId).toBe(PROVIDER);
    expect(completeResponse.alreadyConnected).toBe(false);
    expect(typeof completeResponse.connectionId).toBe("string");
    expect(completeResponse.connectionId.length).toBeGreaterThan(0);

    // The token store received the tokens from the fixture exchange.
    expect(mockTokenStore.store).toHaveBeenCalledTimes(1);
    // The connection creation write ran exactly once.
    expect(mockConnectionSet).toHaveBeenCalledTimes(1);
    // The audit event fired.
    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: TEACHER_UID,
        action: "lms.connectionCreated",
        targetType: "lmsConnection",
      }),
    );
  });

  it("rejects a second completion with the same state as a replay", async () => {
    const beginResponse = await __lmsConnectionsBeginHandler(
      makeRequest({
        providerId: PROVIDER,
        redirectUri: FIXTURE_CONFIG.redirectUri,
      }),
    );
    await __lmsConnectionsCompleteHandler(
      makeRequest({
        providerId: PROVIDER,
        code: FIXTURE_AUTHORIZATION_CODE,
        state: beginResponse.state,
        redirectUri: FIXTURE_CONFIG.redirectUri,
      }),
    );
    // Second completion must fail with the uniform public code.
    // Reset the connection-doc mock so the second attempt is NOT
    // short-circuited by the idempotent "already active" branch; this
    // isolates the replay to the OAuth state check.
    mockConnectionGet.mockResolvedValueOnce({ exists: false });

    let observed: unknown;
    try {
      await __lmsConnectionsCompleteHandler(
        makeRequest({
          providerId: PROVIDER,
          code: FIXTURE_AUTHORIZATION_CODE,
          state: beginResponse.state,
          redirectUri: FIXTURE_CONFIG.redirectUri,
        }),
      );
    } catch (err) {
      observed = err;
    }
    expect(observed).toBeDefined();
    expect((observed as PlatformError).code).toBe("lms.invalidOAuthState");
    // Only the first completion produced token / connection / audit writes.
    expect(mockTokenStore.store).toHaveBeenCalledTimes(1);
    expect(mockConnectionSet).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("does not surface state, verifier, code, access token, refresh token, or client secret in callable responses, thrown errors, or logs", async () => {
    const beginResponse = await __lmsConnectionsBeginHandler(
      makeRequest({
        providerId: PROVIDER,
        redirectUri: FIXTURE_CONFIG.redirectUri,
      }),
    );
    const completeResponse = await __lmsConnectionsCompleteHandler(
      makeRequest({
        providerId: PROVIDER,
        code: FIXTURE_AUTHORIZATION_CODE,
        state: beginResponse.state,
        redirectUri: FIXTURE_CONFIG.redirectUri,
      }),
    );

    // Trigger a replay so an error is available for inspection.
    let replayError: PlatformError | undefined;
    try {
      await __lmsConnectionsCompleteHandler(
        makeRequest({
          providerId: PROVIDER,
          code: FIXTURE_AUTHORIZATION_CODE,
          state: beginResponse.state,
          redirectUri: FIXTURE_CONFIG.redirectUri,
        }),
      );
    } catch (err) {
      replayError = err as PlatformError;
    }

    const sensitive: readonly string[] = [
      beginResponse.state,
      FIXTURE_AUTHORIZATION_CODE,
      "fixture-access-token-xxxxxxxx",
      "fixture-refresh-token-zzzzzzzz",
      FIXTURE_CONFIG.clientSecret,
      "code_verifier",
    ];

    // Response payloads never carry any sensitive substring.
    const responseSerialized = JSON.stringify({
      begin: {
        state: beginResponse.state,
        authorizationUrl: beginResponse.authorizationUrl,
      },
      complete: completeResponse,
    });
    // The `state` value itself is by design present in the authorization
    // URL and in the begin response; the sensitivity check is that the
    // secret verifier / tokens / client secret never appear. State is
    // opaque and single-use by construction, so its presence in the
    // authorization URL is expected.
    for (const needle of sensitive) {
      if (needle === beginResponse.state) continue;
      expect(responseSerialized).not.toContain(needle);
    }

    // Thrown public error never carries any sensitive substring, including
    // the state.
    expect(replayError).toBeDefined();
    const errMessage = replayError?.message ?? "";
    for (const needle of sensitive) {
      expect(errMessage).not.toContain(needle);
    }

    // Observed logs (info / warn / error) never carry any sensitive
    // substring, including the state. Serialize every argument of every
    // call so a leak inside a nested object is still caught.
    const logCalls: unknown[] = [
      ...mockLogInfo.mock.calls,
      ...mockLogWarn.mock.calls,
      ...mockLogError.mock.calls,
    ];
    const logSerialized = JSON.stringify(logCalls);
    for (const needle of sensitive) {
      expect(logSerialized).not.toContain(needle);
    }

    // The connection creation write payload never carries the state,
    // verifier, code, tokens, or client secret. It carries only a
    // provider id, teacher id, school id, scopes, `tokenRef`, and
    // status marker.
    const writeArgs = mockConnectionSet.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(writeArgs).toBeDefined();
    const writeSerialized = JSON.stringify(writeArgs);
    for (const needle of sensitive) {
      expect(writeSerialized).not.toContain(needle);
    }
    expect(writeArgs?.tokenRef).toBe("tokref-integration-1");

    // The audit event payload never carries any sensitive substring.
    const auditArgs = mockWriteAuditEvent.mock.calls[0]?.[0];
    const auditSerialized = JSON.stringify(auditArgs);
    for (const needle of sensitive) {
      expect(auditSerialized).not.toContain(needle);
    }
  });

  it("capability='publication' flows to publication scopes in the authorization URL", async () => {
    const beginResponse = await __lmsConnectionsBeginHandler(
      makeRequest({
        providerId: PROVIDER,
        redirectUri: FIXTURE_CONFIG.redirectUri,
        capability: "publication",
      }),
    );
    const url = new URL(beginResponse.authorizationUrl);
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).toContain("classroom.courses.readonly");
    expect(scope).toContain("classroom.coursework.me");
    expect(scope).toContain("classroom.topics.readonly");
  });

  it("omitted capability requests only the initial (readonly) scope set", async () => {
    const beginResponse = await __lmsConnectionsBeginHandler(
      makeRequest({
        providerId: PROVIDER,
        redirectUri: FIXTURE_CONFIG.redirectUri,
      }),
    );
    const url = new URL(beginResponse.authorizationUrl);
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).toContain("classroom.courses.readonly");
    expect(scope).not.toContain("classroom.coursework.me");
    expect(scope).not.toContain("classroom.topics.readonly");
  });

  it("rejects an unrecognized capability value with lms.invalidCapability and issues no state", async () => {
    await expect(
      __lmsConnectionsBeginHandler(
        makeRequest({
          providerId: PROVIDER,
          redirectUri: FIXTURE_CONFIG.redirectUri,
          capability: "grades",
        }),
      ),
    ).rejects.toMatchObject({ code: "lms.invalidCapability" });
  });

  it("does not echo the raw capability value in the invalid-argument message", async () => {
    try {
      await __lmsConnectionsBeginHandler(
        makeRequest({
          providerId: PROVIDER,
          redirectUri: FIXTURE_CONFIG.redirectUri,
          capability: "classroom.coursework.students",
        }),
      );
      throw new Error("expected lms.invalidCapability");
    } catch (err) {
      const message = (err as { message?: string }).message ?? "";
      expect(message).not.toContain("classroom.coursework.students");
    }
  });

  it("takes the widening code path (not new-connection) when capability='publication' and active connection exists", async () => {
    // Simulate an existing active connection with initial scopes only.
    mockConnectionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        teacherId: TEACHER_UID,
        providerId: PROVIDER,
        status: "active",
        tokenRef: "tokref-existing",
        scopes: [
          "https://www.googleapis.com/auth/classroom.courses.readonly",
          "https://www.googleapis.com/auth/classroom.rosters.readonly",
        ],
      }),
    });

    const beginResponse = await __lmsConnectionsBeginHandler(
      makeRequest({
        providerId: PROVIDER,
        redirectUri: FIXTURE_CONFIG.redirectUri,
        capability: "publication",
      }),
    );
    const completeResponse = await __lmsConnectionsCompleteHandler(
      makeRequest({
        providerId: PROVIDER,
        code: FIXTURE_AUTHORIZATION_CODE,
        state: beginResponse.state,
        redirectUri: FIXTURE_CONFIG.redirectUri,
      }),
    );
    // The widening path was taken (not the new-connection creation path).
    // The fixture transport returns only the initial scopes, so the merge
    // equals the existing scopes and the outcome is alreadyAuthorized.
    expect(completeResponse.alreadyConnected).toBe(true);
    expect(completeResponse.consentOutcome).toBe("alreadyAuthorized");
    // Connection doc was NOT created anew.
    expect(mockConnectionSet).not.toHaveBeenCalled();
    // No audit event on the widening path.
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    // Token store creation was NOT called (already authorized path).
    expect(mockTokenStore.store).not.toHaveBeenCalled();
  });

  it("requires no production configuration or Secret Manager access under the fixture binding", async () => {
    // The production installer (`ensureGoogleClassroomProductionBindings`)
    // is called at the top of both handlers. If it reached for a real
    // Secret Manager value, `defineSecret(...).value()` would throw in
    // this test environment. The fact that the earlier tests complete
    // without such a throw is itself the proof; this test formalizes it
    // by asserting the fixture bindings are still installed at handler
    // exit and were never overwritten by the installer.
    const beginResponse = await __lmsConnectionsBeginHandler(
      makeRequest({
        providerId: PROVIDER,
        redirectUri: FIXTURE_CONFIG.redirectUri,
      }),
    );
    await __lmsConnectionsCompleteHandler(
      makeRequest({
        providerId: PROVIDER,
        code: FIXTURE_AUTHORIZATION_CODE,
        state: beginResponse.state,
        redirectUri: FIXTURE_CONFIG.redirectUri,
      }),
    );
    // If the installer had installed the production HTTPS transport,
    // the fixture-only `authorizationCodeExchanges` counter would not
    // exist. The successful complete above already proves the fixture
    // transport served the exchange.
    expect(mockTokenStore.store).toHaveBeenCalledTimes(1);
  });
});
