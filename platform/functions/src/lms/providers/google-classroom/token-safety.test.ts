// Sprint 23A token-safety fixture tests.
//
// Sprint 23A specification §6. Proves the Sprint 23A surfaces (adapter,
// transport seam, config seam, fixture) do not leak token or
// authorization-code material through any observable channel.
//
// Sprint 23A ships no live adapter behavior: every adapter method
// still rejects at `lms.providerNotYetOperational`, and no callable
// resolves the transport or config seam. Consequently no Firestore
// write path or callable response path can carry Google-sourced
// token material in Sprint 23A. These tests codify that invariant
// so a future accidental activation is caught by the test suite.

import * as fs from "node:fs";
import * as path from "node:path";

import { HttpsError } from "firebase-functions/v2/https";

import { PlatformError } from "../../../shared";
import { translateThrown } from "../../../shared/errors/https-callable";

import { googleClassroomAdapter } from "./adapter";
import {
  getGoogleClassroomConfig,
  resetGoogleClassroomConfigForTests,
  setGoogleClassroomConfig,
  withGoogleClassroomConfig,
  type GoogleClassroomConfig,
} from "./config";
import {
  FIXTURE_ACCESS_TOKEN,
  FIXTURE_AUTHORIZATION_CODE,
  FIXTURE_REFRESH_TOKEN,
  FIXTURE_REFRESHED_ACCESS_TOKEN,
  createFixtureGoogleClassroomTransport,
} from "./__fixtures__/fixture-transport";
import {
  getGoogleClassroomTransport,
  resetGoogleClassroomTransportForTests,
  setGoogleClassroomTransport,
} from "./transport";

const SECRETS_TO_GUARD: readonly string[] = [
  FIXTURE_ACCESS_TOKEN,
  FIXTURE_REFRESHED_ACCESS_TOKEN,
  FIXTURE_REFRESH_TOKEN,
  FIXTURE_AUTHORIZATION_CODE,
];

const FIXTURE_CONFIG: GoogleClassroomConfig = {
  clientId: "fixture-oauth-client-id",
  clientSecret: "fixture-oauth-client-secret-never-real",
  redirectUri: "https://fixture.example.invalid/lms-callback",
};

function assertNoSecretIn(source: string): void {
  for (const secret of SECRETS_TO_GUARD) {
    expect(source).not.toContain(secret);
  }
  expect(source).not.toContain(FIXTURE_CONFIG.clientSecret);
}

describe("token-safety invariants (Sprint 23A)", () => {
  afterEach(() => {
    resetGoogleClassroomTransportForTests();
    resetGoogleClassroomConfigForTests();
  });

  it("adapter beginOAuth rejects with providerNotYetOperational and does not leak fixture tokens", async () => {
    setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
    setGoogleClassroomConfig(FIXTURE_CONFIG);
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
    const platformError = observed as PlatformError;
    expect(platformError.code).toBe("lms.providerNotYetOperational");
    assertNoSecretIn(platformError.message);
  });

  it("adapter completeOAuth rejects and does not echo the authorization code, tokens, or client secret", async () => {
    setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    let observed: unknown;
    try {
      await googleClassroomAdapter.completeOAuth({
        code: FIXTURE_AUTHORIZATION_CODE,
        state: "fixture-state",
        redirectUri: FIXTURE_CONFIG.redirectUri,
      });
    } catch (err) {
      observed = err;
    }
    expect(observed).toBeInstanceOf(PlatformError);
    assertNoSecretIn((observed as PlatformError).message);
  });

  it("translateThrown coerces a providerNotYetOperational PlatformError without leaking tokens", () => {
    const platformError = new PlatformError(
      "lms.providerNotYetOperational",
      "Google Classroom OAuth complete requires operational OAuth provisioning.",
    );
    const httpsError: HttpsError = translateThrown(platformError, {
      callableName: "lmsConnectionsComplete",
    });
    expect(httpsError).toBeInstanceOf(HttpsError);
    expect((httpsError.details as { code: string }).code).toBe(
      "lms.providerNotYetOperational",
    );
    assertNoSecretIn(httpsError.message);
    assertNoSecretIn(JSON.stringify(httpsError.details));
  });

  it("transport unbound error carries no token material", async () => {
    // Default unbound transport is reinstated by afterEach; call the
    // getter directly to observe the thrown error. The unbound
    // implementation throws synchronously, so `await` here never
    // actually suspends; it is present only to satisfy the lint rule
    // against floating promises.
    let observed: unknown;
    try {
      await getGoogleClassroomTransport().listTeacherCourses({
        accessToken: FIXTURE_ACCESS_TOKEN,
      });
    } catch (err) {
      observed = err;
    }
    expect(observed).toBeInstanceOf(PlatformError);
    assertNoSecretIn((observed as PlatformError).message);
  });

  it("config unbound error carries no secret material", () => {
    let observed: unknown;
    try {
      getGoogleClassroomConfig();
    } catch (err) {
      observed = err;
    }
    expect(observed).toBeInstanceOf(PlatformError);
    assertNoSecretIn((observed as PlatformError).message);
  });

  it("fixture invalid_grant error does not echo the token or secret material", async () => {
    const t = createFixtureGoogleClassroomTransport();
    let observed: unknown;
    try {
      await t.exchangeAuthorizationCode({
        code: "fixture-wrong-code",
        redirectUri: FIXTURE_CONFIG.redirectUri,
      });
    } catch (err) {
      observed = err;
    }
    expect(observed).toBeDefined();
    assertNoSecretIn((observed as Error).message);
  });

  it("withGoogleClassroomConfig scopes the client secret to the block and restores after failure", async () => {
    setGoogleClassroomConfig({
      ...FIXTURE_CONFIG,
      clientSecret: "fixture-oauth-outer-secret-never-real",
    });
    await expect(
      withGoogleClassroomConfig(FIXTURE_CONFIG, () =>
        Promise.reject(new Error("intentional test failure")),
      ),
    ).rejects.toThrow("intentional test failure");
    // Prior binding restored: reading the config returns the outer
    // secret, not the inner. The point is that scoped injection does
    // not permanently overwrite the ambient binding.
    const restored = getGoogleClassroomConfig();
    expect(restored.clientSecret).toBe(
      "fixture-oauth-outer-secret-never-real",
    );
  });

  it("no core LMS module (adapter, provider, registry, callables) imports the Sprint 23A seams", () => {
    // Guard: the vendor-neutral core and every LMS callable must not
    // reach into the Google-package-local seams. If a future edit
    // wires a callable directly to `./transport` or `./config`, this
    // test fails, catching an unreviewed activation.
    const lmsRoot = path.resolve(__dirname, "../..");
    const files: string[] = [];
    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "google-classroom") continue;
          if (entry.name === "__fixtures__") continue;
          walk(full);
          continue;
        }
        if (
          entry.isFile() &&
          entry.name.endsWith(".ts") &&
          !entry.name.endsWith(".test.ts")
        ) {
          files.push(full);
        }
      }
    }
    walk(lmsRoot);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      expect(source).not.toMatch(
        /providers\/google-classroom\/(transport|config|__fixtures__)/,
      );
    }
  });
});
