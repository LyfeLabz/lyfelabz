// Token-safety fixture tests. Sprint 23A shipped these as a boundary
// guard against accidental activation; Sprint 23B rewires them so
// the same invariants hold across the activation:
//
//   - error messages never carry token or authorization-code material,
//     even under the activated adapter methods;
//   - the transport / config unbound sentinels never leak secrets in
//     their error messages;
//   - `withGoogleClassroomConfig` restores prior bindings correctly;
//   - the vendor-neutral LMS core (registry, callables, mirror record)
//     does not import the Google-package-local seams.
//
// The tests demonstrate that even though the adapter now returns
// real token material back to the calling callable (which hands it to
// the server-only token store), no token value survives into an
// observable error message.

import * as fs from "node:fs";
import * as path from "node:path";

import { HttpsError } from "firebase-functions/v2/https";

import { PlatformError } from "../../../shared";
import { translateThrown } from "../../../shared/errors/https-callable";
import { resetLmsOAuthStateStoreForTests } from "../../oauth-state/state-store";

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

describe("token-safety invariants (Sprint 23B)", () => {
  afterEach(() => {
    resetGoogleClassroomTransportForTests();
    resetGoogleClassroomConfigForTests();
    resetLmsOAuthStateStoreForTests();
  });

  it("adapter beginOAuth output never carries the client secret in the authorization URL", async () => {
    setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    const authorization = await googleClassroomAdapter.beginOAuth({
      teacherId: "fixture-teacher-id",
      redirectUri: FIXTURE_CONFIG.redirectUri,
    });
    // The authorization URL is destined for the client browser; it
    // must never carry the OAuth client secret.
    expect(authorization.authorizationUrl).not.toContain(
      FIXTURE_CONFIG.clientSecret,
    );
    for (const secret of SECRETS_TO_GUARD) {
      expect(authorization.authorizationUrl).not.toContain(secret);
    }
  });

  it("adapter completeOAuth error paths never echo the authorization code or client secret", async () => {
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    // Issue a real state so the code-exchange authorization-failure
    // path is reached rather than the state-store rejection path;
    // both paths must observe the no-secrets invariant, but the
    // authorization-failure path is the one this test asserts.
    setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
    const authorization = await googleClassroomAdapter.beginOAuth({
      teacherId: "fixture-teacher-id",
      redirectUri: FIXTURE_CONFIG.redirectUri,
    });
    setGoogleClassroomTransport(
      createFixtureGoogleClassroomTransport({
        failureMode: "authorization-failure",
      }),
    );
    let observed: unknown;
    try {
      await googleClassroomAdapter.completeOAuth({
        code: FIXTURE_AUTHORIZATION_CODE,
        state: authorization.state,
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

  it("no core LMS module (adapter, provider, registry) imports the Sprint 23A seams; only callables activated in Sprint 23B may reach for config-firebase", () => {
    // Guard: the vendor-neutral core (providers/provider.ts,
    // providers/registry.ts, tokens/token-store.ts) must not reach
    // into the Google-package-local seams. Sprint 23B introduced a
    // narrow exception: the activated callables install the
    // production bindings via `providers/google-classroom/config-firebase`.
    // No other seam may leak.
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
    // Match imports whose final path segment is exactly `transport`,
    // `config`, or `__fixtures__`. The path terminator (quote or
    // slash) prevents the regex from matching `config-firebase`, which
    // Sprint 23B explicitly allows.
    const FORBIDDEN = /providers\/google-classroom\/(transport|config|__fixtures__)["'/]/;
    // The vendor-neutral core files that must NEVER reach into any
    // Google-package-local surface (including `config-firebase`).
    const CORE_NEUTRAL = new Set(
      [
        "providers/provider.ts",
        "providers/registry.ts",
        "tokens/token-store.ts",
      ].map((rel) => path.join(lmsRoot, rel)),
    );
    const CONFIG_FIREBASE_IMPORT =
      /providers\/google-classroom\/config-firebase/;
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      expect(source).not.toMatch(FORBIDDEN);
      if (CORE_NEUTRAL.has(file)) {
        expect(source).not.toMatch(CONFIG_FIREBASE_IMPORT);
      }
    }
  });
});
