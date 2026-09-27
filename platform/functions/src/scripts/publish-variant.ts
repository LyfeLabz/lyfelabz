/*
 * Administrative differentiated-presentation publication CLI (F5.2 §6.8,
 * Slice 3).
 *
 * Runs the certified publication state machine (`../variants/variant-
 * publication`) from a trusted local shell to advance the current-
 * presentation index (`presentationVariants/{lessonSlug}__{variantKey}`) for
 * an ALREADY-RETAINED, immutable revision. No callable is introduced;
 * students, teachers, and browsers cannot reach this path. It is repository-
 * local operational tooling, not new architecture, and it is NOT ordinary
 * teacher functionality.
 *
 * What it does NOT do: it never builds, rewrites, or deletes an artifact or a
 * manifest entry (those are Slice 2 add-only concerns); it never accepts an
 * arbitrary output path, sha256, or revision id from the caller - it derives
 * and validates everything from the trusted manifest; and it advances the
 * Firestore index ONLY after hosted-byte liveness verification (the machine
 * enforces the index-last order, not this CLI).
 *
 * Safety posture (mirrors deploy-assessment.ts):
 *
 *   - Default `--target` is `emulator`. A production run (real Hosting
 *     liveness fetch + real Firestore index write) requires BOTH
 *     `--target=production` AND `--i-know=production`.
 *   - Production mode refuses to run if `FIRESTORE_EMULATOR_HOST` is set
 *     (would silently redirect the "production" index write to the emulator)
 *     or if `GOOGLE_APPLICATION_CREDENTIALS` is unset.
 *   - Attribution (`--published-by`, or LYFELABZ_PUBLISH_OPERATOR) is
 *     server/operator context, never accepted from an untrusted request.
 *
 * `main()` is exported and unit-tested with injected `publish`/`retire`
 * seams, so the jest process never loads firebase-admin. The real CLI wires
 * the seams to the certified state machine + Node fs/crypto/fetch + the
 * Admin SDK typed refs at the bottom of this file.
 */

import type {
  PublishInput,
  PublishResult,
  RetireInput,
  RetireResult,
  DeployHostingPort,
} from "../variants/variant-publication";
import {
  PRODUCTION_PROJECT_ID,
  PROJECT_ENV_KEYS,
  STAGING_PROJECT_ID,
} from "./deployment-projects";

export type PublishOp = "publish" | "rollback" | "retire";

// The ONE authorized non-production live environment for the Slices 1-6 staging
// integration certification gate. This is a hard literal, never derived from a
// Firebase alias name (an alias is a local label and is not a trust boundary):
// every staging deploy or Firestore mutation must positively resolve to exactly
// this project id or fail closed. Production (`lyfelabz-prod`) is never a
// fallback for the staging target.
// Defined once in ./deployment-projects and re-exported here.
export { STAGING_PROJECT_ID };

// The ONE production project. Like staging, a hard literal: a production
// publication must name it explicitly (`--project=lyfelabz-prod`) and the Admin
// SDK is then positively bound to it (see `bindAdminProject`), so ambient
// credentials, a service-account key for another project, ADC quota-project
// metadata, `FIREBASE_CONFIG`, or a gcloud default can never redirect the
// production index write.
export { PRODUCTION_PROJECT_ID };

// The only origins that serve the lyfelabz-prod application Hosting site. The
// production liveness fetch uses exactly the validated `--hosting-origin`.
export const PRODUCTION_HOSTING_ORIGINS: readonly string[] = [
  "https://app.lyfelabz.com",
  "https://lyfelabz-prod.web.app",
];

// Environment variables that name a project for the Admin SDK or gcloud
// tooling. For a staging or production run each must be absent or already
// equal the validated target project.
// (PROJECT_ENV_KEYS is shared from ./deployment-projects.)

export type PublishTarget = "emulator" | "staging" | "production";

