/*
 * The two authorized non-emulator Firebase projects for repository-local
 * operational tooling, and the ambient-project checks every staging or
 * production command applies before touching either one.
 *
 * Pure module: no Firebase, Google Cloud, or credential imports, so staging
 * tooling that deliberately never loads the Admin SDK can depend on it.
 */

export const PRODUCTION_PROJECT_ID = "lyfelabz-prod";
export const STAGING_PROJECT_ID = "lyfelabz-staging";

// Environment variables that name a project for the Admin SDK, Google Cloud
// client libraries, or gcloud tooling. For a staging or production run each
// must be absent or already equal the validated target project.
export const PROJECT_ENV_KEYS = [
  "GCLOUD_PROJECT",
  "GOOGLE_CLOUD_PROJECT",
  "CLOUDSDK_CORE_PROJECT",
] as const;

// Returns the first project environment key whose non-empty value names a
// project other than `projectId`, or null when none conflicts.
export function conflictingProjectEnvKey(
  env: NodeJS.ProcessEnv,
  projectId: string,
): (typeof PROJECT_ENV_KEYS)[number] | null {
  for (const key of PROJECT_ENV_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0 && value !== projectId) {
      return key;
    }
  }
  return null;
}

// FIREBASE_CONFIG can supply a projectId to the Admin SDK and firebase-tools.
// Staging and production tooling refuses it outright rather than trusting it.
export function hasFirebaseConfigOverride(env: NodeJS.ProcessEnv): boolean {
  const value = env.FIREBASE_CONFIG;
  return typeof value === "string" && value.length > 0;
}
