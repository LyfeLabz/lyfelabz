// Sprint 23A coverage for the Google Classroom transport seam.
//
// Verifies: unbound default rejects with the stable code; setter
// replaces the binding; `withGoogleClassroomTransport` restores state
// on success and on failure; `resetGoogleClassroomTransportForTests`
// reinstates the unbound default.

import {
  getGoogleClassroomTransport,
  resetGoogleClassroomTransportForTests,
  setGoogleClassroomTransport,
  withGoogleClassroomTransport,
  type GoogleClassroomTransport,
} from "./transport";

import { createFixtureGoogleClassroomTransport } from "./__fixtures__/fixture-transport";

describe("GoogleClassroomTransport seam", () => {
  afterEach(() => {
    resetGoogleClassroomTransportForTests();
  });

  it("throws lms.googleClassroomTransportUnbound by default", () => {
    const transport = getGoogleClassroomTransport();
    expect(() => transport.listTeacherCourses({ accessToken: "x" })).toThrow(
      expect.objectContaining({
        code: "lms.googleClassroomTransportUnbound",
      }),
    );
  });

  it("returns the installed transport after setGoogleClassroomTransport", async () => {
    const fixture = createFixtureGoogleClassroomTransport();
    setGoogleClassroomTransport(fixture);
    const response = await getGoogleClassroomTransport().listTeacherCourses({
      accessToken: "fixture-access-token-any",
    });
    expect(response.courses).toBeDefined();
  });

  it("withGoogleClassroomTransport restores prior binding on success", async () => {
    const initial: GoogleClassroomTransport =
      createFixtureGoogleClassroomTransport();
    setGoogleClassroomTransport(initial);
    const inner: GoogleClassroomTransport =
      createFixtureGoogleClassroomTransport();

    let observedInside: GoogleClassroomTransport | null = null;
    await withGoogleClassroomTransport(inner, () => {
      observedInside = getGoogleClassroomTransport();
      return Promise.resolve();
    });

    expect(observedInside).toBe(inner);
    expect(getGoogleClassroomTransport()).toBe(initial);
  });

  it("withGoogleClassroomTransport restores prior binding on failure", async () => {
    const initial: GoogleClassroomTransport =
      createFixtureGoogleClassroomTransport();
    setGoogleClassroomTransport(initial);
    const inner: GoogleClassroomTransport =
      createFixtureGoogleClassroomTransport();

    await expect(
      withGoogleClassroomTransport(inner, () =>
        Promise.reject(new Error("intentional test failure")),
      ),
    ).rejects.toThrow("intentional test failure");

    expect(getGoogleClassroomTransport()).toBe(initial);
  });

  it("resetGoogleClassroomTransportForTests reinstates the unbound default", () => {
    setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
    resetGoogleClassroomTransportForTests();
    expect(() =>
      getGoogleClassroomTransport().listTeacherCourses({ accessToken: "x" }),
    ).toThrow(
      expect.objectContaining({
        code: "lms.googleClassroomTransportUnbound",
      }),
    );
  });
});
