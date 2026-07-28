// Sprint 23A coverage for the Google Classroom configuration seam.

import {
  getGoogleClassroomConfig,
  resetGoogleClassroomConfigForTests,
  setGoogleClassroomConfig,
  withGoogleClassroomConfig,
  type GoogleClassroomConfig,
} from "./config";

const FIXTURE_CONFIG: GoogleClassroomConfig = {
  clientId: "fixture-oauth-client-id",
  clientSecret: "fixture-oauth-client-secret-never-real",
  redirectUri: "https://fixture.example.invalid/lms-callback",
};

describe("GoogleClassroomConfig seam", () => {
  afterEach(() => {
    resetGoogleClassroomConfigForTests();
  });

  it("throws lms.googleClassroomConfigUnbound by default", () => {
    expect(() => getGoogleClassroomConfig()).toThrow(
      expect.objectContaining({
        code: "lms.googleClassroomConfigUnbound",
      }),
    );
  });

  it("returns the installed config after setGoogleClassroomConfig", () => {
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    expect(getGoogleClassroomConfig()).toEqual(FIXTURE_CONFIG);
  });

  it("withGoogleClassroomConfig restores prior binding on success", async () => {
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    const other: GoogleClassroomConfig = {
      ...FIXTURE_CONFIG,
      clientId: "fixture-oauth-client-id-other",
    };

    let observed: GoogleClassroomConfig | null = null;
    await withGoogleClassroomConfig(other, () => {
      observed = getGoogleClassroomConfig();
      return Promise.resolve();
    });

    expect(observed).toEqual(other);
    expect(getGoogleClassroomConfig()).toEqual(FIXTURE_CONFIG);
  });

  it("withGoogleClassroomConfig restores prior binding on failure", async () => {
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    const other: GoogleClassroomConfig = {
      ...FIXTURE_CONFIG,
      clientSecret: "fixture-oauth-client-secret-other-never-real",
    };

    await expect(
      withGoogleClassroomConfig(other, () =>
        Promise.reject(new Error("intentional test failure")),
      ),
    ).rejects.toThrow("intentional test failure");

    expect(getGoogleClassroomConfig()).toEqual(FIXTURE_CONFIG);
  });

  it("resetGoogleClassroomConfigForTests reinstates the unbound default", () => {
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    resetGoogleClassroomConfigForTests();
    expect(() => getGoogleClassroomConfig()).toThrow(
      expect.objectContaining({
        code: "lms.googleClassroomConfigUnbound",
      }),
    );
  });
});