// Per-run context main() hands to the publish seam: the origin the liveness
// fetch MUST use. For staging and production it is the validated
// `--hosting-origin`; only the emulator falls back to LYFELABZ_HOSTING_ORIGIN.
export type PublishContext = {
  readonly fetchOrigin: string;
};

export type CliArgs = {
  readonly op: PublishOp;
  readonly target: PublishTarget;
  readonly lessonSlug: string;
  readonly variantKey: string;
  readonly presentationRevisionId: string | null;
  readonly publishedBy: string;
  readonly hostingOrigin: string | null;
  readonly iKnowProduction: boolean;
  // Explicit, operator-supplied project id. Required for the staging and
  // production targets and must equal STAGING_PROJECT_ID / PRODUCTION_PROJECT_ID
  // respectively; the double lock (explicit intent + literal guard) means a
  // mistyped or defaulted project can never silently deploy or write.
  readonly project: string | null;
};

export type CliDeps = {
  // Injected engine seams. The real CLI wires these to the state machine with
  // real ports; tests wire fakes so no Hosting/Firestore/network is touched.
  readonly publish: (input: PublishInput, context: PublishContext) => Promise<PublishResult>;
  readonly retire: (input: RetireInput) => Promise<RetireResult>;
  // Positively binds the Admin SDK default app to the validated project id
  // before any Firestore access, throwing if it cannot (for example an app is
  // already bound elsewhere). Called for the staging and production targets.
  readonly bindAdminProject: (projectId: string) => void;
  readonly env: NodeJS.ProcessEnv;
  readonly setEnv: (key: string, value: string) => void;
  readonly log: (message: string) => void;
  readonly logError: (message: string) => void;
};

export type ArgParseResult =
  | { readonly ok: true; readonly args: CliArgs }
  | { readonly ok: false; readonly message: string };

const USAGE =
  "Usage: publish-variant --lesson=<slug> --variant=<variantKey> " +
  "[--op=publish|rollback|retire] [--revision=<presentationRevisionId>] " +
  "[--published-by=<operator>] [--hosting-origin=<https://...>] " +
  "[--target=emulator|staging|production] [--project=<projectId>] " +
  "[--i-know=production]";

export function parseArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = {},
): ArgParseResult {
  let op: PublishOp = "publish";
  let target: PublishTarget = "emulator";
  let lessonSlug: string | undefined;
  let variantKey: string | undefined;
  let presentationRevisionId: string | null = null;
  let publishedBy: string | undefined;
  let hostingOrigin: string | null = null;
  let iKnowProduction = false;
  let project: string | null = null;

  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") {
      return { ok: false, message: USAGE };
    }
    const eq = raw.indexOf("=");
    if (!raw.startsWith("--") || eq < 0) {
      return { ok: false, message: `unknown argument: ${raw}` };
    }
    const key = raw.slice(2, eq);
    const value = raw.slice(eq + 1);
    switch (key) {
      case "op":
        if (value !== "publish" && value !== "rollback" && value !== "retire") {
          return { ok: false, message: "--op must be publish, rollback, or retire" };
        }
        op = value;
        break;
      case "target":
        if (value !== "emulator" && value !== "staging" && value !== "production") {
          return { ok: false, message: "--target must be emulator, staging, or production" };
        }
        target = value;
        break;
      case "project":
        project = value.length > 0 ? value : null;
        break;
      case "lesson":
        if (value.length === 0) return { ok: false, message: "--lesson is required" };
        lessonSlug = value;
        break;
      case "variant":
        if (value.length === 0) return { ok: false, message: "--variant is required" };
        variantKey = value;
        break;
      case "revision":
        presentationRevisionId = value.length > 0 ? value : null;
        break;
      case "published-by":
        publishedBy = value;
        break;
      case "hosting-origin":
        hostingOrigin = value.length > 0 ? value : null;
        break;
      case "i-know":
        if (value !== "production") {
          return { ok: false, message: "--i-know only accepts the literal 'production'" };
        }
        iKnowProduction = true;
        break;
      default:
        return { ok: false, message: `unknown argument: --${key}` };
    }
  }

  if (lessonSlug === undefined) return { ok: false, message: "--lesson is required" };
  if (variantKey === undefined) return { ok: false, message: "--variant is required" };

  const resolvedPublishedBy =
    publishedBy !== undefined && publishedBy.length > 0
      ? publishedBy
      : env.LYFELABZ_PUBLISH_OPERATOR ?? "";
  if (resolvedPublishedBy.length === 0) {
    return {
      ok: false,
      message:
        "--published-by (or LYFELABZ_PUBLISH_OPERATOR) is required: publication attribution is server-owned",
    };
  }

  if ((op === "publish" || op === "rollback") && presentationRevisionId === null) {
    return { ok: false, message: `--revision is required for --op=${op}` };
  }

  return {
    ok: true,
    args: {
      op,
      target,
      lessonSlug,
      variantKey,
      presentationRevisionId,
      publishedBy: resolvedPublishedBy,
      hostingOrigin,
      iKnowProduction,
      project,
    },
  };
}

