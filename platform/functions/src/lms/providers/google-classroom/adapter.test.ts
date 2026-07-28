// Sprint 23A: adapter activation boundary test.
//
// This test proves the production-facing Google Classroom adapter
// still returns the stable `lms.providerNotYetOperational` error for
// every operation defined by the vendor-neutral LmsProviderAdapter
// interface, both before and after the transport / config seams are
// installed. It is the single load-bearing check that Sprint 23A
// ships no live adapter behavior.

import * as fs from "node:fs";
import * as path from "node:path";

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

const OPERATIONS: readonly {
  readonly name: string;
  readonly invoke: () => Promise<unknown>;
}[] = [
  {
    name: "beginOAuth",
    invoke: () =>
      googleClassroomAdapter.beginOAuth({
        teacherId: "fixture-teacher-id",
        redirectUri: "https://fixture.example.invalid/lms-callback",
      }),
  },
  {
    name: "completeOAuth",
    invoke: () =>
      googleClassroomAdapter.completeOAuth({
        code: "fixture-code",
        state: "fixture-state",
        redirectUri: "https://fixture.example.invalid/lms-callback",
      }),
  },
  {
    name: "revokeGrant",
    invoke: () =>
      googleClassroomAdapter.revokeGrant({
        accessToken: "fixture-access-token",
        refreshToken: "fixture-refresh-token",
      }),
  },
  {
    name: "listTeacherClasses",
    invoke: () =>
      googleClassroomAdapter.listTeacherClasses({
        accessToken: "fixture-access-token",
      }),
  },
  {
    name: "fetchClass",
    invoke: () =>
      googleClassroomAdapter.fetchClass({
        accessToken: "fixture-access-token",
        lmsClassId: "fixture-course-planet-forge",
      }),
  },
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

describe("googleClassroomAdapter activation boundary (Sprint 23A)", () => {
  afterEach(() => {
    resetGoogleClassroomTransportForTests();
    resetGoogleClassroomConfigForTests();
  });

  it.each(OPERATIONS)(
    "$name rejects with lms.providerNotYetOperational when no seams are installed",
    async ({ invoke }) => {
      await expect(invoke()).rejects.toMatchObject({
        code: NOT_YET_OPERATIONAL,
      });
    },
  );

  it.each(OPERATIONS)(
    "$name still rejects with lms.providerNotYetOperational after the transport + config seams are installed",
    async ({ invoke }) => {
      setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
      setGoogleClassroomConfig({
        clientId: "fixture-oauth-client-id",
        clientSecret: "fixture-oauth-client-secret-never-real",
        redirectUri: "https://fixture.example.invalid/lms-callback",
      });
      await expect(invoke()).rejects.toMatchObject({
        code: NOT_YET_OPERATIONAL,
      });
    },
  );

  it("preserves the exact provider identity and display name", () => {
    expect(googleClassroomAdapter.providerId).toBe("googleClassroom");
    expect(googleClassroomAdapter.displayName).toBe("Google Classroom");
  });

  it("does not import or reference the transport or config seams", () => {
    // Static-analysis-style check: the adapter module's source string
    // must not import from ./transport or ./config in Sprint 23A. If
    // the adapter is ever wired to the seams, this test intentionally
    // fails so the review catches the activation in the same PR that
    // ships it.
    const source = fs.readFileSync(
      path.join(__dirname, "adapter.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/from ["']\.\/transport["']/);
    expect(source).not.toMatch(/from ["']\.\/config["']/);
  });
});
