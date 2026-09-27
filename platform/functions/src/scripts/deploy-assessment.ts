/*
 * Sprint 17 Slice 5A - Administrative Assessment Deployment CLI.
 *
 * Runs the certified `deployAssessmentRevision` implementation
 * (`../assessments/assessment-deployment`) from a trusted local shell so a
 * real assessment revision can exist in the emulator (or, with an explicit
 * opt-in flag, in a production Firestore project). No callable is
 * introduced; students, teachers, and browsers cannot reach this path. The
 * script is repository-local operational tooling, not new architecture.
 *
 * Safety posture:
 *
 *   - Default `--target` is `emulator`. A production run requires
 *     `--target=production`, `--i-know=production`, AND the explicit
 *     `--project=lyfelabz-prod`. Ambient project resolution is never trusted:
 *     a conflicting GCLOUD_PROJECT / GOOGLE_CLOUD_PROJECT /
 *     CLOUDSDK_CORE_PROJECT, or any FIREBASE_CONFIG, is refused.
 *   - Production is a zero-write dry-run by default: the payload is planned
 *     locally by the certified `planAssessmentRevision` and nothing touches
 *     Firebase. `--apply` is required before a write. Only then is the
 *     default Admin SDK app positively bound to lyfelabz-prod (the shared
 *     `bindAdminProjectReal`, as publish-variant does) BEFORE any Firestore
 *     access, so a service-account key for another project, ADC quota-project
 *     metadata, or a gcloud default cannot redirect the write.
 *   - Emulator mode sets `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` and
 *     `GCLOUD_PROJECT=lyfelabz-prod` if unset so a `firebase-admin`
 *     initializeApp() call binds to the local emulator; production mode
 *     refuses to run if `FIRESTORE_EMULATOR_HOST` is set (would otherwise
 *     silently overwrite emulator data while claiming to have deployed to
 *     production) or if `GOOGLE_APPLICATION_CREDENTIALS` is unset (would
 *     otherwise fail obscurely at write time).
 *   - The deployment payload is validated by the certified
 *     `deployAssessmentRevision` transaction. The CLI does no shape
 *     validation of its own beyond "parse as JSON and hand to the
 *     canonical validator" so there is no risk of a second deployment
 *     implementation drifting from the certified one.
 *   - Duplicate revisions are refused by the deployment transaction
 *     (assessmentDeployment.duplicateRevision). The CLI translates that
 *     into an exit code and a concise message.
 */

// Injection seams. `main()` is exported for unit testing without pulling
// firebase-admin into the jest process. The real CLI wires the seams to
// the certified deployment function + Node fs + Node process at run time.
export type CliArgs = {
  readonly target: "emulator" | "production";
  readonly file: string;
  readonly iKnowProduction: boolean;
  readonly project: string | null;
  readonly apply: boolean;
};

export type CliDeps = {
  readonly readFile: (path: string) => string;
  readonly deploy: (input: unknown) => Promise<{
    readonly assessmentId: string;
    readonly revisionId: string;
    readonly revisionOrdinal: number;
    readonly assessmentCreated: boolean;
  }>;
  readonly env: NodeJS.ProcessEnv;
  readonly setEnv: (key: string, value: string) => void;
  // Positively binds the default Admin SDK app to the validated project
  // before any Firestore access (production --apply only).
  readonly bindAdminProject: (projectId: string) => void;
  readonly log: (message: string) => void;
  readonly logError: (message: string) => void;
};

export type ArgParseResult =
  | { readonly ok: true; readonly args: CliArgs }
  | { readonly ok: false; readonly message: string };

const USAGE =
  "Usage: deploy-assessment --file=<path> [--target=emulator|production] " +
  "[--project=lyfelabz-prod --i-know=production [--apply]]";

