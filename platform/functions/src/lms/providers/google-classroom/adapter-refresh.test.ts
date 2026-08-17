// Sprint 25 credential-refresh lifecycle (PDR-030h). Adapter coverage for
// googleClassroomAdapter.refreshCredential: maps the transport refresh
// response into the vendor-neutral LmsCredentialRefresh, preserves scope and
// refresh-token material by omission, and translates upstream errors into the
// stable PlatformError vocabulary the resolver depends on.
//
// All identifiers are fictional. No real teacher, OAuth credential, or
// LyfeLabz-affiliated identifier is used.

import { PlatformError } from "../../../shared";
import { googleClassroomAdapter } from "./adapter";
import {
  resetGoogleClassroomConfigForTests,
  setGoogleClassroomConfig,
} from "./config";
import {
  FIXTURE_REFRESH_TOKEN,
  FIXTURE_REFRESHED_ACCESS_TOKEN,
  FIXTURE_TOKEN_EXPIRES_IN,
  createFixtureGoogleClassroomTransport,
} from "./__fixtures__/fixture-transport";
import {
  resetGoogleClassroomTransportForTests,
  setGoogleClassroomTransport,
} from "./transport";

const FIXTURE_CONFIG = {
  clientId: "fixture-oauth-client-id",
  clientSecret: "fixture-oauth-client-secret-never-real",
  redirectUri: "https://fixture.example.invalid/lms-callback",
} as const;

function setupFixture(
  options: Parameters<typeof createFixtureGoogleClassroomTransport>[0] = {},
) {
  const transport = createFixtureGoogleClassroomTransport(options);
  setGoogleClassroomTransport(transport);
  setGoogleClassroomConfig(FIXTURE_CONFIG);
  return transport;
}

describe("googleClassroomAdapter.refreshCredential (PDR-030h)", () => {
  afterEach(() => {
    resetGoogleClassroomTransportForTests();
    resetGoogleClassroomConfigForTests();
  });

  it("returns the refreshed access token and expiry", async () => {
    const transport = setupFixture();
    const result = await googleClassroomAdapter.refreshCredential({
      refreshToken: FIXTURE_REFRESH_TOKEN,
    });
    expect(result.accessToken).toBe(FIXTURE_REFRESHED_ACCESS_TOKEN);
    expect(result.expiresInSeconds).toBe(FIXTURE_TOKEN_EXPIRES_IN);
    expect(transport.log().accessTokenRefreshes).toBe(1);
  });

  it("omits scopes so the resolver preserves the existing granted set", async () => {
    setupFixture();
    const result = await googleClassroomAdapter.refreshCredential({
      refreshToken: FIXTURE_REFRESH_TOKEN,
    });
    // Google's refresh response carries a scope string, but a refresh is not
    // an authorization event; the adapter intentionally does not surface it.
    expect(result.scopes).toBeUndefined();
  });

  it("omits a rotated refresh token (Google's refresh grant returns none)", async () => {
    setupFixture();
    const result = await googleClassroomAdapter.refreshCredential({
      refreshToken: FIXTURE_REFRESH_TOKEN,
    });
    expect(result.refreshToken).toBeUndefined();
  });

  it("maps a revoked refresh token (invalid_grant) to lms.upstreamAuthorizationFailed", async () => {
    // A refresh token that does not match the fixture's accepted token
    // reproduces Google's 400 invalid_grant on the token endpoint.
    setupFixture();
    await expect(
      googleClassroomAdapter.refreshCredential({
        refreshToken: "fixture-unknown-refresh-token",
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamAuthorizationFailed" });
  });

  it("maps an upstream 401 to lms.upstreamAuthorizationFailed", async () => {
    setupFixture({ refreshTokenFailureMode: "authorization-failure" });
    await expect(
      googleClassroomAdapter.refreshCredential({
        refreshToken: FIXTURE_REFRESH_TOKEN,
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamAuthorizationFailed" });
  });

  it("maps a transient upstream outage to lms.upstreamTemporarilyUnavailable", async () => {
    setupFixture({ refreshTokenFailureMode: "temporary-unavailable" });
    await expect(
      googleClassroomAdapter.refreshCredential({
        refreshToken: FIXTURE_REFRESH_TOKEN,
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamTemporarilyUnavailable" });
  });

  it("rejects when the transport is unbound", async () => {
    resetGoogleClassroomTransportForTests();
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    await expect(
      googleClassroomAdapter.refreshCredential({
        refreshToken: FIXTURE_REFRESH_TOKEN,
      }),
    ).rejects.toBeInstanceOf(PlatformError);
  });
});