// Positively proves that a would-be staging operation resolves to exactly the
// authorized staging project, failing closed otherwise. An alias name is never
// trusted: the explicit `--project` must equal the STAGING_PROJECT_ID literal,
// and any project already present in the environment (which the Admin SDK would
// otherwise pick up) must agree - so production can never be reached, whether by
// default, by a stale env var, or by a mistyped flag.
export function ensureStagingTargetSafe(
  args: CliArgs,
  env: NodeJS.ProcessEnv,
): string | null {
  if (args.project === null) {
    return `staging target requires --project=${STAGING_PROJECT_ID} (explicit, verified project id; an alias name is not trusted)`;
  }
  if (args.project !== STAGING_PROJECT_ID) {
    return `staging target refuses project '${args.project}': only '${STAGING_PROJECT_ID}' is authorized`;
  }
  const emulatorHost = env.FIRESTORE_EMULATOR_HOST;
  if (typeof emulatorHost === "string" && emulatorHost.length > 0) {
    return "refusing staging publish while FIRESTORE_EMULATOR_HOST is set (would redirect the staging index write to the emulator)";
  }
  // The Admin SDK reads these; if either is set it MUST already be staging, so a
  // leftover production project id can never silently receive the index write.
  for (const key of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT"] as const) {
    const val = env[key];
    if (typeof val === "string" && val.length > 0 && val !== STAGING_PROJECT_ID) {
      return `refusing staging publish: ${key}='${val}' does not match the authorized staging project '${STAGING_PROJECT_ID}'`;
    }
  }
  const credentials = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (typeof credentials !== "string" || credentials.length === 0) {
    return "staging target requires GOOGLE_APPLICATION_CREDENTIALS (staging service-account credentials for the Admin SDK index write)";
  }
  if (args.op === "publish" || args.op === "rollback") {
    if (args.hostingOrigin === null) {
      return `staging --op=${args.op} requires --hosting-origin=<https://...> for the liveness fetch`;
    }
    let host: string;
    try {
      const parsed = new URL(args.hostingOrigin);
      if (parsed.protocol !== "https:") {
        return `staging --hosting-origin must be https (got '${args.hostingOrigin}')`;
      }
      host = parsed.hostname;
    } catch {
      return `staging --hosting-origin is not a valid URL: '${args.hostingOrigin}'`;
    }
    if (!host.includes(STAGING_PROJECT_ID)) {
      return `staging --hosting-origin '${args.hostingOrigin}' does not resolve to the '${STAGING_PROJECT_ID}' hosting site (refusing to fetch liveness from a non-staging origin)`;
    }
  }
  return null;
}

