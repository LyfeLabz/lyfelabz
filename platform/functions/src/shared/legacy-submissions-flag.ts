import { PlatformError } from "./errors/platform-error";

// Sprint 11C Remediation Slice 1 - Critical Finding C-4.
//
// Reconciliation-only deployment gate per PDR-026 §26. The certified
// architecture supersedes `submissions/{submissionId}` with
// `attempts/{attemptId}` and requires that "the two collections MUST NOT
// be simultaneously writable in production." The attempts write path
// (`assessmentAttemptsFinalize`) is the production writer for
// authoritative attempts as of Sprint 11C. The legacy `submissionsCreate`
// and `submissionsFinalize` callables remain in the code base for the
// migration window described in §26 but MUST be inert in production
// unless a deployment operator explicitly opts back into them during a
// data-migration reconciliation run.
//
// The gate is a single environment variable, evaluated at request time.
// The default is inert: any production deployment that does not set the
// variable refuses the legacy write with the canonical
// `submissions.legacyWritesDisabled` identifier, guaranteeing that no
// pre-existing deployment can silently keep both write paths live.
//
// This helper is the sole authority for the gate. Individual callables
// consume it; no other rule check is required.

export const LEGACY_SUBMISSIONS_ENV_VAR =
  "LYFELABZ_LEGACY_SUBMISSIONS_WRITES_ENABLED";

export function legacySubmissionsWritesEnabled(): boolean {
  const raw = process.env[LEGACY_SUBMISSIONS_ENV_VAR];
  if (raw === undefined) return false;
  return raw.trim().toLowerCase() === "true";
}

export function assertLegacySubmissionsWritesEnabled(): void {
  if (legacySubmissionsWritesEnabled()) return;
  throw new PlatformError(
    "submissions.legacyWritesDisabled",
    "Legacy submissions write path is disabled; the attempts pipeline is the authoritative writer per PDR-026 §26.",
  );
}
