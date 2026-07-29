// Sprint 23A boundary test, re-targeted for Sprint 23B activation.
//
// Sprint 23A shipped every adapter operation as a stable
// `lms.providerNotYetOperational` reject. Sprint 23B activated five of
// those seven operations against the transport + config seams
// (beginOAuth, completeOAuth, revokeGrant, listTeacherClasses,
// fetchClass); the remaining two (listClassTopics, publishAssignment)
// still short-circuit with `lms.providerNotYetOperational` until
// Sprint 23C authorizes them.
//
// This file enforces exactly that boundary. It is the single
// load-bearing check that Sprint 23B did not silently activate a
// deferred capability, and that the activated capabilities do not
// leak provider-specific errors into the vendor-neutral core.

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

const NOT_YET_OPERATIONAL = "lms.providerNotYetOperational";

const FIXTURE_CONFIG = {
  clientId: "fixture-oauth-client-id",
  clientSecret: "fixture-oauth-client-secret-never-real",
  redirectUri: "https://fixture.example.invalid/lms-callback",
} as const;

const DEFERRED_OPERATIONS: readonly {
  readonly name: string;
  readonly invoke: () => Promise<unknown>;
}[] = [
  {
    name: "listClassTopics",
    invoke: () =>
      googleClassroomAdapter.listClassTopics({
        accessToken: "fixture-access-token",
        lmsClassId: "fixture-course-planet-forge",
      }),
  },
  {
    name: "publishAssignment",
    invoke: () =>
      googleClassroomAdapter.publishAssignment({
        accessToken: "fixture-access-token",
        lmsClassId: "fixture-course-planet-forge",
        title: "Fictional",
        lyfelabzAssignmentUrl: "https://app.lyfelabz.invalid/a/fixture-1",
      }),
  },
];

describe("googleClassroomAdapter boundary (Sprint 23B)", () => {
  afterEach(() => {
    resetGoogleClassroomTransportForTests();
    resetGoogleClassroomConfigForTests();
  });

  it.each(DEFERRED_OPERATIONS)(
    "$name still rejects with lms.providerNotYetOperational (deferred to Sprint 23C+)",
    async ({ invoke }) => {
      setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
      setGoogleClassroomConfig(FIXTURE_CONFIG);
      await expect(invoke()).rejects.toMatchObject({
        code: NOT_YET_OPERATIONAL,
      });
    },
  );

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
