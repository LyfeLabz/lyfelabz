import fs from "fs";
import path from "path";

const initializeApp = jest.fn((config: unknown) => ({ config }));
const connectAuthEmulator = jest.fn();
const connectFirestoreEmulator = jest.fn();

jest.mock("firebase/app", () => ({
  getApps: () => [],
  initializeApp: (config: unknown) => initializeApp(config),
}));
jest.mock("firebase/auth", () => ({
  getAuth: () => ({ kind: "auth" }),
  connectAuthEmulator: (...args: unknown[]) => connectAuthEmulator(...args),
  onAuthStateChanged: jest.fn(),
  signOut: jest.fn(),
}));
jest.mock("firebase/firestore", () => ({
  getFirestore: () => ({ kind: "firestore" }),
  connectFirestoreEmulator: (...args: unknown[]) => connectFirestoreEmulator(...args),
  doc: jest.fn(),
  getDoc: jest.fn(),
}));

import {
  DEFAULT_EMULATOR_ENDPOINTS,
  EMULATOR_CONFIG,
  getEmulatorEndpoints,
  getFirebaseClientConfig,
  parseEmulatorOverride,
} from "./firebase-config";
import type * as FirebaseModuleNs from "./firebase";

type FirebaseModule = typeof FirebaseModuleNs;

// Isolated local emulator override: one validated source for every emulator
// connection, honored only on an emulator host, failing closed when invalid.

const VALID = {
  projectId: "demo-grade-improvements",
  auth: { host: "127.0.0.1", port: 19099 },
  firestore: { host: "127.0.0.1", port: 18080 },
  functions: { host: "localhost", port: 15001 },
};

const PROD_INJECTED = {
  apiKey: "prod-key",
  authDomain: "lyfelabz-prod.firebaseapp.com",
  projectId: "lyfelabz-prod",
};

function makeWin(hostname: string, extra: Record<string, unknown> = {}): Window {
  return { location: { hostname }, ...extra } as unknown as Window;
}

function withService(service: string, value: unknown): unknown {
  return { ...VALID, [service]: value };
}

describe("parseEmulatorOverride", () => {
  it("accepts a complete demo configuration", () => {
    expect(parseEmulatorOverride(VALID)).toEqual(VALID);
  });

  it.each([
    "lyfelabz-prod",
    "lyfelabz-staging",
    "demo-",
    "demo",
    "Demo-x",
    "demo_x",
    "demo-x-",
    "my-demo-x",
    "",
    42,
    undefined,
  ])("rejects project id %p", (projectId) => {
    expect(() => parseEmulatorOverride({ ...VALID, projectId })).toThrow(/demo-\*/);
  });

  it.each(["auth", "firestore", "functions"])("rejects a missing %s endpoint", (service) => {
    const partial: Record<string, unknown> = { ...VALID };
    delete partial[service];
    expect(() => parseEmulatorOverride(partial)).toThrow(`${service} is required`);
  });

  it.each([null, "x", undefined, 5])("rejects a non-object override %p", (raw) => {
    expect(() => parseEmulatorOverride(raw)).toThrow(/Invalid __lyfelabzEmulatorOverride/);
  });

  it.each(["0.0.0.0", "lyfelabz.com", "10.0.0.5", "127.0.0.1:9099", "", 1])(
    "rejects host %p",
    (host) => {
      expect(() =>
        parseEmulatorOverride(withService("firestore", { host, port: 18080 })),
      ).toThrow("firestore.host");
    },
  );

  it.each([0, 80, 1023, 65536, 18080.5, "18080", NaN, undefined])("rejects port %p", (port) => {
    expect(() =>
      parseEmulatorOverride(withService("functions", { host: "127.0.0.1", port })),
    ).toThrow("functions.port");
  });

  it("rejects two services sharing a port", () => {
    expect(() =>
      parseEmulatorOverride(withService("functions", { host: "127.0.0.1", port: 18080 })),
    ).toThrow("duplicates");
  });
});