export function ensureTargetSafe(args: CliArgs, env: NodeJS.ProcessEnv): string | null {
  if (args.target === "emulator") {
    return null;
  }
  if (args.target === "staging") {
    return ensureStagingTargetSafe(args, env);
  }
  return ensureProductionTargetSafe(args, env);
}

// Canonical form of an approved production origin (one trailing slash is
// tolerated), or null when the value is not exactly an approved origin.
export function normalizeProductionOrigin(value: string): string | null {
  const trimmed = value.endsWith("/") ? value.slice(0, -1) : value;
  return PRODUCTION_HOSTING_ORIGINS.includes(trimmed) ? trimmed : null;
}

// Positively proves that a would-be production operation is explicitly and
// exclusively bound to lyfelabz-prod and its Hosting site, failing closed
// otherwise. Mirrors ensureStagingTargetSafe, plus the explicit production
// acknowledgement.
export function ensureProductionTargetSafe(
  args: CliArgs,
  env: NodeJS.ProcessEnv,
): string | null {
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
    return "refusing production publish while FIRESTORE_EMULATOR_HOST is set";
  }
  for (const key of PROJECT_ENV_KEYS) {
    const val = env[key];
    if (typeof val === "string" && val.length > 0 && val !== PRODUCTION_PROJECT_ID) {
      return `refusing production publish: ${key}='${val}' does not match the authorized production project '${PRODUCTION_PROJECT_ID}'`;
    }
  }
  const firebaseConfig = env.FIREBASE_CONFIG;
  if (typeof firebaseConfig === "string" && firebaseConfig.length > 0) {
    return "refusing production publish while FIREBASE_CONFIG is set (it can supply another project to the Admin SDK); unset it";
  }
  const credentials = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (typeof credentials !== "string" || credentials.length === 0) {
    return "production target requires GOOGLE_APPLICATION_CREDENTIALS";
  }
  // A real publish/rollback must know where to fetch the hosted artifact for
  // the liveness check; without an origin the machine cannot prove liveness.
  if ((args.op === "publish" || args.op === "rollback") && args.hostingOrigin === null) {
    return `production --op=${args.op} requires --hosting-origin=<https://...> for the liveness fetch`;
  }
  if (args.hostingOrigin !== null) {
    const origin = normalizeProductionOrigin(args.hostingOrigin);
    if (origin === null) {
      return (
        `production --hosting-origin '${args.hostingOrigin}' is not an approved production origin ` +
        `(${PRODUCTION_HOSTING_ORIGINS.join(", ")})`
      );
    }
    // The liveness fetch uses exactly the validated origin; an environment
    // origin that disagrees is refused rather than silently ignored.
    const envOrigin = env.LYFELABZ_HOSTING_ORIGIN;
    if (typeof envOrigin === "string" && envOrigin.length > 0 && normalizeProductionOrigin(envOrigin) !== origin) {
      return `refusing production publish: LYFELABZ_HOSTING_ORIGIN='${envOrigin}' disagrees with --hosting-origin '${origin}'`;
    }
  }
  return null;
}

export function configureEmulatorEnv(
  env: NodeJS.ProcessEnv,
  setEnv: (k: string, v: string) => void,
): void {
  if (!env.FIRESTORE_EMULATOR_HOST) {
    setEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080");
  }
  if (!env.GCLOUD_PROJECT && !env.GOOGLE_CLOUD_PROJECT) {
    setEnv("GCLOUD_PROJECT", "lyfelabz-prod");
  }
}

// Binds the Admin SDK to the authorized staging project explicitly. Unlike the
// emulator path, this NEVER falls back to a default project: it is only ever
// called after ensureStagingTargetSafe has proven the project id, and it forces
// both env vars the Admin SDK consults to that verified id so no ambient or
// defaulted project (including production) can be reached. Must not be called
// for any other target.
export function configureStagingEnv(
  projectId: string,
  setEnv: (k: string, v: string) => void,
): void {
  if (projectId !== STAGING_PROJECT_ID) {
    // Defense in depth: the caller already validated this, but never let a
    // non-staging id through to the Admin SDK.
    throw new Error(
      `configureStagingEnv refuses project '${projectId}': only '${STAGING_PROJECT_ID}' is authorized`,
    );
  }
  setEnv("GCLOUD_PROJECT", projectId);
  setEnv("GOOGLE_CLOUD_PROJECT", projectId);
}

