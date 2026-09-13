// Phase 8G.12A, Correction 1 - explicit project binding verification.
//
// These unit tests cover the CLI's pure project-binding helpers, including
// deliberate divergence between the acknowledged project, the environment
// project, and the bound app project. They prove the tool targets ONLY the
// explicitly bound project or refuses, without reaching firebase-admin.

import {
  assertProjectBinding,
  readBoundProjectId,
} from "./bootstrap-platform-administrator";

describe("readBoundProjectId", () => {
  test("returns the explicitly bound project id", () => {
    expect(readBoundProjectId({ options: { projectId: "proj-A" } })).toBe("proj-A");
  });

  test("trims surrounding whitespace", () => {
    expect(readBoundProjectId({ options: { projectId: "  proj-A  " } })).toBe("proj-A");
  });

  test("returns undefined when no explicit binding is present", () => {
    expect(readBoundProjectId({ options: {} })).toBeUndefined();
    expect(readBoundProjectId({ options: { projectId: "" } })).toBeUndefined();
    expect(readBoundProjectId({ options: { projectId: "   " } })).toBeUndefined();
    expect(readBoundProjectId({ options: { projectId: 123 } })).toBeUndefined();
  });
});

describe("assertProjectBinding", () => {
  test("passes when the bound project equals the acknowledged project", () => {
    expect(() => assertProjectBinding("proj-A", "proj-A")).not.toThrow();
  });

  test("fails closed when the bound project differs from the acknowledged project", () => {
    expect(() => assertProjectBinding("proj-B", "proj-A")).toThrow(
      /bound to "proj-B" but the acknowledged project is "proj-A"/,
    );
  });

  test("fails closed when no bound project is present", () => {
    expect(() => assertProjectBinding(undefined, "proj-A")).toThrow(
      /not explicitly bound/,
    );
  });

  test("environment project does NOT influence the decision (bound value is authoritative)", () => {
    // Simulate an environment where GCLOUD_PROJECT diverges from both the
    // acknowledged and the bound project. Only the bound project (first arg)
    // and the acknowledged project (second arg) matter; the env is irrelevant.
    const prevGcloud = process.env.GCLOUD_PROJECT;
    const prevGcp = process.env.GCP_PROJECT;
    const prevGoogle = process.env.GOOGLE_CLOUD_PROJECT;
    process.env.GCLOUD_PROJECT = "env-wrong";
    process.env.GCP_PROJECT = "gcp-wrong";
    process.env.GOOGLE_CLOUD_PROJECT = "google-wrong";
    try {
      // Bound == acknowledged -> passes despite divergent env.
      expect(() => assertProjectBinding("proj-A", "proj-A")).not.toThrow();
      // Bound == env but != acknowledged -> still fails closed.
      expect(() => assertProjectBinding("env-wrong", "proj-A")).toThrow(
        /acknowledged project is "proj-A"/,
      );
    } finally {
      process.env.GCLOUD_PROJECT = prevGcloud;
      process.env.GCP_PROJECT = prevGcp;
      process.env.GOOGLE_CLOUD_PROJECT = prevGoogle;
    }
  });
});

import {
  assertNoEmulatorEndpointOverrides,
  resolveBootstrapApp,
  REJECTED_EMULATOR_ENDPOINT_VARS,
  type AppLike,
  type BootstrapAppEnv,
} from "./bootstrap-platform-administrator";

