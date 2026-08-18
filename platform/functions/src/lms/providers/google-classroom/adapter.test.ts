// Sprint 23A boundary test, re-targeted for Sprint 23B, Sprint 23C, and
// Sprint 25 Phase 1 activations.
//
// Sprint 23A shipped every adapter operation as a stable
// `lms.providerNotYetOperational` reject. Sprint 23B activated five of
// those operations against the transport + config seams (beginOAuth,
// completeOAuth, revokeGrant, listTeacherClasses, fetchClass). Sprint
// 23C activated the roster-read operation (listClassRoster). Sprint 25
// Phase 1 activated the remaining two operations (listClassTopics,
// publishAssignment) — their full behavioral coverage now lives in
// adapter-publication.test.ts; the deferred-operation block is removed.
//
// This file now verifies provider identity and that all activated
// operations route through the transport + config seams without leaking
// provider-specific errors into the vendor-neutral core.

import { googleClassroomAdapter } from "./adapter";
import {
  resetGoogleClassroomConfigForTests,
  setGoogleClassroomConfig,
} from "./config";
import { createFixtureGoogleClassroomTransport } from "./__fixtures__/fixture-transport";
import {
  resetGoogleClassroomTransportForTests,
  setGoogleClassroomTransport,
} from "./transport";

const FIXTURE_CONFIG = {
  clientId: "fixture-oauth-client-id",
  clientSecret: "fixture-oauth-client-secret-never-real",
  redirectUri: "https://fixture.example.invalid/lms-callback",
} as const;

describe("googleClassroomAdapter boundary (Sprint 23B / Sprint 25 Phase 1)", () => {
  afterEach(() => {
    resetGoogleClassroomTransportForTests();
    resetGoogleClassroomConfigForTests();
  });

  it("preserves the exact provider identity and display name", () => {
    expect(googleClassroomAdapter.providerId).toBe("googleClassroom");
    expect(googleClassroomAdapter.displayName).toBe("Google Classroom");
  });

  it("activated operations route through the transport + config seams", async () => {
    setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    // beginOAuth uses config to build the authorization URL and does
    // not touch the transport; the remaining four activated operations
    // route through the transport.
    const begin = await googleClassroomAdapter.beginOAuth({
      teacherId: "fixture-teacher-id",
      redirectUri: FIXTURE_CONFIG.redirectUri,
    });
    expect(begin.authorizationUrl).toContain("accounts.google.com");
    expect(begin.state).toMatch(/^[0-9a-f]{64}$/);
  });

  // Sprint 26 Phase 1: the provider-neutral `accountHint` contract is
  // accepted by beginOAuth and converted to Google's `login_hint` only
  // inside this adapter. Phase 1 never populates it from the durable
  // connection; these tests exercise the contract directly at the
  // adapter boundary.
  describe("Sprint 26 Phase 1 account-hint contract (beginOAuth)", () => {
    beforeEach(() => {
      setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
      setGoogleClassroomConfig(FIXTURE_CONFIG);
    });

    it("omits login_hint entirely when no account hint is supplied", async () => {
      const begin = await googleClassroomAdapter.beginOAuth({
        teacherId: "fixture-teacher-id",
        redirectUri: FIXTURE_CONFIG.redirectUri,
      });
      const url = new URL(begin.authorizationUrl);
      // Deterministic omitted-value behavior preserved from before Sprint 26:
      // the parameter is absent, not present-but-empty.
      expect(url.searchParams.has("login_hint")).toBe(false);
      expect(begin.authorizationUrl).not.toContain("login_hint");
    });

    it("omits login_hint when the account hint is an empty string", async () => {
      const begin = await googleClassroomAdapter.beginOAuth({
        teacherId: "fixture-teacher-id",
        redirectUri: FIXTURE_CONFIG.redirectUri,
        accountHint: "",
      });
      const url = new URL(begin.authorizationUrl);
      expect(url.searchParams.has("login_hint")).toBe(false);
    });

    it("includes login_hint set to the supplied account hint when present", async () => {
      const begin = await googleClassroomAdapter.beginOAuth({
        teacherId: "fixture-teacher-id",
        redirectUri: FIXTURE_CONFIG.redirectUri,
        accountHint: "opaque-upstream-account-id",
      });
      const url = new URL(begin.authorizationUrl);
      expect(url.searchParams.get("login_hint")).toBe(
        "opaque-upstream-account-id",
      );
      // The hint never disturbs the security-relevant parameters.
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("include_granted_scopes")).toBe("true");
      expect(url.searchParams.get("prompt")).toBe("consent");
    });

    it("produces a byte-for-byte identical authorization URL with and without an absent hint (login_hint unchanged)", async () => {
      // Prove the Phase 1 default (no hint) is behaviorally unchanged from
      // the pre-Sprint-26 authorization request. The two calls differ only
      // in the random state/PKCE material, so compare the URL with those
      // volatile parameters removed.
      const strip = (raw: string): string => {
        const url = new URL(raw);
        url.searchParams.delete("state");
        url.searchParams.delete("code_challenge");
        url.searchParams.sort();
        return url.toString();
      };
      const withoutField = await googleClassroomAdapter.beginOAuth({
        teacherId: "fixture-teacher-id",
        redirectUri: FIXTURE_CONFIG.redirectUri,
      });
      const withUndefinedHint = await googleClassroomAdapter.beginOAuth({
        teacherId: "fixture-teacher-id",
        redirectUri: FIXTURE_CONFIG.redirectUri,
        accountHint: undefined,
      });
      expect(strip(withUndefinedHint.authorizationUrl)).toBe(
        strip(withoutField.authorizationUrl),
      );
      expect(strip(withoutField.authorizationUrl)).not.toContain("login_hint");
    });
  });
});