// Production counterpart of configureStagingEnv: only ever called after
// ensureProductionTargetSafe has proven the project id, and refuses any other
// id as defense in depth. Environment variables alone are NOT a sufficient
// binding (the Admin SDK prefers app options and service-account credentials
// over them); main() additionally calls deps.bindAdminProject.
export function configureProductionEnv(
  projectId: string,
  setEnv: (k: string, v: string) => void,
): void {
  if (projectId !== PRODUCTION_PROJECT_ID) {
    throw new Error(
      `configureProductionEnv refuses project '${projectId}': only '${PRODUCTION_PROJECT_ID}' is authorized`,
    );
  }
  setEnv("GCLOUD_PROJECT", projectId);
  setEnv("GOOGLE_CLOUD_PROJECT", projectId);
}

export async function main(argv: readonly string[], deps: CliDeps): Promise<number> {
  const parsed = parseArgs(argv, deps.env);
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

  let fetchOrigin: string;
  try {
    if (args.target === "emulator") {
      configureEmulatorEnv(deps.env, deps.setEnv);
      fetchOrigin = deps.env.LYFELABZ_HOSTING_ORIGIN ?? "";
    } else if (args.target === "staging") {
      // args.project is proven === STAGING_PROJECT_ID by ensureTargetSafe above.
      configureStagingEnv(args.project as string, deps.setEnv);
      deps.bindAdminProject(STAGING_PROJECT_ID);
      fetchOrigin = args.hostingOrigin ?? "";
    } else {
      // args.project is proven === PRODUCTION_PROJECT_ID and the origin is an
      // approved production origin (ensureProductionTargetSafe above).
      configureProductionEnv(args.project as string, deps.setEnv);
      deps.bindAdminProject(PRODUCTION_PROJECT_ID);
      fetchOrigin = args.hostingOrigin !== null ? (normalizeProductionOrigin(args.hostingOrigin) as string) : "";
    }
  } catch (err) {
    deps.logError(`refusing to run: could not bind the Admin SDK to the target project: ${(err as Error).message}`);
    return 2;
  }

  try {
    if (args.op === "retire") {
      const result = await deps.retire({
        lessonSlug: args.lessonSlug,
        variantKey: args.variantKey,
        publishedBy: args.publishedBy,
      });
      if (!result.ok) {
        deps.logError(`retire failed: ${result.error}`);
        return 1;
      }
      deps.log(
        `retired variant=${args.lessonSlug}__${args.variantKey} ` +
          `changed=${String(result.retired)} (${result.note}) target=${args.target}`,
      );
      return 0;
    }

    const result = await deps.publish(
      {
        lessonSlug: args.lessonSlug,
        variantKey: args.variantKey,
        presentationRevisionId: args.presentationRevisionId as string,
        publishedBy: args.publishedBy,
        mode: args.op,
      },
      { fetchOrigin },
    );
    if (!result.ok) {
      deps.logError(
        `${args.op} failed at stage ${result.failedStage}: ${result.error} ` +
          `[index advanced: ${String(result.indexAdvanced)}]`,
      );
      return 1;
    }
    deps.log(
      `${args.op} ok: variant=${result.revision.lessonSlug}__${result.revision.variantKey} ` +
        `revision=${result.revision.presentationRevisionId} ` +
        `stages=${result.stagesCompleted.join(">")} target=${args.target}`,
    );
    return 0;
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    deps.logError(`unexpected publication error: ${message}`);
    return 1;
  }
}

