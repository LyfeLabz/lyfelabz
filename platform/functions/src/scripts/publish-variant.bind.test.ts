import { deleteApp, getApp, getApps } from "firebase-admin/app";

import { bindAdminProjectReal, PRODUCTION_PROJECT_ID, STAGING_PROJECT_ID } from "./publish-variant";

// The real Admin SDK binding used by the publish-variant entry point. It only
// initializes an in-process firebase-admin app (no network, no Firestore
// access), proving that the explicit `projectId` option - which the Admin SDK
// prefers over service-account credentials, FIREBASE_CONFIG, project
// environment variables, and ADC quota-project metadata - is what the default
// app is bound to, and that a default app bound elsewhere fails closed.

async function clearApps(): Promise<void> {
  await Promise.all(getApps().map((app) => deleteApp(app)));
}

describe("bindAdminProjectReal", () => {
  const savedEnv = { ...process.env };

  beforeEach(async () => {
    await clearApps();
  });

  afterEach(async () => {
    await clearApps();
    process.env = { ...savedEnv };
  });

  test("binds the default app to the validated project even when the environment names another", () => {
    process.env.GOOGLE_CLOUD_PROJECT = STAGING_PROJECT_ID;
    process.env.GCLOUD_PROJECT = STAGING_PROJECT_ID;
    bindAdminProjectReal(PRODUCTION_PROJECT_ID);
    expect(getApp().options.projectId).toBe(PRODUCTION_PROJECT_ID);
  });

  test("is idempotent for the same project", () => {
    bindAdminProjectReal(PRODUCTION_PROJECT_ID);
    expect(() => bindAdminProjectReal(PRODUCTION_PROJECT_ID)).not.toThrow();
    expect(getApps()).toHaveLength(1);
  });

  test("refuses when the default app is already bound to a different project", () => {
    bindAdminProjectReal(STAGING_PROJECT_ID);
    expect(() => bindAdminProjectReal(PRODUCTION_PROJECT_ID)).toThrow(
      "default Admin SDK app is already bound to 'lyfelabz-staging', not 'lyfelabz-prod'",
    );
    expect(getApp().options.projectId).toBe(STAGING_PROJECT_ID);
  });
});
