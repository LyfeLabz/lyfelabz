// Callable tests for lmsClassesListTopics.
//
// Sprint 25 B9 certification finding (Part 4A): this callable reaches the
// upstream Google Classroom provider via adapter.listClassTopics, so it must
// independently install the production config/transport bindings at handler
// entry and declare googleClassroomProductionSecrets on the callable. Before
// the fix it did neither, so in production the transport was unbound unless a
// sibling callable had already bound it in the same worker.
//
// The provider adapter and token store are mocked; these tests exercise the
// callable's binding contract, auth/validation ordering, response projection,
// and the fact that a bound-transport upstream error (insufficient scope)
// surfaces as itself rather than as a transport-unbound error. Every
// identifier is fictional.

import type { CallableRequest } from "firebase-functions/v2/https";

const mockLinkGet = jest.fn();
const mockConnectionGet = jest.fn();
const mockGetLmsTokenStore = jest.fn();
const mockGetProviderAdapter = jest.fn();
const mockAssertAuthenticatedTeacherForLms = jest.fn();
const mockRequireNonEmptyString = jest.fn();
const mockEnsureBindings = jest.fn();
// Plain holder (not a jest.fn) so the module-load capture survives
// beforeEach's jest.clearAllMocks().
const mockCapturedCallableOptions: { value?: unknown } = {};

jest.mock("firebase-functions/v2/https", () => ({
  onCall: <T,>(_options: unknown, handler: T) => handler,
}));

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    platformCallable: (optionsOrHandler: unknown, maybeHandler: unknown) => {
      if (typeof optionsOrHandler === "function") return optionsOrHandler;
      mockCapturedCallableOptions.value = optionsOrHandler;
      return maybeHandler;
    },
    PlatformError,
    lmsClassLinkDocRef: jest.fn(() => ({ get: mockLinkGet })),
    lmsConnectionDocRef: jest.fn(() => ({ get: mockConnectionGet })),
  };
});

jest.mock("./providers/google-classroom/config-firebase", () => ({
  ensureGoogleClassroomProductionBindings: () => mockEnsureBindings(),
  googleClassroomProductionSecrets: ["__gc_secret_sentinel__"] as const,
}));

jest.mock("./shared/actor", () => ({
  assertAuthenticatedTeacherForLms: mockAssertAuthenticatedTeacherForLms,
  requireNonEmptyString: mockRequireNonEmptyString,
}));

jest.mock("./tokens/token-store", () => ({
  getLmsTokenStore: mockGetLmsTokenStore,
}));

jest.mock("./providers/registry", () => ({
  getProviderAdapter: mockGetProviderAdapter,
}));

import { PlatformError } from "../shared/errors/platform-error";
import { __lmsClassesListTopicsHandler } from "./classes-list-topics";

const FIXTURE_UID = "fixture-teacher-uid-001";
const FIXTURE_SCHOOL_ID = "fixture-school-001";
const FIXTURE_DISTRICT_ID = "fixture-district-001";
const FIXTURE_LINK_ID = "fixture-link-id-001";
const FIXTURE_CONNECTION_ID = "fixture-connection-id-001";
const FIXTURE_PROVIDER_ID = "googleClassroom";
const FIXTURE_LMS_CLASS_ID = "fixture-lms-class-id-001";
const FIXTURE_ACCESS_TOKEN = "fixture-access-token-redacted";

const FIXTURE_ACTOR = {
  uid: FIXTURE_UID,
  schoolId: FIXTURE_SCHOOL_ID,
  districtId: FIXTURE_DISTRICT_ID,
};

function makeRequest(
  overrides: Partial<Record<string, unknown>> = {},
): CallableRequest<unknown> {
  return {
    auth: { uid: FIXTURE_UID, token: { schoolId: FIXTURE_SCHOOL_ID } as never },
    data: { linkId: FIXTURE_LINK_ID, ...overrides },
    rawRequest: {} as never,
    acceptsStreaming: false,
  } as unknown as CallableRequest<unknown>;
}

function makeLinkDoc(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      ownerUid: FIXTURE_UID,
      status: "linked",
      connectionId: FIXTURE_CONNECTION_ID,
      lmsClassId: FIXTURE_LMS_CLASS_ID,
      ...overrides,
    }),
  };
}

function makeConnectionDoc(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      teacherId: FIXTURE_UID,
      status: "active",
      providerId: FIXTURE_PROVIDER_ID,
      tokenRef: "fixture-token-ref",
      ...overrides,
    }),
  };
}

