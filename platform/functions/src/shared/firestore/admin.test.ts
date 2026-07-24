// Regression test for the "default Firebase app does not exist" incident.
//
// Prior implementation used `getApps().length === 0` as the "should I
// initialize?" guard. `firebase-functions` (v2 callables and background
// triggers) registers its own named-only admin app during startup, which
// makes `getApps()` non-empty even though the `[DEFAULT]` app has not
// been initialized. Under that condition `getFirestore()` throws
//   "The default Firebase app does not exist."
// and the callable request returns HTTP 500. This test simulates the
// exact scenario and asserts the guard actually initializes the
// `[DEFAULT]` app before returning a Firestore handle.
export {};

async function resetAllApps(): Promise<void> {
  const { getApps, deleteApp } = await import("firebase-admin/app");
  for (const app of getApps()) {
    // eslint-disable-next-line no-await-in-loop
    await deleteApp(app);
  }
}

describe("getAdminFirestore", () => {
  beforeEach(async () => {
    jest.resetModules();
    await resetAllApps();
  });

  afterEach(async () => {
    await resetAllApps();
  });

  it("initializes the DEFAULT app when only a named app exists", async () => {
    // jest.resetModules() gives our tested module a fresh copy of
    // firebase-admin. To observe app-store state from the same copy, we
    // import both through the dynamic-import channel.
    const appModule = await import("firebase-admin/app");
    appModule.initializeApp(
      { projectId: "regression-test" },
      "firebase-functions-app",
    );
    expect(appModule.getApps()).toHaveLength(1);
    expect(() => appModule.getApp()).toThrow();

    const { getAdminFirestore } = await import("./admin");
    const firestore = getAdminFirestore();

    expect(firestore).toBeDefined();
    expect(() => appModule.getApp()).not.toThrow();
    expect(appModule.getApp().name).toBe("[DEFAULT]");
  });

  it("returns the same Firestore instance on repeated calls", async () => {
    const appModule = await import("firebase-admin/app");
    appModule.initializeApp(
      { projectId: "regression-test" },
      "firebase-functions-app",
    );
    const { getAdminFirestore } = await import("./admin");
    expect(getAdminFirestore()).toBe(getAdminFirestore());
  });

  it("reuses an already-initialized DEFAULT app rather than throwing", async () => {
    const appModule = await import("firebase-admin/app");
    appModule.initializeApp({ projectId: "regression-test" });
    const { getAdminFirestore } = await import("./admin");
    expect(() => getAdminFirestore()).not.toThrow();
  });
});
