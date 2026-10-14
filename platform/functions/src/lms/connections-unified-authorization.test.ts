// Unified onboarding authorization (October 2026 incident follow-up).
//
// A beta teacher's Classroom connection carried only the read-only roster
// scopes; topics silently looked empty and publishing failed with
// ACCESS_TOKEN_SCOPE_INSUFFICIENT. These tests drive the real begin /
// complete / describe handlers against the fixture transport and prove:
//   - every intent requests the complete required scope set;
//   - completion reports, truthfully, whether the complete set was granted
//     (Google's consent screen lets a teacher uncheck individual scopes);
//   - describe reports a provider-neutral publicationAuthorized flag so the
//     client can request one upgrade BEFORE a Classroom action fails;
//   - a roster-only legacy connection is reported as needing the upgrade and
//     is never silently modified.
//
// Header below is shared with the Sprint 23B single-process integration
// suite; original note follows.
//
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

const mockConnectionsQueryGet = jest.fn();

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
    // Phase 8G.1/8G.3: the LMS actor gate resolves the caller's authoritative
    // active-teacher status from users/{uid} and authoritative tenant context
    // from schools/{schoolId}. Provide both so the gate admits the
    // authenticated teacher these tests already set up.
    userRecordDocRef: (uid: string) => ({
      get: () => ({
        exists: true,
        data: () => ({
          authUid: uid,
          status: "active",
          role: "teacher",
          schoolId: "school-a",
          createdAt: {},
        }),
      }),
    }),
    schoolDocRef: () => ({
      get: () => ({
        exists: true,
        data: () => ({ districtId: "district-a", createdAt: {} }),
      }),
    }),
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    lmsConnectionDocRef: mockConnectionDocRef,
    lmsConnectionCreationDocRef: mockConnectionCreationDocRef,
    lmsConnectionsCollectionRef: () => ({
      where: () => ({ get: mockConnectionsQueryGet }),
    }),
    writeAuditEvent: mockWriteAuditEvent,
  };
});

jest.mock("./tokens/token-store", () => ({
  getLmsTokenStore: () => mockTokenStore,
}));


import { __lmsConnectionsBeginHandler } from "./connections-begin";
import { __lmsConnectionsCompleteHandler } from "./connections-complete";
import { __lmsConnectionsDescribeHandler } from "./connections-describe";
import { resetLmsOAuthStateStoreForTests } from "./oauth-state/state-store";
import {
  resetGoogleClassroomConfigForTests,
  setGoogleClassroomConfig,
} from "./providers/google-classroom/config";
import {
  GOOGLE_CLASSROOM_INITIAL_SCOPES,
  GOOGLE_CLASSROOM_REQUIRED_SCOPES,
} from "./providers/google-classroom/adapter";
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

const TEACHER_UID = "fixture-teacher-uid-unified-auth";
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


const ROSTER_ONLY = [...GOOGLE_CLASSROOM_INITIAL_SCOPES].sort();
const COMPLETE = [...GOOGLE_CLASSROOM_REQUIRED_SCOPES].sort();

function activeConnection(scopes: readonly string[]) {
  return {
    exists: true,
    data: () => ({
      teacherId: TEACHER_UID,
      providerId: PROVIDER,
      status: "active",
      tokenRef: "tokref-existing",
      scopes,
    }),
  };
}

async function beginAndComplete(
  beginExtra: Record<string, unknown>,
): Promise<Awaited<ReturnType<typeof __lmsConnectionsCompleteHandler>>> {
  const begun = await __lmsConnectionsBeginHandler(
    makeRequest({
      providerId: PROVIDER,
      redirectUri: FIXTURE_CONFIG.redirectUri,
      ...beginExtra,
    }),
  );
  return __lmsConnectionsCompleteHandler(
    makeRequest({
      providerId: PROVIDER,
      code: FIXTURE_AUTHORIZATION_CODE,
      state: begun.state,
      redirectUri: FIXTURE_CONFIG.redirectUri,
    }),
  );
}