// Runs the actual `firebase deploy --only hosting` for a proven project id and
// throws on any non-zero/failed invocation. Injected into
// makeStagingDeployHosting so the guard logic is unit-testable without spawning
// a process; the entry point supplies the real execFileSync-backed runner.
export type DeployRunner = (projectId: string) => void;

// Builds the §6.8 step-7 Hosting deploy port for the staging target. It is
// fail-closed: it refuses to deploy unless the project id is exactly
// STAGING_PROJECT_ID, so even a bug upstream can never turn this into a
// production deploy. A failed deploy returns { ok: false }, which the state
// machine treats as a HOSTING_DEPLOYED failure that stops publication before
// the index is ever touched.
export function makeStagingDeployHosting(
  projectId: string,
  runDeploy: DeployRunner,
): DeployHostingPort {
  return () => {
    if (projectId !== STAGING_PROJECT_ID) {
      return Promise.resolve({
        ok: false as const,
        error: `refusing hosting deploy: project '${projectId}' is not the authorized staging project '${STAGING_PROJECT_ID}'`,
      });
    }
    try {
      runDeploy(projectId);
      return Promise.resolve({ ok: true as const });
    } catch (err) {
      return Promise.resolve({
        ok: false as const,
        error: `staging hosting deploy failed: ${(err as Error).message}`,
      });
    }
  };
}

// --------------------------------------------------------------------------
// Entry point. Only executed when invoked directly via
// `node lib/scripts/publish-variant.js`. Everything below wires the injected
// seams to the certified state machine with REAL ports (Admin SDK, Node
// fs/crypto, global fetch, and the canonical .cjs retention manifest). These
// imports are kept here, below `main`, so importing this module for tests
// never pulls firebase-admin into the jest process (deploy-assessment.ts
// convention).
// --------------------------------------------------------------------------

import * as fs from "fs";
import * as crypto from "crypto";
import * as path from "path";
import { createRequire } from "module";
import { execFileSync } from "child_process";
import { FieldValue } from "firebase-admin/firestore";
import { bindAdminProjectReal } from "./admin-project-binding";

import {
  publishRetainedRevision,
  retireVariant,
  type LoadRetainedRevisionPort,
  type FetchHostedPort,
  type HashBytesPort,
} from "../variants/variant-publication";
import {
  presentationVariantIndexActivateDocRef,
  presentationVariantIndexDocRef,
  presentationVariantIndexRetireDocRef,
} from "../shared/firestore/typed-ref";

function repoRootFromCompiled(): string {
  // lib/scripts/publish-variant.js -> lib -> functions -> platform -> repo.
  return path.resolve(__dirname, "..", "..", "..", "..");
}

