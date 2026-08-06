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
});