describe("assertNoEmulatorEndpointOverrides (Correction 1)", () => {
  function withEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
    return env;
  }

  test("passes when neither override is present", () => {
    expect(() => assertNoEmulatorEndpointOverrides(withEnv({}))).not.toThrow();
  });

  test("passes when overrides are empty strings", () => {
    expect(() =>
      assertNoEmulatorEndpointOverrides(
        withEnv({ FIRESTORE_EMULATOR_HOST: "", FIREBASE_AUTH_EMULATOR_HOST: "" }),
      ),
    ).not.toThrow();
  });

  test.each([
    ["Firestore only, localhost", { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }],
    ["Auth only, localhost", { FIREBASE_AUTH_EMULATOR_HOST: "localhost:9099" }],
    ["both set", { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", FIREBASE_AUTH_EMULATOR_HOST: "localhost:9099" }],
    ["Firestore remote hostname", { FIRESTORE_EMULATOR_HOST: "emulator.internal.example:8080" }],
    ["Auth remote hostname", { FIREBASE_AUTH_EMULATOR_HOST: "emu.example.com:9099" }],
    ["whitespace-padded non-empty", { FIRESTORE_EMULATOR_HOST: "   127.0.0.1:8080   " }],
  ])("fails closed: %s", (_label, env) => {
    expect(() => assertNoEmulatorEndpointOverrides(withEnv(env))).toThrow(/Refusing to run/);
  });

  test("only the two service vars this tool uses are checked", () => {
    expect(REJECTED_EMULATOR_ENDPOINT_VARS).toEqual([
      "FIRESTORE_EMULATOR_HOST",
      "FIREBASE_AUTH_EMULATOR_HOST",
    ]);
    // An unrelated emulator var (e.g. PubSub/Storage/RTDB) is NOT rejected.
    expect(() =>
      assertNoEmulatorEndpointOverrides(
        withEnv({ PUBSUB_EMULATOR_HOST: "localhost:8085", FIREBASE_DATABASE_EMULATOR_HOST: "localhost:9000" }),
      ),
    ).not.toThrow();
  });
});

describe("resolveBootstrapApp (Corrections 2, 3)", () => {
  const APP = (projectId?: string): AppLike => ({ options: { projectId } });

  function env(overrides: Partial<BootstrapAppEnv>): {
    env: BootstrapAppEnv;
    initCalls: string[];
  } {
    const initCalls: string[] = [];
    return {
      initCalls,
      env: {
        getExistingDefaultApp: () => null,
        initializeDefaultApp: (projectId) => {
          initCalls.push(projectId);
          return APP(projectId);
        },
        ...overrides,
      },
    };
  }

  test("no existing default app: initializes a fresh default bound to the acknowledged project", () => {
    const { env: e, initCalls } = env({ getExistingDefaultApp: () => null });
    const app = resolveBootstrapApp(e, "proj-A");
    expect(initCalls).toEqual(["proj-A"]);
    expect(app.options.projectId).toBe("proj-A");
  });

  test("only an unrelated NAMED app exists (no default): still initializes a fresh default (never reuses the named app)", () => {
    // getExistingDefaultApp models getApp() which returns only the [DEFAULT]
    // app or null; an unrelated named app leaves it null.
    const { env: e, initCalls } = env({ getExistingDefaultApp: () => null });
    const app = resolveBootstrapApp(e, "proj-A");
    expect(initCalls).toEqual(["proj-A"]);
    expect(app.options.projectId).toBe("proj-A");
  });

  test("existing default app bound to the acknowledged project is reused (no re-init)", () => {
    const { env: e, initCalls } = env({ getExistingDefaultApp: () => APP("proj-A") });
    const app = resolveBootstrapApp(e, "proj-A");
    expect(initCalls).toEqual([]);
    expect(app.options.projectId).toBe("proj-A");
  });

  test("existing default app bound to a DIFFERENT project fails closed (never adopted)", () => {
    const { env: e } = env({ getExistingDefaultApp: () => APP("proj-OTHER") });
    expect(() => resolveBootstrapApp(e, "proj-A")).toThrow(
      /bound to "proj-OTHER" but the acknowledged project is "proj-A"/,
    );
  });

  test("existing default app with NO explicit project binding fails closed", () => {
    const { env: e } = env({ getExistingDefaultApp: () => APP(undefined) });
    expect(() => resolveBootstrapApp(e, "proj-A")).toThrow(/not explicitly bound/);
  });
});