// Reuse the ONE canonical append-only manifest reader/verifier (Slice 2's
// variantManifest.cjs) so there is no second retention implementation. The
// manifest itself must pass verifyRetention() before any entry is trusted.
function makeLoadRetainedRevision(repoRoot: string): LoadRetainedRevisionPort {
  // createRequire (not a bare `require`) lets this Cloud Functions module load
  // the ONE canonical append-only manifest reader/verifier (Slice 2's
  // variantManifest.cjs), which lives in a sibling package outside the
  // functions rootDir, at run time. Reusing it means there is no second
  // retention implementation; the manifest must pass verifyRetention() before
  // any entry is trusted.
  const req = createRequire(__filename);
  const manifestMod = req(
    path.join(repoRoot, "app", "scripts", "lessonBuilder", "variantManifest.cjs"),
  ) as {
    verifyRetention: (opts: { repoRoot: string }) => { ok: boolean; failures: string[] };
    readManifest: (repoRoot: string) => ReadonlyArray<{
      lessonSlug: string;
      variantKey: string;
      presentationRevisionId: string;
      path: string;
      sha256: string;
      assessmentRevisionId?: string;
      assessmentPresentationRevisionId?: string;
    }>;
  };

  return ({ lessonSlug, variantKey, presentationRevisionId }) => {
    const retention = manifestMod.verifyRetention({ repoRoot });
    if (!retention.ok) {
      return Promise.resolve({
        ok: false as const,
        error: `retention verifier failed; refusing to publish from an unverified tree: ${retention.failures.join("; ")}`,
      });
    }
    const entries = manifestMod.readManifest(repoRoot);
    const match = entries.find(
      (e) =>
        e.lessonSlug === lessonSlug &&
        e.variantKey === variantKey &&
        e.presentationRevisionId === presentationRevisionId,
    );
    if (!match) {
      return Promise.resolve({
        ok: false as const,
        error: `no retained revision ${presentationRevisionId} for ${lessonSlug}__${variantKey} in the manifest`,
      });
    }
    const bindingRefusal = refuseUnpropagatedAssessmentBinding(match);
    if (bindingRefusal !== null) {
      return Promise.resolve({ ok: false as const, error: bindingRefusal });
    }
    const absFile = path.join(repoRoot, match.path);
    if (!fs.existsSync(absFile)) {
      return Promise.resolve({ ok: false as const, error: `retained artifact missing from tree: ${match.path}` });
    }
    const onDisk = fs.readFileSync(absFile);
    const actualSha = crypto.createHash("sha256").update(onDisk).digest("hex");
    if (actualSha !== match.sha256) {
      return Promise.resolve({
        ok: false as const,
        error: `retained artifact ${match.path} bytes hash to ${actualSha}, manifest records ${match.sha256}`,
      });
    }
    return Promise.resolve({
      ok: true as const,
      revision: {
        lessonSlug: match.lessonSlug,
        variantKey: match.variantKey,
        presentationRevisionId: match.presentationRevisionId,
        path: match.path,
        sha256: match.sha256,
      },
    });
  };
}

// F5.3 Slice 3 fail-closed guard. A manifest entry bound to an assessment
// presentation (assessmentPresentationRevisionId) cannot be published until a
// later F5.3 slice writes the assessment-presentation record and propagates
// the binding through the index, grant, session, and attempt. Publishing it
// now would repoint the index to the instructional artifact while silently
// dropping the certified assessment presentation. Pre-F5.3 entries (no
// binding) are unaffected.
export function refuseUnpropagatedAssessmentBinding(entry: {
  readonly assessmentRevisionId?: string;
  readonly assessmentPresentationRevisionId?: string;
}): string | null {
  if (entry.assessmentPresentationRevisionId === undefined && entry.assessmentRevisionId === undefined) {
    return null;
  }
  return (
    "refusing to publish: this revision is bound to an assessment presentation " +
    `(${String(entry.assessmentPresentationRevisionId)} for ${String(entry.assessmentRevisionId)}), ` +
    "and assessment-presentation propagation is not implemented yet (F5.3 Slice 5)"
  );
}

// Positive Admin SDK project binding, shared with deploy-assessment. See
// ./admin-project-binding for the precedence argument.
export { bindAdminProjectReal };

const hashBytes: HashBytesPort = (bytes) =>
  crypto.createHash("sha256").update(bytes as crypto.BinaryLike).digest("hex");

function makeFetchHosted(origin: string): FetchHostedPort {
  return async (relPath) => {
    // Hosting serves the committed tree at the repo-root layout, so the
    // relative artifact path maps directly onto the origin.
    const url = `${origin.replace(/\/+$/, "")}/${relPath}`;
    try {
      // redirect:"manual" so a redirect is observable and can be rejected;
      // a redirect is never accepted as proof of the exact retained artifact.
      const res = await fetch(url, { redirect: "manual" });
      const redirected = res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400);
      const buf = Buffer.from(await res.arrayBuffer());
      return { ok: true, status: res.status, redirected, bytes: buf };
    } catch (err) {
      return { ok: false, error: `${url}: ${(err as Error).message}` };
    }
  };
}

