// Sprint 11C Remediation Slice 1 - Critical Finding C-4.
//
// Tests for the legacy-submissions deployment gate. Verifies that the
// gate defaults to inert (both write paths cannot be simultaneously
// active in production) and that only an explicit `true` opt-in
// re-enables the legacy writer.

import { PlatformError } from "./errors/platform-error";
import {
  LEGACY_SUBMISSIONS_ENV_VAR,
  assertLegacySubmissionsWritesEnabled,
  legacySubmissionsWritesEnabled,
} from "./legacy-submissions-flag";

describe("legacy submissions deployment gate", () => {
  const original = process.env[LEGACY_SUBMISSIONS_ENV_VAR];

  afterEach(() => {
    if (original === undefined) {
      delete process.env[LEGACY_SUBMISSIONS_ENV_VAR];
    } else {
      process.env[LEGACY_SUBMISSIONS_ENV_VAR] = original;
    }
  });

  it("defaults to disabled when the env var is unset", () => {
    delete process.env[LEGACY_SUBMISSIONS_ENV_VAR];
    expect(legacySubmissionsWritesEnabled()).toBe(false);
    expect(() => assertLegacySubmissionsWritesEnabled()).toThrow(PlatformError);
  });

  it("throws the canonical identifier when disabled", () => {
    delete process.env[LEGACY_SUBMISSIONS_ENV_VAR];
    try {
      assertLegacySubmissionsWritesEnabled();
      fail("expected assertion to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformError);
      expect((err as PlatformError).code).toBe(
        "submissions.legacyWritesDisabled",
      );
    }
  });

  it("enables the legacy writer when the env var is set to true (case-insensitive)", () => {
    process.env[LEGACY_SUBMISSIONS_ENV_VAR] = "true";
    expect(legacySubmissionsWritesEnabled()).toBe(true);
    expect(() => assertLegacySubmissionsWritesEnabled()).not.toThrow();

    process.env[LEGACY_SUBMISSIONS_ENV_VAR] = "TRUE";
    expect(legacySubmissionsWritesEnabled()).toBe(true);

    process.env[LEGACY_SUBMISSIONS_ENV_VAR] = "  true  ";
    expect(legacySubmissionsWritesEnabled()).toBe(true);
  });

  it("stays disabled for any value other than the explicit truthy opt-in", () => {
    for (const value of ["", "false", "0", "yes", "1", "no"]) {
      process.env[LEGACY_SUBMISSIONS_ENV_VAR] = value;
      expect(legacySubmissionsWritesEnabled()).toBe(false);
      expect(() => assertLegacySubmissionsWritesEnabled()).toThrow(
        PlatformError,
      );
    }
  });
});