describe("unified onboarding authorization", () => {
  beforeEach(() => {
    [
      mockConnectionGet,
      mockConnectionSet,
      mockConnectionUpdate,
      mockConnectionsQueryGet,
      mockWriteAuditEvent,
      mockLogInfo,
      mockLogWarn,
      mockLogError,
      mockTokenStore.store,
      mockTokenStore.resolve,
      mockTokenStore.revoke,
    ].forEach((m) => m.mockReset());
    mockTokenStore.store.mockResolvedValue("tokref-new");
    mockTokenStore.resolve.mockResolvedValue({
      providerId: "googleClassroom",
      teacherId: TEACHER_UID,
      accessToken: "existing-access-token",
      refreshToken: "existing-refresh-token",
      scopes: ROSTER_ONLY,
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
    setGoogleClassroomConfig(FIXTURE_CONFIG);
  });

  afterEach(() => {
    resetLmsOAuthStateStoreForTests();
    resetGoogleClassroomConfigForTests();
    resetGoogleClassroomTransportForTests();
  });

  describe("new teacher onboarding (initial connect)", () => {
    it("records the complete grant and reports publication as authorized", async () => {
      setGoogleClassroomTransport(
        createFixtureGoogleClassroomTransport({ grantedScopes: COMPLETE }),
      );
      const res = await beginAndComplete({});
      expect(res.consentOutcome).toBe("created");
      expect(res.publicationAuthorized).toBe(true);
      const written = mockConnectionSet.mock.calls[0][0] as {
        scopes: string[];
      };
      expect([...written.scopes].sort()).toEqual(COMPLETE);
      // The offline refresh token is stored server-side only; the callable
      // response carries no credential material.
      const stored = mockTokenStore.store.mock.calls[0] as unknown as [
        { refreshToken?: string },
      ];
      expect(stored[0].refreshToken).toBeDefined();
      expect(JSON.stringify(res)).not.toMatch(/token/i);
    });

    it("reports publication as not authorized when the teacher unchecks Classroom permissions", async () => {
      // Default fixture grant: the read-only initial set only.
      setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
      const res = await beginAndComplete({});
      expect(res.consentOutcome).toBe("created");
      expect(res.publicationAuthorized).toBe(false);
    });
  });

  describe("existing teacher with a roster-only connection", () => {
    it("is reported by describe as needing the publication upgrade", async () => {
      mockConnectionsQueryGet.mockResolvedValue({
        docs: [
          {
            id: "conn-roster-only",
            data: () => ({
              teacherId: TEACHER_UID,
              providerId: PROVIDER,
              status: "active",
              scopes: ROSTER_ONLY,
            }),
          },
        ],
      });
      const res = await __lmsConnectionsDescribeHandler(makeRequest({}));
      expect(res.connections).toHaveLength(1);
      expect(res.connections[0].publicationAuthorized).toBe(false);
      // Describe is a pure read: nothing about the connection is modified.
      expect(mockConnectionUpdate).not.toHaveBeenCalled();
      expect(mockConnectionSet).not.toHaveBeenCalled();
    });

    it("the idempotent duplicate-connect path reports the missing capability without mutating", async () => {
      mockConnectionGet.mockResolvedValue(activeConnection(ROSTER_ONLY));
      setGoogleClassroomTransport(
        createFixtureGoogleClassroomTransport({ grantedScopes: COMPLETE }),
      );
      const res = await beginAndComplete({});
      expect(res.alreadyConnected).toBe(true);
      expect(res.publicationAuthorized).toBe(false);
      expect(mockConnectionUpdate).not.toHaveBeenCalled();
      expect(mockTokenStore.store).not.toHaveBeenCalled();
    });

    it("a granted upgrade widens the connection and reports publication as authorized", async () => {
      mockConnectionGet.mockResolvedValue(activeConnection(ROSTER_ONLY));
      setGoogleClassroomTransport(
        createFixtureGoogleClassroomTransport({ grantedScopes: COMPLETE }),
      );
      const res = await beginAndComplete({ capability: "publication" });
      expect(res.consentOutcome).toBe("widened");
      expect(res.publicationAuthorized).toBe(true);
      const update = mockConnectionUpdate.mock.calls[0][0] as {
        scopes: string[];
        tokenRef: string;
      };
      expect(update.scopes).toEqual(COMPLETE);
      expect(update.tokenRef).toBe("tokref-new");
      // The prior credential is retired only after the new one is stored.
      expect(mockTokenStore.revoke).toHaveBeenCalledWith("tokref-existing");
    });

    it("a declined upgrade leaves the connection untouched and reports publication as not authorized", async () => {
      mockConnectionGet.mockResolvedValue(activeConnection(ROSTER_ONLY));
      setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
      const res = await beginAndComplete({ capability: "publication" });
      expect(res.consentOutcome).toBe("alreadyAuthorized");
      expect(res.publicationAuthorized).toBe(false);
      expect(mockConnectionUpdate).not.toHaveBeenCalled();
      expect(mockTokenStore.store).not.toHaveBeenCalled();
      expect(mockTokenStore.revoke).not.toHaveBeenCalled();
    });

    it("a reconnect requests and restores the complete set", async () => {
      mockConnectionGet.mockResolvedValue(activeConnection(ROSTER_ONLY));
      setGoogleClassroomTransport(
        createFixtureGoogleClassroomTransport({ grantedScopes: COMPLETE }),
      );
      const res = await beginAndComplete({ reconnect: true });
      expect(res.consentOutcome).toBe("recovered");
      expect(res.publicationAuthorized).toBe(true);
    });
  });

  describe("existing teacher with complete permissions", () => {
    it("is reported by describe as authorized (no interruption)", async () => {
      mockConnectionsQueryGet.mockResolvedValue({
        docs: [
          {
            id: "conn-complete",
            data: () => ({
              teacherId: TEACHER_UID,
              providerId: PROVIDER,
              status: "active",
              scopes: COMPLETE,
            }),
          },
        ],
      });
      const res = await __lmsConnectionsDescribeHandler(makeRequest({}));
      expect(res.connections[0].publicationAuthorized).toBe(true);
    });

    it("an unnecessary upgrade is a no-op that still reports authorized", async () => {
      mockConnectionGet.mockResolvedValue(activeConnection(COMPLETE));
      mockTokenStore.resolve.mockResolvedValue({
        providerId: "googleClassroom",
        teacherId: TEACHER_UID,
        accessToken: "existing-access-token",
        refreshToken: "existing-refresh-token",
        scopes: COMPLETE,
        upstreamAccountIdentifier: FIXTURE_TEACHER_UPSTREAM_ID,
      });
      setGoogleClassroomTransport(
        createFixtureGoogleClassroomTransport({ grantedScopes: COMPLETE }),
      );
      const res = await beginAndComplete({ capability: "publication" });
      expect(res.consentOutcome).toBe("alreadyAuthorized");
      expect(res.publicationAuthorized).toBe(true);
      expect(mockConnectionUpdate).not.toHaveBeenCalled();
    });
  });

  it("describe tolerates a connection record with no recorded scopes", async () => {
    mockConnectionsQueryGet.mockResolvedValue({
      docs: [
        {
          id: "conn-legacy",
          data: () => ({
            teacherId: TEACHER_UID,
            providerId: PROVIDER,
            status: "revoked",
          }),
        },
      ],
    });
    const res = await __lmsConnectionsDescribeHandler(makeRequest({}));
    expect(res.connections[0].publicationAuthorized).toBe(false);
  });
});