function setupHappyPath(
  listClassTopics: jest.Mock = jest
    .fn()
    .mockResolvedValue([
      { lmsTopicId: "fixture-topic-intro", name: "Fictional Topic - Intro" },
    ]),
) {
  mockAssertAuthenticatedTeacherForLms.mockReturnValue(FIXTURE_ACTOR);
  mockRequireNonEmptyString.mockImplementation((v: unknown) => {
    if (typeof v !== "string" || v.trim().length === 0) {
      throw new PlatformError("lms.invalid", "bad string");
    }
    return v.trim();
  });
  mockLinkGet.mockResolvedValue(makeLinkDoc());
  mockConnectionGet.mockResolvedValue(makeConnectionDoc());
  mockGetLmsTokenStore.mockReturnValue({
    resolve: jest.fn().mockResolvedValue({ accessToken: FIXTURE_ACCESS_TOKEN }),
  });
  mockGetProviderAdapter.mockReturnValue({ listClassTopics });
  return listClassTopics;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("lmsClassesListTopics production-binding contract (Sprint 25 B9)", () => {
  it("declares the Google Classroom production secrets on the callable", () => {
    // Captured at module load. The sentinel proves the value came from
    // config-firebase's googleClassroomProductionSecrets.
    expect(mockCapturedCallableOptions.value).toEqual({
      secrets: ["__gc_secret_sentinel__"],
    });
  });

  it("installs the production bindings at handler entry before any upstream work", async () => {
    setupHappyPath();
    await __lmsClassesListTopicsHandler(makeRequest());
    expect(mockEnsureBindings).toHaveBeenCalledTimes(1);
    const ensureOrder = mockEnsureBindings.mock.invocationCallOrder[0];
    const adapterOrder = mockGetProviderAdapter.mock.invocationCallOrder[0];
    expect(ensureOrder).toBeLessThan(adapterOrder);
  });
});

describe("lmsClassesListTopics callable", () => {
  it("returns the projected topics for a linked class", async () => {
    setupHappyPath(
      jest.fn().mockResolvedValue([
        { lmsTopicId: "t-1", name: "Topic One" },
        { lmsTopicId: "t-2", name: "Topic Two" },
      ]),
    );
    const result = await __lmsClassesListTopicsHandler(makeRequest());
    expect(result.topics).toEqual([
      { lmsTopicId: "t-1", name: "Topic One" },
      { lmsTopicId: "t-2", name: "Topic Two" },
    ]);
  });

  it("surfaces a bound-transport insufficient-scope error as itself, not as transport-unbound", async () => {
    // With bindings installed and a bound adapter, a readonly-only token
    // shortfall must reach the callable as lms.insufficientScope rather than
    // lms.googleClassroomTransportUnbound.
    setupHappyPath(
      jest
        .fn()
        .mockRejectedValue(
          new PlatformError(
            "lms.insufficientScope",
            "Topics require additional OAuth consent.",
          ),
        ),
    );
    const error = await __lmsClassesListTopicsHandler(makeRequest()).then(
      () => {
        throw new Error("handler should have rejected");
      },
      (e: unknown) => e as { code?: string },
    );
    expect(error.code).toBe("lms.insufficientScope");
    expect(error.code).not.toBe("lms.googleClassroomTransportUnbound");
  });

  it("does not expose the access token in the response", async () => {
    setupHappyPath();
    const result = await __lmsClassesListTopicsHandler(makeRequest());
    expect(JSON.stringify(result)).not.toContain(FIXTURE_ACCESS_TOKEN);
  });

  it("refreshes an expired token before listing topics and calls the adapter with the fresh token (PDR-030h)", async () => {
    mockAssertAuthenticatedTeacherForLms.mockReturnValue(FIXTURE_ACTOR);
    mockRequireNonEmptyString.mockImplementation((v: unknown) => {
      if (typeof v !== "string" || v.trim().length === 0) {
        throw new PlatformError("lms.invalid", "bad string");
      }
      return v.trim();
    });
    mockLinkGet.mockResolvedValue(makeLinkDoc());
    mockConnectionGet.mockResolvedValue(makeConnectionDoc());

    const FRESH_TOKEN = "fixture-access-token-fresh";
    const listClassTopics = jest
      .fn()
      .mockResolvedValue([{ lmsTopicId: "t-1", name: "Topic One" }]);
    const refreshCredential = jest.fn().mockResolvedValue({
      accessToken: FRESH_TOKEN,
      expiresInSeconds: 3600,
    });
    const persist = jest.fn().mockResolvedValue({
      providerId: FIXTURE_PROVIDER_ID,
      teacherId: FIXTURE_UID,
      accessToken: FRESH_TOKEN,
      refreshToken: "fixture-refresh-token",
      scopes: ["scope.a"],
      expiresAtEpochMs: Date.now() + 3600 * 1000,
      upstreamAccountIdentifier: "fixture-upstream-id",
    });
    mockGetLmsTokenStore.mockReturnValue({
      resolve: jest.fn().mockResolvedValue({
        providerId: FIXTURE_PROVIDER_ID,
        teacherId: FIXTURE_UID,
        accessToken: "fixture-access-token-stale",
        refreshToken: "fixture-refresh-token",
        scopes: ["scope.a"],
        expiresAtEpochMs: Date.now() - 1000,
        upstreamAccountIdentifier: "fixture-upstream-id",
      }),
      persistRefreshedCredential: persist,
    });
    mockGetProviderAdapter.mockReturnValue({ refreshCredential, listClassTopics });

    await __lmsClassesListTopicsHandler(makeRequest());

    expect(refreshCredential).toHaveBeenCalledTimes(1);
    expect(listClassTopics.mock.calls[0][0].accessToken).toBe(FRESH_TOKEN);
  });
});
