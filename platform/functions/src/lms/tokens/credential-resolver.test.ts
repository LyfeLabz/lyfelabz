// Sprint 25 credential-refresh lifecycle (PDR-030h). Unit coverage for the
// central resolver `resolveLiveCredential`: refresh policy (comfortably
// valid / near expiry / expired / no refresh material), merge semantics
// delegated to the store, error handling, and structured logging. The token
// store and provider registry are injected so each policy branch is exercised
// in isolation.
//
// All identifiers are fictional.

import { PlatformError, log } from "../../shared";

const mockResolve = jest.fn();
const mockPersist = jest.fn();
const mockGetLmsTokenStore = jest.fn(() => ({
  resolve: mockResolve,
  persistRefreshedCredential: mockPersist,
}));
const mockRefreshCredential = jest.fn();
const mockGetProviderAdapter = jest.fn(() => ({
  refreshCredential: mockRefreshCredential,
}));

jest.mock("./token-store", () => ({
  getLmsTokenStore: () => mockGetLmsTokenStore(),
}));
jest.mock("../providers/registry", () => ({
  getProviderAdapter: () => mockGetProviderAdapter(),
}));

import {
  ACCESS_TOKEN_REFRESH_SKEW_MS,
  resolveLiveCredential,
} from "./credential-resolver";

const TOKEN_REF = "lms_token_fixture_ref";
const HOUR_MS = 60 * 60 * 1000;

function bundle(overrides: Record<string, unknown> = {}) {
  return {
    providerId: "googleClassroom",
    teacherId: "fixture-teacher-001",
    accessToken: "fixture-access-token-stale",
    refreshToken: "fixture-refresh-token",
    scopes: [
      "https://www.googleapis.com/auth/classroom.courses.readonly",
      "https://www.googleapis.com/auth/classroom.coursework.students",
      "https://www.googleapis.com/auth/classroom.rosters.readonly",
      "https://www.googleapis.com/auth/classroom.topics.readonly",
    ],
    expiresAtEpochMs: Date.now() + HOUR_MS,
    upstreamAccountIdentifier: "fixture-upstream-id",
    ...overrides,
  };
}