if (require.main === module) {
  const repoRoot = repoRootFromCompiled();
  const argv = process.argv.slice(2);

  // Pre-resolve the target/project ONLY to decide which Hosting deploy port and
  // liveness origin to wire. main() re-parses the same argv and remains the
  // authoritative validator and safety gate (ensureTargetSafe runs there), so
  // this pre-parse can never relax a check.
  const preParsed = parseArgs(argv, process.env);
  const preTarget = preParsed.ok ? preParsed.args.target : "emulator";
  const preProject = preParsed.ok ? preParsed.args.project : null;

  // The real staging Hosting deploy: `firebase deploy --only hosting` scoped to
  // the proven staging project. execFileSync with an argument array (no shell)
  // means no user value is ever interpolated into a shell; projectId is the
  // validated STAGING_PROJECT_ID literal in any case. A non-zero exit throws,
  // which makeStagingDeployHosting turns into an { ok: false } that stops
  // publication before the index is touched.
  const stagingDeployRunner: DeployRunner = (projectId) => {
    execFileSync(
      "firebase",
      ["deploy", "--only", "hosting", "--project", projectId, "--non-interactive"],
      { stdio: "inherit" },
    );
  };

  // Staging gets a REAL, fail-closed deploy port. Emulator and production keep
  // the pre-existing guarded no-op (operator deploys Hosting out of band; the
  // liveness fetch still PROVES the deploy) - production behavior is unchanged.
  const deployHosting: DeployHostingPort =
    preTarget === "staging" && preProject !== null
      ? makeStagingDeployHosting(preProject, stagingDeployRunner)
      : () => Promise.resolve({ ok: true as const });

  // The liveness origin is NOT decided here: main() validates the target and
  // passes the exact origin to use in the publish context (the validated
  // --hosting-origin for staging and production; LYFELABZ_HOSTING_ORIGIN only
  // for the emulator).
  void main(argv, {
    env: process.env,
    setEnv: (key, value) => {
      process.env[key] = value;
    },
    log: (message) => process.stdout.write(`${message}\n`),
    logError: (message) => process.stderr.write(`${message}\n`),

    bindAdminProject: bindAdminProjectReal,

    publish: (input, context) => {
      const loadRetainedRevision = makeLoadRetainedRevision(repoRoot);
      return publishRetainedRevision(input, {
        loadRetainedRevision,
        deployHosting,
        fetchHosted: makeFetchHosted(context.fetchOrigin),
        hashBytes,
        writeIndexActivate: async (revision, publishedBy) => {
          await presentationVariantIndexActivateDocRef(revision.lessonSlug, revision.variantKey).set({
            lessonSlug: revision.lessonSlug,
            variantKey: revision.variantKey,
            currentPresentationRevisionId: revision.presentationRevisionId,
            currentPath: revision.path,
            contentSha256: revision.sha256,
            status: "active",
            updatedAt: FieldValue.serverTimestamp(),
            publishedBy,
          });
        },
        log: (m) => process.stdout.write(`${m}\n`),
      });
    },

    retire: (input) =>
      retireVariant(input, {
        readIndexStatus: async ({ lessonSlug, variantKey }) => {
          const snap = await presentationVariantIndexDocRef(lessonSlug, variantKey).get();
          if (!snap.exists) return { exists: false };
          const data = snap.data();
          return { exists: true, status: data?.status ?? "active" };
        },
        writeIndexRetire: async ({ lessonSlug, variantKey, publishedBy }) => {
          await presentationVariantIndexRetireDocRef(lessonSlug, variantKey).update({
            status: "retired",
            updatedAt: FieldValue.serverTimestamp(),
            publishedBy,
          });
        },
        log: (m) => process.stdout.write(`${m}\n`),
      }),
  })
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`unexpected error: ${(err as Error).message}\n`);
      process.exit(1);
    });
}
