// Sprint 26 Phase 2 - Google account continuity.
//
// Exercises the ACTUAL exported `lmsConnectionsBegin` handler wired to the
// real Google Classroom adapter and provider registry, so the produced
// authorization URL genuinely carries (or genuinely omits) Google's
// `login_hint`. Only the system boundaries are mocked: Firestore (the
// connection document), the vendor-neutral token store, the audit/log
// sinks, and the Cloud Functions wrapper - matching the boundary already
// established by `connections-lifecycle-integration.test.ts`.
//
// Phase 1 added the provider-neutral `accountHint` contract but never
// populated it. Phase 2 populates it from the durable connection identity
// for publication-intent begins only. These tests prove the wiring end to
// end without touching a real Google endpoint. All identifiers are
// fictional.

const mockConnectionGet = jest.fn();
const mockConnectionUpdate = jest.fn();
const mockConnectionSet = jest.fn();
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
  store: jest.fn(() => Promise.resolve("tokref-hint-1")),
  resolve: jest.fn(),
  revoke: jest.fn(() => Promise.resolve()),
  persistRefreshedCredential: jest.fn(),
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

import type { CallableRequest } from "firebase-functions/v2/https";

import { __lmsConnectionsBeginHandler } from "./connections-begin";
import { resetLmsOAuthStateStoreForTests } from "./oauth-state/state-store";
import {
  resetGoogleClassroomConfigForTests,
  setGoogleClassroomConfig,
} from "./providers/google-classroom/config";
import { createFixtureGoogleClassroomTransport } from "./providers/google-classroom/__fixtures__/fixture-transport";
import {
  resetGoogleClassroomTransportForTests,
  setGoogleClassroomTransport,
} from "./providers/google-classroom/transport";

const FIXTURE_CONFIG = {
  clientId: "fixture-oauth-client-id",
  clientSecret: "fixture-oauth-client-secret-never-real",
  redirectUri: "https://fixture.example.invalid/lms-callback",
} as const;

const TEACHER_UID = "fixture-teacher-uid-hint";
const PROVIDER = "googleClassroom";

// Deliberately fictional, obviously-not-real upstream account identifier.
// A real Google identity must never appear in a test snapshot.
const FIXTURE_UPSTREAM_ACCOUNT_ID = "google-account-fixture-001";

function makeRequest(
  data: unknown,
  uid = TEACHER_UID,
): CallableRequest<unknown> {
  return {
    data,
    auth: {
      uid,
      token: { role: "teacher", schoolId: "school-fixture-hint" },
    } as never,
    rawRequest: {} as never,
  };
}

// A resolvable, well-formed durable bundle carrying the fictional upstream
// identity. The scopes are the certified initial (readonly) set.
function activeConnectionBundle(
  upstreamAccountIdentifier = FIXTURE_UPSTREAM_ACCOUNT_ID,
): Record<string, unknown> {
  return {
    providerId: PROVIDER,
    teacherId: TEACHER_UID,
    accessToken: "existing-access-token",
    refreshToken: "existing-refresh-token",
    scopes: [
      "https://www.googleapis.com/auth/classroom.courses.readonly",
      "https://www.googleapis.com/auth/classroom.rosters.readonly",
    ],
    upstreamAccountIdentifier,
  };
}

// A connection document snapshot for an active connection owned by this
// teacher for this provider.
function activeConnectionSnapshot(): Record<string, unknown> {
  return {
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
  };
}