describe("resolveLiveCredential (PDR-030h)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // The store's merge is exercised in the store's own suite; here the fake
    // persist echoes the refreshed material onto the current bundle so the
    // resolver's own behavior is what is under test.
    mockPersist.mockImplementation(({ refreshed }) =>
      Promise.resolve({ ...bundle(), ...refreshed }),
    );
    mockRefreshCredential.mockResolvedValue({
      accessToken: "fixture-access-token-fresh",
      expiresInSeconds: 3600,
    });
  });

  it("returns a comfortably-valid token without refreshing", async () => {
    const current = bundle({ expiresAtEpochMs: Date.now() + HOUR_MS });
    mockResolve.mockResolvedValue(current);

    const result = await resolveLiveCredential(TOKEN_REF);

    expect(result).toBe(current);
    expect(mockRefreshCredential).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it("returns a token with no recorded expiry without refreshing (legacy shape)", async () => {
    const current = bundle({ expiresAtEpochMs: undefined });
    mockResolve.mockResolvedValue(current);

    const result = await resolveLiveCredential(TOKEN_REF);

    expect(result).toBe(current);
    expect(mockRefreshCredential).not.toHaveBeenCalled();
  });

  it("refreshes a near-expiry token (inside the skew window)", async () => {
    const current = bundle({
      expiresAtEpochMs: Date.now() + ACCESS_TOKEN_REFRESH_SKEW_MS - 1000,
    });
    mockResolve.mockResolvedValue(current);

    const result = await resolveLiveCredential(TOKEN_REF);

    expect(mockRefreshCredential).toHaveBeenCalledWith({
      refreshToken: "fixture-refresh-token",
    });
    expect(result.accessToken).toBe("fixture-access-token-fresh");
  });

  it("refreshes an already-expired token", async () => {
    const current = bundle({ expiresAtEpochMs: Date.now() - 1000 });
    mockResolve.mockResolvedValue(current);

    const result = await resolveLiveCredential(TOKEN_REF);

    expect(mockRefreshCredential).toHaveBeenCalledTimes(1);
    expect(result.accessToken).toBe("fixture-access-token-fresh");
  });

  it("persists the refreshed access token with a computed absolute expiry", async () => {
    const priorExpiry = Date.now() - 1000;
    mockResolve.mockResolvedValue(bundle({ expiresAtEpochMs: priorExpiry }));
    const before = Date.now();

    await resolveLiveCredential(TOKEN_REF);

    expect(mockPersist).toHaveBeenCalledTimes(1);
    const arg = mockPersist.mock.calls[0][0];
    expect(arg.tokenRef).toBe(TOKEN_REF);
    expect(arg.observedExpiresAtEpochMs).toBe(priorExpiry);
    expect(arg.refreshed.accessToken).toBe("fixture-access-token-fresh");
    // expires_in of 3600 -> absolute epoch ~1h out.
    expect(arg.refreshed.expiresAtEpochMs).toBeGreaterThanOrEqual(
      before + 3600 * 1000,
    );
    // The refresh omitted scopes and refresh token; the resolver forwards
    // neither, so the store preserves the existing values.
    expect(arg.refreshed.scopes).toBeUndefined();
    expect(arg.refreshed.refreshToken).toBeUndefined();
  });

  it("does not refresh an expired token that has no refresh material", async () => {
    const current = bundle({
      expiresAtEpochMs: Date.now() - 1000,
      refreshToken: undefined,
    });
    mockResolve.mockResolvedValue(current);

    const result = await resolveLiveCredential(TOKEN_REF);

    // Preserve the explicit-authorization-failure path: hand back the stale
    // token so the upstream call surfaces the normal 401.
    expect(result).toBe(current);
    expect(mockRefreshCredential).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it("maps an unrecoverable refresh (invalid_grant) to lms.reconnectRequired", async () => {
    mockResolve.mockResolvedValue(bundle({ expiresAtEpochMs: Date.now() - 1 }));
    mockRefreshCredential.mockRejectedValue(
      new PlatformError(
        "lms.upstreamAuthorizationFailed",
        "refresh token revoked",
      ),
    );

    await expect(resolveLiveCredential(TOKEN_REF)).rejects.toMatchObject({
      code: "lms.reconnectRequired",
    });
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it("propagates a transient refresh failure verbatim (no reconnect signal)", async () => {
    mockResolve.mockResolvedValue(bundle({ expiresAtEpochMs: Date.now() - 1 }));
    mockRefreshCredential.mockRejectedValue(
      new PlatformError(
        "lms.upstreamTemporarilyUnavailable",
        "google unavailable",
      ),
    );

    await expect(resolveLiveCredential(TOKEN_REF)).rejects.toMatchObject({
      code: "lms.upstreamTemporarilyUnavailable",
    });
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it("wraps a non-PlatformError refresh failure as lms.accessTokenRefreshFailed", async () => {
    mockResolve.mockResolvedValue(bundle({ expiresAtEpochMs: Date.now() - 1 }));
    mockRefreshCredential.mockRejectedValue(new Error("socket hang up"));

    await expect(resolveLiveCredential(TOKEN_REF)).rejects.toMatchObject({
      code: "lms.accessTokenRefreshFailed",
    });
  });

  it("emits refresh-started and refreshed structured logs without token material", async () => {
    const info = jest.spyOn(log, "info").mockImplementation(() => undefined);
    mockResolve.mockResolvedValue(bundle({ expiresAtEpochMs: Date.now() - 1 }));

    await resolveLiveCredential(TOKEN_REF);

    const events = info.mock.calls.map((c) => c[0]);
    expect(events).toContain("lms.accessTokenRefreshStarted");
    expect(events).toContain("lms.accessTokenRefreshed");
    for (const call of info.mock.calls) {
      const serialized = JSON.stringify(call[1]);
      expect(serialized).not.toContain("fixture-refresh-token");
      expect(serialized).not.toContain("fixture-access-token-fresh");
    }
    info.mockRestore();
  });

  it("emits a refresh-failed structured log on an unrecoverable refresh", async () => {
    const warn = jest.spyOn(log, "warn").mockImplementation(() => undefined);
    mockResolve.mockResolvedValue(bundle({ expiresAtEpochMs: Date.now() - 1 }));
    mockRefreshCredential.mockRejectedValue(
      new PlatformError("lms.upstreamAuthorizationFailed", "revoked"),
    );

    await expect(resolveLiveCredential(TOKEN_REF)).rejects.toBeInstanceOf(
      PlatformError,
    );
    const events = warn.mock.calls.map((c) => c[0]);
    expect(events).toContain("lms.accessTokenRefreshFailed");
    warn.mockRestore();
  });
});
