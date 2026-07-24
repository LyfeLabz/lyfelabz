// Regression test for the "default Firebase app does not exist" incident.
// See platform/functions/src/shared/firestore/admin.test.ts for the full
// scenario. `getAdminAuth` shares the same guard shape as
// `getAdminFirestore` and must survive the same firebase-functions
// named-only-app startup condition.
export {};

async function resetAllApps(): Promise<void> {
  const { getApps, deleteApp } = await import("firebase-admin/app");
  for (const app of getApps()) {
    // eslint-disable-next-line no-await-in-loop
    await deleteApp(app);
  }
}

describe("getAdminAuth", () => {
  beforeEach(async () => {
    jest.resetModules();
    await resetAllApps();
  });

  afterEach(async () => {
    await resetAllApps();
  });

  it("initializes the DEFAULT app when only a named app exists", async () => {
    const appModule = await import("firebase-admin/app");
    appModule.initializeApp(
      { projectId: "regression-test" },
      "firebase-functions-app",
    );
    expect(() => appModule.getApp()).toThrow();

    const { getAdminAuth } = await import("./admin");
    const auth = getAdminAuth();

    expect(auth).toBeDefined();
    expect(() => appModule.getApp()).not.toThrow();
    expect(appModule.getApp().name).toBe("[DEFAULT]");
  });

  it("returns the same Auth instance on repeated calls", async () => {
    const appModule = await import("firebase-admin/app");
    appModule.initializeApp(
      { projectId: "regression-test" },
      "firebase-functions-app",
    );
    const { getAdminAuth } = await import("./admin");
    expect(getAdminAuth()).toBe(getAdminAuth());
  });
});