export function parseArgs(argv: readonly string[]): ArgParseResult {
  let target: "emulator" | "production" = "emulator";
  let file: string | undefined;
  let iKnowProduction = false;
  let project: string | null = null;
  let apply = false;
  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") {
      return { ok: false, message: USAGE };
    }
    if (raw === "--apply") {
      if (apply) return { ok: false, message: "--apply may be supplied only once" };
      apply = true;
      continue;
    }
    const eq = raw.indexOf("=");
    if (!raw.startsWith("--") || eq < 0) {
      return { ok: false, message: `unknown argument: ${raw}` };
    }
    const key = raw.slice(2, eq);
    const value = raw.slice(eq + 1);
    if (key === "target") {
      if (value !== "emulator" && value !== "production") {
        return { ok: false, message: `--target must be emulator or production` };
      }
      target = value;
    } else if (key === "file") {
      if (value.length === 0) return { ok: false, message: "--file is required" };
      file = value;
    } else if (key === "i-know") {
      if (value !== "production") {
        return { ok: false, message: "--i-know only accepts the literal 'production'" };
      }
      iKnowProduction = true;
    } else if (key === "project") {
      if (project !== null) return { ok: false, message: "--project may be supplied only once" };
      if (value.length === 0) return { ok: false, message: "--project requires a project id" };
      project = value;
    } else {
      return { ok: false, message: `unknown argument: --${key}` };
    }
  }
  if (file === undefined) {
    return { ok: false, message: "--file is required" };
  }
  if (target === "emulator" && project !== null) {
    return { ok: false, message: "--project applies only to --target=production" };
  }
  return { ok: true, args: { target, file, iKnowProduction, project, apply } };
}

// Environment gate. Emulator runs are safe by default; production runs
// require an explicit second flag, the explicit literal production project,
// no ambient project source naming anything else, and no Firestore emulator
// host (that combination would silently redirect a "production" deploy to
// the local emulator). Dry-run and --apply pass the same gate, so a clean
// dry-run proves the apply command line is admissible.
export function ensureTargetSafe(args: CliArgs, env: NodeJS.ProcessEnv): string | null {
  if (args.target === "emulator") {
    return null;
  }
  if (!args.iKnowProduction) {
    return "production target requires --i-know=production";
  }
  if (args.project === null) {
    return `production target requires --project=${PRODUCTION_PROJECT_ID} (explicit, verified project id; ambient project resolution is never trusted)`;
  }
  if (args.project !== PRODUCTION_PROJECT_ID) {
    return `production target refuses project '${args.project}': only '${PRODUCTION_PROJECT_ID}' is authorized`;
  }
  const emulatorHost = env.FIRESTORE_EMULATOR_HOST;
  if (typeof emulatorHost === "string" && emulatorHost.length > 0) {
    return "refusing production deploy while FIRESTORE_EMULATOR_HOST is set";
  }
  const conflictingKey = conflictingProjectEnvKey(env, PRODUCTION_PROJECT_ID);
  if (conflictingKey !== null) {
    return `refusing production deploy: ${conflictingKey} does not match the authorized production project '${PRODUCTION_PROJECT_ID}'`;
  }
  if (hasFirebaseConfigOverride(env)) {
    return "refusing production deploy while FIREBASE_CONFIG is set (it can supply another project to the Admin SDK); unset it";
  }
  const credentials = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (typeof credentials !== "string" || credentials.length === 0) {
    return "production target requires GOOGLE_APPLICATION_CREDENTIALS";
  }
  return null;
}

// Configure the environment for the requested target BEFORE
// `deployAssessmentRevision` is loaded, because firebase-admin captures
// FIRESTORE_EMULATOR_HOST at initializeApp() time.
export function configureEmulatorEnv(env: NodeJS.ProcessEnv, setEnv: (k: string, v: string) => void): void {
  if (!env.FIRESTORE_EMULATOR_HOST) {
    setEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080");
  }
  if (!env.GCLOUD_PROJECT && !env.GOOGLE_CLOUD_PROJECT) {
    setEnv("GCLOUD_PROJECT", "lyfelabz-prod");
  }
}

