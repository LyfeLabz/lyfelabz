import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";

// Positive Admin SDK project binding shared by the production/staging
// operational CLIs (publish-variant, deploy-assessment). Explicit app options
// take precedence over every ambient source (service-account key project,
// FIREBASE_CONFIG, GOOGLE_CLOUD_PROJECT/GCLOUD_PROJECT, ADC quota project), so
// initializing the DEFAULT app with `projectId` before any Firestore access
// pins every typed-ref read/write (shared/firestore/admin.ts reuses the
// existing default app) to the validated project. An already-initialized
// default app bound anywhere else fails closed.
export function bindAdminProjectReal(projectId: string): void {
  const existing = getApps().find((app) => app.name === "[DEFAULT]");
  if (existing) {
    if (existing.options.projectId !== projectId) {
      throw new Error(
        `default Admin SDK app is already bound to '${String(existing.options.projectId)}', not '${projectId}'`,
      );
    }
    return;
  }
  const app = initializeApp({ projectId, credential: applicationDefault() });
  if (app.options.projectId !== projectId) {
    throw new Error(`Admin SDK app bound to '${String(app.options.projectId)}', not '${projectId}'`);
  }
}
