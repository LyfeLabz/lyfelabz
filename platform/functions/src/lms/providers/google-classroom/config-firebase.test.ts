// Sprint 23B coverage for the Firebase-native production binding.
//
// Verifies:
//   - `ensureGoogleClassroomProductionBindings` is idempotent AND
//     respects prior test-injected bindings;
//   - `googleClassroomProductionSecrets` names exactly one secret;
//   - the installer does NOT reach for a Firebase parameter value when
//     both seams are already bound (guarantees the installer stays
//     unit-test-safe: no secret provisioning required in tests).

import {
  isGoogleClassroomConfigBound,
  resetGoogleClassroomConfigForTests,
  setGoogleClassroomConfig,
} from "./config";
import {
  ensureGoogleClassroomProductionBindings,
  GOOGLE_CLASSROOM_CLIENT_SECRET_PARAM,
  googleClassroomProductionSecrets,
} from "./config-firebase";
import { createFixtureGoogleClassroomTransport } from "./__fixtures__/fixture-transport";
import {
  isGoogleClassroomTransportBound,
  resetGoogleClassroomTransportForTests,
  setGoogleClassroomTransport,
} from "./transport";

describe("Google Classroom production bindings installer", () => {
  afterEach(() => {
    resetGoogleClassroomTransportForTests();
    resetGoogleClassroomConfigForTests();
  });

  it("declares exactly one Secret Manager secret", () => {
    expect(googleClassroomProductionSecrets).toHaveLength(1);
    expect(googleClassroomProductionSecrets[0]).toBe(
      GOOGLE_CLASSROOM_CLIENT_SECRET_PARAM,
    );
  });

  it("is a no-op when both seams are already bound (respects test injection)", () => {
    setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
    setGoogleClassroomConfig({
      clientId: "fixture-oauth-client-id",
      clientSecret: "fixture-oauth-client-secret-never-real",
      redirectUri: "https://fixture.example.invalid/lms-callback",
    });
    // Neither guard is invoked; nothing throws even though the
    // Firebase parameter values are not populated in this unit-test
    // environment.
    expect(() => ensureGoogleClassroomProductionBindings()).not.toThrow();
    expect(isGoogleClassroomTransportBound()).toBe(true);
    expect(isGoogleClassroomConfigBound()).toBe(true);
  });
});