describe("lmsConnectionsBegin - Sprint 26 Phase 2 account continuity", () => {
  beforeEach(() => {
    [
      mockConnectionGet,
      mockConnectionUpdate,
      mockConnectionSet,
      mockLogInfo,
      mockLogWarn,
      mockLogError,
      mockWriteAuditEvent,
      mockTokenStore.store,
      mockTokenStore.resolve,
      mockTokenStore.revoke,
      mockTokenStore.persistRefreshedCredential,
    ].forEach((m) => m.mockReset());
    mockConnectionDocRef.mockReset();
    mockConnectionDocRef.mockImplementation(() => ({
      get: mockConnectionGet,
      update: mockConnectionUpdate,
    }));
    mockConnectionCreationDocRef.mockReset();
    mockConnectionCreationDocRef.mockImplementation(() => ({
      set: mockConnectionSet,
    }));
    // Default: no durable connection. Individual tests override.
    mockConnectionGet.mockResolvedValue({ exists: false });
    mockTokenStore.resolve.mockResolvedValue(activeConnectionBundle());

    resetLmsOAuthStateStoreForTests();
    resetGoogleClassroomConfigForTests();
    resetGoogleClassroomTransportForTests();
    // Fixture bindings installed before any handler runs, so the
    // production installer inside `ensureGoogleClassroomProductionBindings`
    // detects a bound seam and never reaches Secret Manager.
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
  });

  afterEach(() => {
    resetLmsOAuthStateStoreForTests();
    resetGoogleClassroomConfigForTests();
    resetGoogleClassroomTransportForTests();
  });

  it("publication intent with a valid durable identity supplies login_hint from the connection identity", async () => {
    mockConnectionGet.mockResolvedValue(activeConnectionSnapshot());

    const response = await __lmsConnectionsBeginHandler(
      makeRequest({
        providerId: PROVIDER,
        redirectUri: FIXTURE_CONFIG.redirectUri,
        capability: "publication",
      }),
    );

    // The existing connection was located and its bundle resolved through
    // the approved token-store abstraction.
    expect(mockConnectionGet).toHaveBeenCalledTimes(1);
    expect(mockTokenStore.resolve).toHaveBeenCalledTimes(1);
    expect(mockTokenStore.resolve).toHaveBeenCalledWith("tokref-existing");

    // The fictional upstream identity became Google's login_hint.
    const url = new URL(response.authorizationUrl);
    expect(url.searchParams.get("login_hint")).toBe(
      FIXTURE_UPSTREAM_ACCOUNT_ID,
    );

    // The hint disturbs nothing else about the authorization request.
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("state")).toBe(response.state);

    // No additional persistence of the identifier: begin performed a pure
    // read. No token write/rotation/refresh, no connection mutation.
    expect(mockTokenStore.store).not.toHaveBeenCalled();
    expect(mockTokenStore.revoke).not.toHaveBeenCalled();
    expect(mockTokenStore.persistRefreshedCredential).not.toHaveBeenCalled();
    expect(mockConnectionUpdate).not.toHaveBeenCalled();
    expect(mockConnectionSet).not.toHaveBeenCalled();

    // The identifier is never logged or audited by the begin path.
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    const logged = JSON.stringify([
      ...mockLogInfo.mock.calls,
      ...mockLogWarn.mock.calls,
      ...mockLogError.mock.calls,
    ]);
    expect(logged).not.toContain(FIXTURE_UPSTREAM_ACCOUNT_ID);

    // The identifier reaches Google only inside the authorization URL (as
    // login_hint, which the browser carries to Google). It is never
    // surfaced as a separate client-visible identity field: the response
    // contract is exactly { authorizationUrl, state } and nothing else.
    expect(Object.keys(response).sort()).toEqual(["authorizationUrl", "state"]);
    expect(response.state).not.toContain(FIXTURE_UPSTREAM_ACCOUNT_ID);
  });

  it("initial connect performs no connection/token lookup and omits login_hint", async () => {
    // An active connection exists, but initial connect must not consult it
    // for hinting.
    mockConnectionGet.mockResolvedValue(activeConnectionSnapshot());

    const response = await __lmsConnectionsBeginHandler(
      makeRequest({
        providerId: PROVIDER,
        redirectUri: FIXTURE_CONFIG.redirectUri,
        // No capability => initial connect.
      }),
    );

    // No connection read and no token resolution occurred solely for
    // hinting.
    expect(mockConnectionGet).not.toHaveBeenCalled();
    expect(mockTokenStore.resolve).not.toHaveBeenCalled();

    const url = new URL(response.authorizationUrl);
    expect(url.searchParams.has("login_hint")).toBe(false);
    expect(response.authorizationUrl).not.toContain("login_hint");
  });

  it("publication intent with no durable connection omits login_hint and does not fabricate one", async () => {
    mockConnectionGet.mockResolvedValue({ exists: false });

    const response = await __lmsConnectionsBeginHandler(
      makeRequest({
        providerId: PROVIDER,
        redirectUri: FIXTURE_CONFIG.redirectUri,
        capability: "publication",
      }),
    );

    // The connection was checked, found absent, and no token bundle was
    // resolved. No hint fabricated.
    expect(mockConnectionGet).toHaveBeenCalledTimes(1);
    expect(mockTokenStore.resolve).not.toHaveBeenCalled();

    const url = new URL(response.authorizationUrl);
    expect(url.searchParams.has("login_hint")).toBe(false);
    // Publication scope set still requested normally.
    expect(url.searchParams.get("scope")).toContain(
      "https://www.googleapis.com/auth/classroom.coursework.students",
    );
  });

  it("publication intent with an inactive (revoked) connection omits login_hint", async () => {
    mockConnectionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        teacherId: TEACHER_UID,
        providerId: PROVIDER,
        status: "revoked",
        tokenRef: "tokref-existing",
        scopes: [],
      }),
    });

    const response = await __lmsConnectionsBeginHandler(
      makeRequest({
        providerId: PROVIDER,
        redirectUri: FIXTURE_CONFIG.redirectUri,
        capability: "publication",
      }),
    );

    // A non-active connection carries no identity worth preferring; no
    // bundle resolution, no hint.
    expect(mockTokenStore.resolve).not.toHaveBeenCalled();
    const url = new URL(response.authorizationUrl);
    expect(url.searchParams.has("login_hint")).toBe(false);
  });

  it("publication intent still issues a valid authorization URL when token resolution fails (broken connection is not masked, hint degrades)", async () => {
    mockConnectionGet.mockResolvedValue(activeConnectionSnapshot());
    mockTokenStore.resolve.mockRejectedValue(
      Object.assign(new Error("token bundle unavailable"), {
        code: "lms.tokenNotFound",
      }),
    );

    const response = await __lmsConnectionsBeginHandler(
      makeRequest({
        providerId: PROVIDER,
        redirectUri: FIXTURE_CONFIG.redirectUri,
        capability: "publication",
      }),
    );

    // Resolution was attempted and failed; begin degrades to no hint
    // rather than throwing. The genuinely broken connection is surfaced
    // authoritatively at completion (lms.connectionTokenResolutionFailed),
    // not masked as healthy here.
    expect(mockTokenStore.resolve).toHaveBeenCalledTimes(1);
    const url = new URL(response.authorizationUrl);
    expect(url.searchParams.has("login_hint")).toBe(false);
    // A usable authorization URL and state are still produced.
    expect(url.searchParams.get("state")).toBe(response.state);
    expect(response.state.length).toBeGreaterThan(0);
  });

  it("publication intent with a corrupted bundle (empty upstream identity) omits login_hint and never fabricates one", async () => {
    mockConnectionGet.mockResolvedValue(activeConnectionSnapshot());
    // A valid bundle always carries a non-empty upstream identity; an empty
    // value is a corruption signal, never a legitimate absence. Begin must
    // not invent an identity.
    mockTokenStore.resolve.mockResolvedValue(activeConnectionBundle(""));

    const response = await __lmsConnectionsBeginHandler(
      makeRequest({
        providerId: PROVIDER,
        redirectUri: FIXTURE_CONFIG.redirectUri,
        capability: "publication",
      }),
    );

    const url = new URL(response.authorizationUrl);
    expect(url.searchParams.has("login_hint")).toBe(false);
  });

  // Sprint 26 certification follow-up - Reconnect recovery correction.
  // An explicit reconnect prefers the durable connection identity (so the
  // teacher lands back on the connected account) but requests only the base
  // scope set, never the publication scope. Completion still hard-validates
  // the returned identity, so the hint is steering, not enforcement.
  it("reconnect intent supplies login_hint from the connection identity but requests only base scopes", async () => {
    mockConnectionGet.mockResolvedValue(activeConnectionSnapshot());

    const response = await __lmsConnectionsBeginHandler(
      makeRequest({
        providerId: PROVIDER,
        redirectUri: FIXTURE_CONFIG.redirectUri,
        reconnect: true,
      }),
    );

    // The existing connection was located and its bundle resolved through
    // the approved token-store abstraction, exactly like the publication
    // hint path.
    expect(mockConnectionGet).toHaveBeenCalledTimes(1);
    expect(mockTokenStore.resolve).toHaveBeenCalledTimes(1);
    expect(mockTokenStore.resolve).toHaveBeenCalledWith("tokref-existing");

    const url = new URL(response.authorizationUrl);
    expect(url.searchParams.get("login_hint")).toBe(FIXTURE_UPSTREAM_ACCOUNT_ID);

    // Base scope set only: reconnect restores the base connection. The
    // coursework publication scope is NOT requested.
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).toContain(
      "https://www.googleapis.com/auth/classroom.courses.readonly",
    );
    expect(scope).toContain(
      "https://www.googleapis.com/auth/classroom.rosters.readonly",
    );
    expect(scope).not.toContain(
      "https://www.googleapis.com/auth/classroom.coursework.students",
    );

    // Still a pure read: no token write/rotation/refresh, no connection
    // mutation, and the identifier is never logged or audited by begin.
    expect(mockTokenStore.store).not.toHaveBeenCalled();
    expect(mockTokenStore.revoke).not.toHaveBeenCalled();
    expect(mockConnectionUpdate).not.toHaveBeenCalled();
    expect(mockConnectionSet).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
    const logged = JSON.stringify([
      ...mockLogInfo.mock.calls,
      ...mockLogWarn.mock.calls,
      ...mockLogError.mock.calls,
    ]);
    expect(logged).not.toContain(FIXTURE_UPSTREAM_ACCOUNT_ID);
  });

  it("reconnect intent with no durable connection omits login_hint and still requests base scopes", async () => {
    mockConnectionGet.mockResolvedValue({ exists: false });

    const response = await __lmsConnectionsBeginHandler(
      makeRequest({
        providerId: PROVIDER,
        redirectUri: FIXTURE_CONFIG.redirectUri,
        reconnect: true,
      }),
    );

    expect(mockConnectionGet).toHaveBeenCalledTimes(1);
    expect(mockTokenStore.resolve).not.toHaveBeenCalled();
    const url = new URL(response.authorizationUrl);
    expect(url.searchParams.has("login_hint")).toBe(false);
    expect(url.searchParams.get("scope")).not.toContain(
      "https://www.googleapis.com/auth/classroom.coursework.students",
    );
  });

  it("rejects a reconnect combined with the publication capability", async () => {
    await expect(
      __lmsConnectionsBeginHandler(
        makeRequest({
          providerId: PROVIDER,
          redirectUri: FIXTURE_CONFIG.redirectUri,
          capability: "publication",
          reconnect: true,
        }),
      ),
    ).rejects.toMatchObject({ code: "lms.invalidReconnect" });
    // Contradictory request is refused before any connection lookup.
    expect(mockConnectionGet).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean reconnect selector", async () => {
    await expect(
      __lmsConnectionsBeginHandler(
        makeRequest({
          providerId: PROVIDER,
          redirectUri: FIXTURE_CONFIG.redirectUri,
          reconnect: "yes",
        }),
      ),
    ).rejects.toMatchObject({ code: "lms.invalidReconnect" });
  });
});
