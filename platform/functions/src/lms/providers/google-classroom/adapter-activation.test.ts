// Sprint 23B: Google Classroom adapter activation tests.
//
// Covers the five operations Sprint 23B activated
// (beginOAuth, completeOAuth, revokeGrant, listTeacherClasses,
// fetchClass) plus the transport/config error paths. The tests use
// the in-memory fixture transport and a fixture config to keep every
// case deterministic; no real network call is issued.

import { PlatformError } from "../../../shared";
import { resetLmsOAuthStateStoreForTests } from "../../oauth-state/state-store";

import { googleClassroomAdapter } from "./adapter";
import {
  resetGoogleClassroomConfigForTests,
  setGoogleClassroomConfig,
  type GoogleClassroomConfig,
} from "./config";
import {
  FIXTURE_ACCESS_TOKEN,
  FIXTURE_AUTHORIZATION_CODE,
  FIXTURE_COURSES,
  FIXTURE_FOREIGN_COURSE,
  FIXTURE_REFRESH_TOKEN,
  FIXTURE_REFRESHED_ACCESS_TOKEN,
  FIXTURE_TEACHER_UPSTREAM_ID,
  FIXTURE_TOKEN_EXPIRES_IN,
  createFixtureGoogleClassroomTransport,
} from "./__fixtures__/fixture-transport";
import {
  resetGoogleClassroomTransportForTests,
  setGoogleClassroomTransport,
} from "./transport";

// Sprint 23B security completion: `completeOAuth` requires a live
// OAuth state record issued through `beginOAuth`. Every test that
// exercises `completeOAuth` first calls this helper to obtain a state
// value bound to the fixture teacher and the fixture redirect URI.
async function issueFixtureState(): Promise<string> {
  const authorization = await googleClassroomAdapter.beginOAuth({
    teacherId: "fixture-teacher-id",
    redirectUri: FIXTURE_CONFIG.redirectUri,
  });
  return authorization.state;
}

const FIXTURE_CONFIG: GoogleClassroomConfig = {
  clientId: "fixture-oauth-client-id",
  clientSecret: "fixture-oauth-client-secret-never-real",
  redirectUri: "https://fixture.example.invalid/lms-callback",
};