describe("getEmulatorEndpoints / getFirebaseClientConfig", () => {
  it("applies a valid override on an emulator host to project and every service", () => {
    const win = makeWin("localhost", { __lyfelabzEmulatorOverride: VALID });
    expect(getEmulatorEndpoints(win)).toEqual(VALID);
    expect(getFirebaseClientConfig(win)).toEqual({
      ...EMULATOR_CONFIG,
      projectId: "demo-grade-improvements",
    });
  });

  it("keeps the historical emulator defaults when no override is present", () => {
    const win = makeWin("127.0.0.1");
    expect(getEmulatorEndpoints(win)).toBe(DEFAULT_EMULATOR_ENDPOINTS);
    expect(getFirebaseClientConfig(win)).toBe(EMULATOR_CONFIG);
  });

  it("throws instead of falling back when an override is invalid", () => {
    const win = makeWin("localhost", {
      __lyfelabzEmulatorOverride: { ...VALID, projectId: "lyfelabz-prod" },
      __lyfelabzFirebaseConfig: PROD_INJECTED,
    });
    expect(() => getEmulatorEndpoints(win)).toThrow();
    expect(() => getFirebaseClientConfig(win)).toThrow();
  });

  it.each([
    "app.lyfelabz.com",
    "lyfelabz.com",
    "www.lyfelabz.com",
    "lyfelabz-prod.web.app",
    "lyfelabz-staging.web.app",
    "lyfelabz-staging.firebaseapp.com",
    "localhost.evil.example",
  ])("ignores the override on %s and keeps production behavior", (hostname) => {
    const withOverride = makeWin(hostname, {
      __lyfelabzEmulatorOverride: VALID,
      __lyfelabzFirebaseConfig: PROD_INJECTED,
    });
    const without = makeWin(hostname, { __lyfelabzFirebaseConfig: PROD_INJECTED });
    expect(getEmulatorEndpoints(withOverride)).toBeNull();
    expect(getFirebaseClientConfig(withOverride)).toEqual(getFirebaseClientConfig(without));
    expect(getFirebaseClientConfig(withOverride).projectId).toBe("lyfelabz-prod");
  });

  it("ignores even an invalid override off an emulator host", () => {
    const win = makeWin("app.lyfelabz.com", {
      __lyfelabzEmulatorOverride: { projectId: "lyfelabz-prod" },
      __lyfelabzFirebaseConfig: PROD_INJECTED,
    });
    expect(getEmulatorEndpoints(win)).toBeNull();
    expect(getFirebaseClientConfig(win).projectId).toBe("lyfelabz-prod");
  });
});

describe("app shell Firebase initialization", () => {
  type W = Window & { __lyfelabzEmulatorOverride?: unknown };

  beforeEach(() => {
    jest.resetModules();
    initializeApp.mockClear();
    connectAuthEmulator.mockClear();
    connectFirestoreEmulator.mockClear();
  });

  afterEach(() => {
    delete (window as W).__lyfelabzEmulatorOverride;
  });

  it("connects Auth and Firestore to the same validated override endpoints", () => {
    (window as W).__lyfelabzEmulatorOverride = VALID;
    const { getFirebaseAuth, getFirebaseFirestore } =
      jest.requireActual<FirebaseModule>("./firebase");
    getFirebaseAuth();
    getFirebaseFirestore();
    expect(initializeApp).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "demo-grade-improvements" }),
    );
    expect(connectAuthEmulator).toHaveBeenCalledWith(
      expect.anything(),
      "http://127.0.0.1:19099",
      expect.anything(),
    );
    expect(connectFirestoreEmulator).toHaveBeenCalledWith(expect.anything(), "127.0.0.1", 18080);
  });

  it("keeps the default emulator endpoints without an override", () => {
    const { getFirebaseAuth, getFirebaseFirestore } =
      jest.requireActual<FirebaseModule>("./firebase");
    getFirebaseAuth();
    getFirebaseFirestore();
    expect(connectAuthEmulator).toHaveBeenCalledWith(
      expect.anything(),
      "http://127.0.0.1:9099",
      expect.anything(),
    );
    expect(connectFirestoreEmulator).toHaveBeenCalledWith(expect.anything(), "127.0.0.1", 8080);
  });

  it("never initializes Firebase when the override is incomplete", () => {
    (window as W).__lyfelabzEmulatorOverride = { projectId: "demo-x" };
    const { getFirebaseAuth, getFirebaseFirestore } =
      jest.requireActual<FirebaseModule>("./firebase");
    expect(() => getFirebaseAuth()).toThrow();
    expect(() => getFirebaseFirestore()).toThrow();
    expect(initializeApp).not.toHaveBeenCalled();
    expect(connectAuthEmulator).not.toHaveBeenCalled();
    expect(connectFirestoreEmulator).not.toHaveBeenCalled();
  });
});

describe("every emulator connection reads the shared endpoints", () => {
  const files = ["index.ts", "firebase.ts", "runtime/entry.ts", "labReport/cloudEntry.ts"];

  it.each(files)("%s has no hardcoded emulator host, port, or hostname gate", (file) => {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    expect(source).not.toMatch(/127\.0\.0\.1|\b9099\b|\b8080\b|\b5001\b/);
    expect(source).not.toMatch(/hostname === "localhost"/);
    for (const call of source.match(/connect(Auth|Firestore|Functions)Emulator\([^;]*;/g) ?? []) {
      expect(call).toMatch(/emulators\.(auth|firestore|functions)\./);
    }
  });

  it("connects Functions in every app shell path through getEmulatorEndpoints", () => {
    const source = fs.readFileSync(path.join(__dirname, "index.ts"), "utf8");
    const connects = source.match(/connectFunctionsEmulator\(/g) ?? [];
    const lookups = source.match(/const emulators = getEmulatorEndpoints\(\);/g) ?? [];
    expect(connects.length).toBe(7);
    expect(lookups.length).toBe(connects.length);
  });
});