export async function main(argv: readonly string[], deps: CliDeps): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    deps.logError(parsed.message);
    return 2;
  }
  const args = parsed.args;

  const safetyErr = ensureTargetSafe(args, deps.env);
  if (safetyErr !== null) {
    deps.logError(safetyErr);
    return 2;
  }

  if (args.target === "emulator") {
    configureEmulatorEnv(deps.env, deps.setEnv);
  }

  let contents: string;
  try {
    contents = deps.readFile(args.file);
  } catch (err) {
    deps.logError(`could not read ${args.file}: ${(err as Error).message}`);
    return 2;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(contents);
  } catch (err) {
    deps.logError(`invalid JSON in ${args.file}: ${(err as Error).message}`);
    return 2;
  }

  if (args.target === "production") {
    // Local validation by the certified planner; no Firebase access.
    let plan: AssessmentDeploymentPlan;
    try {
      plan = planAssessmentRevision(payload);
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      deps.logError(
        `payload validation failed${typeof code === "string" ? ` [${code}]` : ""}: ${(err as Error).message}`,
      );
      return 2;
    }
    if (!args.apply) {
      deps.log(
        `dry-run ok assessment=${plan.assessmentId} revision=${plan.revisionId} ` +
          `ordinal=${String(plan.input.revisionOrdinal)} items=${String(plan.revisionWrite.items.length)} ` +
          `answerKeyItems=${String(plan.answerKeyWrite.items.length)} writes=0 ` +
          `target=production project=${PRODUCTION_PROJECT_ID} (re-run with --apply to write)`,
      );
      return 0;
    }
    try {
      // args.project is proven === PRODUCTION_PROJECT_ID by ensureTargetSafe.
      deps.setEnv("GCLOUD_PROJECT", PRODUCTION_PROJECT_ID);
      deps.setEnv("GOOGLE_CLOUD_PROJECT", PRODUCTION_PROJECT_ID);
      deps.bindAdminProject(PRODUCTION_PROJECT_ID);
    } catch (err) {
      deps.logError(
        `refusing to run: could not bind the Admin SDK to '${PRODUCTION_PROJECT_ID}': ${(err as Error).message}`,
      );
      return 2;
    }
  }

  try {
    const outcome = await deps.deploy(payload);
    deps.log(
      `deployed assessment=${outcome.assessmentId} revision=${outcome.revisionId} ` +
        `ordinal=${String(outcome.revisionOrdinal)} ` +
        `assessmentCreated=${String(outcome.assessmentCreated)} target=${args.target}`,
    );
    return 0;
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    const message = (err as Error).message ?? String(err);
    deps.logError(
      `deployment failed${typeof code === "string" ? ` [${code}]` : ""}: ${message}`,
    );
    return 1;
  }
}

// Entry point. Only executed when the file is invoked directly via
// `node lib/scripts/deploy-assessment.js`. `require.main === module` is
// the CommonJS convention that keeps the module import-safe for tests.
import * as fs from "fs";
import {
  deployAssessmentRevision,
  planAssessmentRevision,
  type AssessmentDeploymentPlan,
} from "../assessments/assessment-deployment";
import { bindAdminProjectReal } from "./admin-project-binding";
import {
  PRODUCTION_PROJECT_ID,
  conflictingProjectEnvKey,
  hasFirebaseConfigOverride,
} from "./deployment-projects";

if (require.main === module) {
  void main(process.argv.slice(2), {
    readFile: (p: string) => fs.readFileSync(p, "utf8"),
    deploy: deployAssessmentRevision,
    env: process.env,
    setEnv: (key, value) => {
      process.env[key] = value;
    },
    bindAdminProject: bindAdminProjectReal,
    log: (message) => {
      process.stdout.write(`${message}\n`);
    },
    logError: (message) => {
      process.stderr.write(`${message}\n`);
    },
  })
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`unexpected error: ${(err as Error).message}\n`);
      process.exit(1);
    });
}
