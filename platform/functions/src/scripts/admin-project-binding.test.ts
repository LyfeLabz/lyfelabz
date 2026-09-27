import * as fs from "fs";
import { join } from "path";
import { deleteApp, getApp, getApps, initializeApp } from "firebase-admin/app";

import { bindAdminProjectReal } from "./admin-project-binding";
import { bindAdminProjectReal as publishVariantBinding } from "./publish-variant";
import { PRODUCTION_PROJECT_ID, STAGING_PROJECT_ID } from "./deployment-projects";

// One Admin SDK project-binding implementation serves publish-variant and
// deploy-assessment. The in-process binding tests below initialize a
// firebase-admin app only (no network, no Firestore access).

async function clearApps(): Promise<void> {
  await Promise.all(getApps().map((app) => deleteApp(app)));
}

describe("shared Admin SDK project binding", () => {
  const savedEnv = { ...process.env };

  beforeEach(async () => {
    await clearApps();
  });

  afterEach(async () => {
    await clearApps();
    process.env = { ...savedEnv };
  });

  test("publish-variant re-exports the one shared implementation", () => {
    expect(publishVariantBinding).toBe(bindAdminProjectReal);
  });

  test("deploy-assessment's real entry point wires the shared implementation", () => {
    const source = fs.readFileSync(join(__dirname, "deploy-assessment.ts"), "utf8");
    expect(source).toContain('import { bindAdminProjectReal } from "./admin-project-binding";');
    expect(source).toContain("bindAdminProject: bindAdminProjectReal,");
    // No second, local Admin SDK initialization path.
    expect(source).not.toMatch(/from "firebase-admin\/app"/);
  });

  test("explicit binding wins over FIREBASE_CONFIG and project variables naming staging", () => {
    process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: STAGING_PROJECT_ID });
    process.env.GCLOUD_PROJECT = STAGING_PROJECT_ID;
    process.env.GOOGLE_CLOUD_PROJECT = STAGING_PROJECT_ID;
    bindAdminProjectReal(PRODUCTION_PROJECT_ID);
    expect(getApp().options.projectId).toBe(PRODUCTION_PROJECT_ID);
  });

  test("an ambiently initialized default app with no explicit project fails closed", () => {
    process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: STAGING_PROJECT_ID });
    // Simulates code that initialized the default app from ambient config
    // before the CLI could bind it.
    initializeApp();
    expect(() => bindAdminProjectReal(PRODUCTION_PROJECT_ID)).toThrow(
      /default Admin SDK app is already bound to '.*', not 'lyfelabz-prod'/,
    );
  });
});
