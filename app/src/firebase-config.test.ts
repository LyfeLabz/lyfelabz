/**
 * @jest-environment node
 */
import {
  EMULATOR_CONFIG,
  PROJECT_ID,
  getFirebaseClientConfig,
  isEmulatorHost,
} from "./firebase-config";

// Sprint 17 Slice 6 audit: focused tests for the shared Firebase client
// configuration selector. These tests replace direct assertions about
// the shared module's behavior that were previously only inferred by
// its two consumers (app/src/firebase.ts and app/src/runtime/entry.ts).
//
// The three certified behaviors under test are:
//   1. Emulator-host detection is limited to the approved local hosts.
//   2. Emulator hosts always resolve to the emulator-friendly placeholder
//      and never read from the injected production global.
//   3. Production hosts read the injected `window.__lyfelabzFirebaseConfig`
//      global when present and fall back to the public identifier-shaped
//      fallback (no committed API key) when the injection is missing.

type WinShape = {
  location: { hostname: string };
  __lyfelabzFirebaseConfig?: unknown;
};

function makeWin(hostname: string, injected?: unknown): WinShape {
  const w: WinShape = { location: { hostname } };
  if (injected !== undefined) w.__lyfelabzFirebaseConfig = injected;
  return w;
}

describe("isEmulatorHost", () => {
  it("returns true for the approved local hostnames", () => {
    for (const host of ["localhost", "127.0.0.1", "0.0.0.0"]) {
      expect(isEmulatorHost(makeWin(host) as unknown as Window)).toBe(true);
    }
  });

  it("returns false for every other host", () => {
    for (const host of [
      "lyfelabz.com",
      "lyfelabz-prod.web.app",
      "lyfelabz-prod.firebaseapp.com",
      "staging.lyfelabz.com",
      "example.test",
      "127.0.0.2",
      "192.168.1.1",
      "",
    ]) {
      expect(isEmulatorHost(makeWin(host) as unknown as Window)).toBe(false);
    }
  });

  it("returns false when no window is provided", () => {
    expect(isEmulatorHost(undefined)).toBe(false);
  });
});

describe("getFirebaseClientConfig", () => {
  it("returns the emulator placeholder on approved local hosts", () => {
    for (const host of ["localhost", "127.0.0.1", "0.0.0.0"]) {
      const cfg = getFirebaseClientConfig(makeWin(host) as unknown as Window);
      expect(cfg).toEqual(EMULATOR_CONFIG);
      expect(cfg.projectId).toBe(PROJECT_ID);
    }
  });

  it("ignores the injected production global on emulator hosts", () => {
    const win = makeWin("localhost", {
      apiKey: "prod-key-must-not-leak",
      authDomain: "prod.firebaseapp.com",
      projectId: "prod-project",
    });
    const cfg = getFirebaseClientConfig(win as unknown as Window);
    expect(cfg).toEqual(EMULATOR_CONFIG);
    expect(cfg.apiKey).not.toBe("prod-key-must-not-leak");
  });

  it("returns the injected production config on production hosts", () => {
    const injected = {
      apiKey: "prod-key",
      authDomain: "auth.lyfelabz.com",
      projectId: "lyfelabz-prod",
      appId: "1:app",
      messagingSenderId: "sender",
      storageBucket: "bucket",
    };
    const cfg = getFirebaseClientConfig(
      makeWin("lyfelabz.com", injected) as unknown as Window,
    );
    expect(cfg).toEqual(injected);
  });

  it("falls back to the public identifier fallback when the injection is missing", () => {
    const cfg = getFirebaseClientConfig(
      makeWin("lyfelabz.com") as unknown as Window,
    );
    expect(cfg.projectId).toBe(PROJECT_ID);
    expect(cfg.authDomain).toBe(`${PROJECT_ID}.firebaseapp.com`);
    expect(cfg.apiKey).toBe("unconfigured");
  });

  it("falls back per-field when the injected global is partial or malformed", () => {
    const cfg = getFirebaseClientConfig(
      makeWin("lyfelabz.com", { authDomain: "auth.lyfelabz.com" }) as unknown as Window,
    );
    expect(cfg.authDomain).toBe("auth.lyfelabz.com");
    expect(cfg.projectId).toBe(PROJECT_ID);
    expect(cfg.apiKey).toBe("unconfigured");
  });

  it("rejects non-string injected fields without throwing", () => {
    const cfg = getFirebaseClientConfig(
      makeWin("lyfelabz.com", {
        apiKey: 123,
        authDomain: null,
        projectId: {},
        appId: 42,
      }) as unknown as Window,
    );
    expect(cfg.apiKey).toBe("unconfigured");
    expect(cfg.authDomain).toBe(`${PROJECT_ID}.firebaseapp.com`);
    expect(cfg.projectId).toBe(PROJECT_ID);
    expect(cfg.appId).toBeUndefined();
  });

  it("does not embed a real production API key in the shipped module", () => {
    // The fallback string and the emulator placeholder are the only two
    // apiKey values that may appear in the shipped bundle. If either the
    // fallback or the emulator config were ever replaced with a real
    // AIza-shaped Google API key, this test fails and the build stops.
    expect(EMULATOR_CONFIG.apiKey).not.toMatch(/^AIza/);
    const fallback = getFirebaseClientConfig(
      makeWin("lyfelabz.com") as unknown as Window,
    );
    expect(fallback.apiKey).not.toMatch(/^AIza/);
  });

  it("returns the emulator config when no window is provided", () => {
    expect(getFirebaseClientConfig(undefined)).toEqual(EMULATOR_CONFIG);
  });
});