describe("googleClassroomAdapter Sprint 23B activation", () => {
  afterEach(() => {
    resetGoogleClassroomTransportForTests();
    resetGoogleClassroomConfigForTests();
    resetLmsOAuthStateStoreForTests();
  });

  describe("beginOAuth", () => {
    it("builds an authorization URL that carries clientId, redirect, scopes, and a 32-byte hex state", async () => {
      setGoogleClassroomConfig(FIXTURE_CONFIG);
      setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
      const authorization = await googleClassroomAdapter.beginOAuth({
        teacherId: "fixture-teacher-id",
        redirectUri: FIXTURE_CONFIG.redirectUri,
      });
      const url = new URL(authorization.authorizationUrl);
      expect(url.origin + url.pathname).toBe(
        "https://accounts.google.com/o/oauth2/v2/auth",
      );
      expect(url.searchParams.get("client_id")).toBe(FIXTURE_CONFIG.clientId);
      expect(url.searchParams.get("redirect_uri")).toBe(
        FIXTURE_CONFIG.redirectUri,
      );
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("access_type")).toBe("offline");
      expect(url.searchParams.get("prompt")).toBe("consent");
      expect(url.searchParams.get("include_granted_scopes")).toBe("true");
      expect(url.searchParams.get("scope")).toBe(
        [
          "https://www.googleapis.com/auth/classroom.courses.readonly",
          "https://www.googleapis.com/auth/classroom.rosters.readonly",
        ].join(" "),
      );
      expect(authorization.state).toMatch(/^[0-9a-f]{64}$/);
      expect(url.searchParams.get("state")).toBe(authorization.state);
    });

    it("prefers the request-supplied redirectUri over the configured default", async () => {
      setGoogleClassroomConfig(FIXTURE_CONFIG);
      setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
      const overrideUri = "https://fixture.example.invalid/other-callback";
      const authorization = await googleClassroomAdapter.beginOAuth({
        teacherId: "fixture-teacher-id",
        redirectUri: overrideUri,
      });
      const url = new URL(authorization.authorizationUrl);
      expect(url.searchParams.get("redirect_uri")).toBe(overrideUri);
    });

    it("mints a fresh state on every call", async () => {
      setGoogleClassroomConfig(FIXTURE_CONFIG);
      setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
      const a = await googleClassroomAdapter.beginOAuth({
        teacherId: "fixture-teacher-id",
        redirectUri: FIXTURE_CONFIG.redirectUri,
      });
      const b = await googleClassroomAdapter.beginOAuth({
        teacherId: "fixture-teacher-id",
        redirectUri: FIXTURE_CONFIG.redirectUri,
      });
      expect(a.state).not.toBe(b.state);
    });

    it("surfaces googleClassroomConfigUnbound when the config seam is not installed", async () => {
      let observed: unknown;
      try {
        await googleClassroomAdapter.beginOAuth({
          teacherId: "fixture-teacher-id",
          redirectUri: FIXTURE_CONFIG.redirectUri,
        });
      } catch (err) {
        observed = err;
      }
      expect(observed).toBeInstanceOf(PlatformError);
      expect((observed as PlatformError).code).toBe(
        "lms.googleClassroomConfigUnbound",
      );
    });

    it("surfaces a missing clientId with a stable PlatformError code", async () => {
      setGoogleClassroomConfig({ ...FIXTURE_CONFIG, clientId: "" });
      setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
      await expect(
        googleClassroomAdapter.beginOAuth({
          teacherId: "fixture-teacher-id",
          redirectUri: FIXTURE_CONFIG.redirectUri,
        }),
      ).rejects.toMatchObject({
        code: "lms.googleClassroomConfigMissingClientId",
      });
    });
  });

  describe("completeOAuth", () => {
    it("exchanges an authorization code and returns a grant with upstream identity", async () => {
      setGoogleClassroomConfig(FIXTURE_CONFIG);
      const transport = createFixtureGoogleClassroomTransport();
      setGoogleClassroomTransport(transport);
      const state = await issueFixtureState();
      const grant = await googleClassroomAdapter.completeOAuth({
        code: FIXTURE_AUTHORIZATION_CODE,
        state,
        redirectUri: FIXTURE_CONFIG.redirectUri,
      });
      expect(grant.accessToken).toBe(FIXTURE_ACCESS_TOKEN);
      expect(grant.refreshToken).toBe(FIXTURE_REFRESH_TOKEN);
      expect(grant.expiresInSeconds).toBe(FIXTURE_TOKEN_EXPIRES_IN);
      expect(grant.upstreamAccountIdentifier).toBe(FIXTURE_TEACHER_UPSTREAM_ID);
      expect(grant.scopes).toEqual([
        "https://www.googleapis.com/auth/classroom.courses.readonly",
        "https://www.googleapis.com/auth/classroom.rosters.readonly",
      ]);
      const log = transport.log();
      expect(log.authorizationCodeExchanges).toBe(1);
      expect(log.userProfileMeCalls).toBe(1);
    });

    it("translates invalid_grant into lms.upstreamAuthorizationFailed", async () => {
      setGoogleClassroomConfig(FIXTURE_CONFIG);
      setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
      const state = await issueFixtureState();
      await expect(
        googleClassroomAdapter.completeOAuth({
          code: "fixture-wrong-code",
          state,
          redirectUri: FIXTURE_CONFIG.redirectUri,
        }),
      ).rejects.toMatchObject({
        code: "lms.upstreamAuthorizationFailed",
      });
    });

    it("translates a 401 authorization-failure into lms.upstreamAuthorizationFailed", async () => {
      setGoogleClassroomConfig(FIXTURE_CONFIG);
      // beginOAuth must issue state through the seams that are NOT
      // in authorization-failure mode; install the failure transport
      // only for the code-exchange step. beginOAuth does not touch
      // the transport, so switching it afterwards is safe.
      setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
      const state = await issueFixtureState();
      setGoogleClassroomTransport(
        createFixtureGoogleClassroomTransport({
          failureMode: "authorization-failure",
        }),
      );
      await expect(
        googleClassroomAdapter.completeOAuth({
          code: FIXTURE_AUTHORIZATION_CODE,
          state,
          redirectUri: FIXTURE_CONFIG.redirectUri,
        }),
      ).rejects.toMatchObject({
        code: "lms.upstreamAuthorizationFailed",
      });
    });

    it("translates a 503 into lms.upstreamTemporarilyUnavailable", async () => {
      setGoogleClassroomConfig(FIXTURE_CONFIG);
      setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
      const state = await issueFixtureState();
      setGoogleClassroomTransport(
        createFixtureGoogleClassroomTransport({
          failureMode: "temporary-unavailable",
        }),
      );
      await expect(
        googleClassroomAdapter.completeOAuth({
          code: FIXTURE_AUTHORIZATION_CODE,
          state,
          redirectUri: FIXTURE_CONFIG.redirectUri,
        }),
      ).rejects.toMatchObject({
        code: "lms.upstreamTemporarilyUnavailable",
      });
    });

    it("surfaces the transport unbound sentinel when no transport is installed", async () => {
      setGoogleClassroomConfig(FIXTURE_CONFIG);
      // Install a working transport to issue state, then remove it so
      // the completion path observes the unbound sentinel. beginOAuth
      // does not touch the transport, so any transport is acceptable.
      setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
      const state = await issueFixtureState();
      resetGoogleClassroomTransportForTests();
      await expect(
        googleClassroomAdapter.completeOAuth({
          code: FIXTURE_AUTHORIZATION_CODE,
          state,
          redirectUri: FIXTURE_CONFIG.redirectUri,
        }),
      ).rejects.toMatchObject({
        code: "lms.googleClassroomTransportUnbound",
      });
    });
  });

  describe("revokeGrant", () => {
    it("revokes the refresh token when supplied", async () => {
      setGoogleClassroomConfig(FIXTURE_CONFIG);
      const transport = createFixtureGoogleClassroomTransport();
      setGoogleClassroomTransport(transport);
      await googleClassroomAdapter.revokeGrant({
        accessToken: FIXTURE_ACCESS_TOKEN,
        refreshToken: FIXTURE_REFRESH_TOKEN,
      });
      const log = transport.log();
      expect(log.tokenRevocations).toBe(1);
      expect(log.revokedTokens).toEqual([FIXTURE_REFRESH_TOKEN]);
    });

    it("falls back to the access token when no refresh token is supplied", async () => {
      setGoogleClassroomConfig(FIXTURE_CONFIG);
      const transport = createFixtureGoogleClassroomTransport();
      setGoogleClassroomTransport(transport);
      await googleClassroomAdapter.revokeGrant({
        accessToken: FIXTURE_ACCESS_TOKEN,
      });
      const log = transport.log();
      expect(log.revokedTokens).toEqual([FIXTURE_ACCESS_TOKEN]);
    });

    it("translates a 401 upstream failure into lms.upstreamAuthorizationFailed", async () => {
      setGoogleClassroomConfig(FIXTURE_CONFIG);
      setGoogleClassroomTransport(
        createFixtureGoogleClassroomTransport({
          failureMode: "authorization-failure",
        }),
      );
      await expect(
        googleClassroomAdapter.revokeGrant({
          accessToken: FIXTURE_ACCESS_TOKEN,
          refreshToken: FIXTURE_REFRESH_TOKEN,
        }),
      ).rejects.toMatchObject({
        code: "lms.upstreamAuthorizationFailed",
      });
    });
  });

  describe("listTeacherClasses", () => {
    it("aggregates paginated fixture courses into a single discovery list", async () => {
      setGoogleClassroomConfig(FIXTURE_CONFIG);
      const transport = createFixtureGoogleClassroomTransport();
      setGoogleClassroomTransport(transport);
      const discovered = await googleClassroomAdapter.listTeacherClasses({
        accessToken: FIXTURE_ACCESS_TOKEN,
      });
      expect(discovered.length).toBe(FIXTURE_COURSES.length);
      const expectedIds = FIXTURE_COURSES.map((c) => c.id).sort();
      const actualIds = discovered.map((c) => c.lmsClassId).sort();
      expect(actualIds).toEqual(expectedIds);
      const log = transport.log();
      // Fixture page size is 2 and there are 3 courses; adapter should
      // request at least two pages.
      expect(log.courseListCalls).toBeGreaterThanOrEqual(2);
    });

    it("carries upstream owner identifier through the discovery boundary", async () => {
      setGoogleClassroomConfig(FIXTURE_CONFIG);
      setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
      const discovered = await googleClassroomAdapter.listTeacherClasses({
        accessToken: FIXTURE_ACCESS_TOKEN,
      });
      for (const c of discovered) {
        expect(c.ownerUpstreamAccountIdentifier).toBe(
          FIXTURE_TEACHER_UPSTREAM_ID,
        );
      }
    });

    it("translates upstream authorization failure into lms.upstreamAuthorizationFailed", async () => {
      setGoogleClassroomConfig(FIXTURE_CONFIG);
      setGoogleClassroomTransport(
        createFixtureGoogleClassroomTransport({
          failureMode: "authorization-failure",
        }),
      );
      await expect(
        googleClassroomAdapter.listTeacherClasses({
          accessToken: FIXTURE_ACCESS_TOKEN,
        }),
      ).rejects.toMatchObject({
        code: "lms.upstreamAuthorizationFailed",
      });
    });

    it("translates upstream 429 into lms.upstreamTemporarilyUnavailable", async () => {
      setGoogleClassroomConfig(FIXTURE_CONFIG);
      setGoogleClassroomTransport(
        createFixtureGoogleClassroomTransport({
          failureMode: "rate-limited",
        }),
      );
      await expect(
        googleClassroomAdapter.listTeacherClasses({
          accessToken: FIXTURE_ACCESS_TOKEN,
        }),
      ).rejects.toMatchObject({
        code: "lms.upstreamTemporarilyUnavailable",
      });
    });
  });

  describe("fetchClass", () => {
    it("returns the discovered class for a valid course id", async () => {
      setGoogleClassroomConfig(FIXTURE_CONFIG);
      setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
      const course = FIXTURE_COURSES[0];
      const discovered = await googleClassroomAdapter.fetchClass({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: course.id,
      });
      expect(discovered.lmsClassId).toBe(course.id);
      expect(discovered.name).toBe(course.name);
      expect(discovered.ownerUpstreamAccountIdentifier).toBe(course.ownerId);
    });

    it("still exposes a foreign-owned course; ownership is enforced above the adapter", async () => {
      setGoogleClassroomConfig(FIXTURE_CONFIG);
      setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
      const foreign = await googleClassroomAdapter.fetchClass({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: FIXTURE_FOREIGN_COURSE.id,
      });
      // The adapter faithfully reports the upstream owner. The import
      // callable (classes-import.ts) is where ownership is enforced
      // against the calling teacher.
      expect(foreign.ownerUpstreamAccountIdentifier).toBe(
        FIXTURE_FOREIGN_COURSE.ownerId,
      );
    });

    it("translates 404 into lms.upstreamResourceNotFound", async () => {
      setGoogleClassroomConfig(FIXTURE_CONFIG);
      setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
      await expect(
        googleClassroomAdapter.fetchClass({
          accessToken: FIXTURE_ACCESS_TOKEN,
          lmsClassId: "fixture-course-does-not-exist",
        }),
      ).rejects.toMatchObject({
        code: "lms.upstreamResourceNotFound",
      });
    });
  });

  describe("token refresh transport surface", () => {
    it("returns a refreshed access token on the accepted refresh token", async () => {
      setGoogleClassroomConfig(FIXTURE_CONFIG);
      const transport = createFixtureGoogleClassroomTransport();
      setGoogleClassroomTransport(transport);
      const refreshed = await transport.refreshAccessToken({
        refreshToken: FIXTURE_REFRESH_TOKEN,
      });
      expect(refreshed.access_token).toBe(FIXTURE_REFRESHED_ACCESS_TOKEN);
      expect(refreshed.token_type).toBe("Bearer");
    });

    it("rejects an expired / mismatched refresh token with invalid_grant", async () => {
      setGoogleClassroomConfig(FIXTURE_CONFIG);
      const transport = createFixtureGoogleClassroomTransport();
      setGoogleClassroomTransport(transport);
      await expect(
        transport.refreshAccessToken({
          refreshToken: "fixture-wrong-refresh-token",
        }),
      ).rejects.toMatchObject({
        errorCode: "invalid_grant",
      });
    });
  });
});
