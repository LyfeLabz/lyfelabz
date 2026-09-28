/*
 * ASTRA-004 staging prerequisite: canonical what-is-life assessment.
 *
 * Compatibility wrapper over the general staging assessment deployer
 * (./deploy-assessment-staging), which owns the one staging safety
 * implementation: literal staging project, authorized-user ADC impersonation,
 * direct Firestore bound to the explicit staging projectId, three-document
 * preflight, zero-write dry-run by default, and --apply before the certified
 * deployAssessmentRevision transaction.
 *
 *   node lib/scripts/deploy-what-is-life-staging.js --project=lyfelabz-staging [--apply]
 *
 * is exactly
 *
 *   node lib/scripts/deploy-assessment-staging.js --project=lyfelabz-staging --lesson=what-is-life [--apply]
 *
 * except that this wrapper accepts no --lesson argument and additionally
 * refuses anything other than the canonical r1 revision.
 */

import {
  main as stagingMain,
  parseArgs as parseStagingArgs,
  createRealCliDeps,
  LessonResolutionError,
  type CliDeps,
} from "./deploy-assessment-staging";

export {
  APPROVED_STAGING_SERVICE_ACCOUNT,
  FIRESTORE_OAUTH_SCOPE,
  IMPERSONATED_TOKEN_LIFETIME_SECONDS,
  ImpersonationCredentialError,
  STANDARD_FIRESTORE_SERVICE_PATH,
  STANDARD_IAM_CREDENTIALS_ENDPOINT,
  STAGING_DEPLOYMENT_FAILED,
  STAGING_IMPERSONATION_FAILED,
  STAGING_PREFLIGHT_READ_FAILED,
  STAGING_PROJECT_ID,
  STAGING_SOURCE_ADC_REJECTED,
  SourceAdcValidationError,
  acquireStagingImpersonatedCredential,
  canonicalDocumentPaths,
  classifyExistingState,
  createDirectStagingFirestore,
  createStagingImpersonatedClient,
  ensureStagingSafe,
  initializeDirectStagingRuntime,
  preflightStagingImpersonation,
  type CliDeps,
  type CliRuntime,
  type DirectStagingRuntimeDeps,
  type DocumentObservation,
  type ImpersonatedClientFactory,
} from "./deploy-assessment-staging";

export const CANONICAL_ACTIVITY_ID = "what-is-life";
export const CANONICAL_ASSESSMENT_ID = "assessment_what-is-life";
export const CANONICAL_REVISION_ID = "assessment_what-is-life__r1";
const CANONICAL_REVISION_ORDINAL = 1;

const USAGE =
  "Usage: deploy-what-is-life-staging --project=lyfelabz-staging [--apply]";

export type CliArgs = {
  readonly project: string;
  readonly apply: boolean;
};

export type ParseResult =
  | { readonly ok: true; readonly args: CliArgs }
  | { readonly ok: false; readonly message: string };

const LESSON_ARGUMENT = `--lesson=${CANONICAL_ACTIVITY_ID}`;

export function parseArgs(argv: readonly string[]): ParseResult {
  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") return { ok: false, message: USAGE };
    // The lesson is fixed; an operator-supplied --lesson is never merged.
    if (raw === "--lesson" || raw.startsWith("--lesson=")) {
      return { ok: false, message: `unknown argument: ${raw}` };
    }
  }
  const parsed = parseStagingArgs([...argv, LESSON_ARGUMENT]);
  if (!parsed.ok) return parsed;
  return { ok: true, args: { project: parsed.args.project, apply: parsed.args.apply } };
}

export async function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  deps: CliDeps,
): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    deps.logError(parsed.message);
    return 2;
  }
  return stagingMain([...argv, LESSON_ARGUMENT], env, pinCanonicalRevision(deps));
}

// The general deployer already binds the plan to the resolved slug and file
// revision; this wrapper keeps its historical narrower contract of r1 only.
function pinCanonicalRevision(deps: CliDeps): CliDeps {
  return {
    ...deps,
    resolveLessonPayload: (slug, requestedOrdinal) => {
      const resolved = deps.resolveLessonPayload(slug, requestedOrdinal);
      if (
        resolved.slug !== CANONICAL_ACTIVITY_ID ||
        resolved.revisionOrdinal !== CANONICAL_REVISION_ORDINAL
      ) {
        throw new LessonResolutionError(
          "repository payload does not resolve to canonical what-is-life r1 identity",
        );
      }
      return resolved;
    },
  };
}

if (require.main === module) {
  void main(process.argv.slice(2), process.env, createRealCliDeps())
    .then((code) => process.exit(code))
    .catch(() => {
      process.stderr.write("UNEXPECTED_STAGING_DEPLOYMENT_ERROR\n");
      process.exit(1);
    });
}
