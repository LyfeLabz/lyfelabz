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
} from "../variants/variant-publication";

export type PublishOp = "publish" | "rollback" | "retire";

export type CliArgs = {
  readonly op: PublishOp;
  readonly target: "emulator" | "production";
  readonly lessonSlug: string;
  readonly variantKey: string;
  readonly presentationRevisionId: string | null;
  readonly publishedBy: string;
  readonly hostingOrigin: string | null;
  readonly iKnowProduction: boolean;
};

export type CliDeps = {
  // Injected engine seams. The real CLI wires these to the state machine with
  // real ports; tests wire fakes so no Hosting/Firestore/network is touched.
  readonly publish: (input: PublishInput) => Promise<PublishResult>;
  readonly retire: (input: RetireInput) => Promise<RetireResult>;
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
  "[--target=emulator|production] [--i-know=production]";

export function parseArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = {},
): ArgParseResult {
  let op: PublishOp = "publish";
  let target: "emulator" | "production" = "emulator";
  let lessonSlug: string | undefined;
  let variantKey: string | undefined;
  let presentationRevisionId: string | null = null;
  let publishedBy: string | undefined;
  let hostingOrigin: string | null = null;
  let iKnowProduction = false;

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
        if (value !== "emulator" && value !== "production") {
          return { ok: false, message: "--target must be emulator or production" };
        }
        target = value;
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
    },
  };
}

export function ensureTargetSafe(args: CliArgs, env: NodeJS.ProcessEnv): string | null {
  if (args.target === "emulator") {
    return null;
  }
  if (!args.iKnowProduction) {
    return "production target requires --i-know=production";
  }
  const emulatorHost = env.FIRESTORE_EMULATOR_HOST;
  if (typeof emulatorHost === "string" && emulatorHost.length > 0) {
    return "refusing production publish while FIRESTORE_EMULATOR_HOST is set";
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

  if (args.target === "emulator") {
    configureEmulatorEnv(deps.env, deps.setEnv);
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

    const result = await deps.publish({
      lessonSlug: args.lessonSlug,
      variantKey: args.variantKey,
      presentationRevisionId: args.presentationRevisionId as string,
      publishedBy: args.publishedBy,
      mode: args.op,
    });
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

  void main(process.argv.slice(2), {
    env: process.env,
    setEnv: (key, value) => {
      process.env[key] = value;
    },
    log: (message) => process.stdout.write(`${message}\n`),
    logError: (message) => process.stderr.write(`${message}\n`),

    publish: (input) => {
      const loadRetainedRevision = makeLoadRetainedRevision(repoRoot);
      // In this task no real production deploy is performed. The deploy port
      // is intentionally a guarded no-op: the operator deploys Hosting out of
      // band (or via a separate reviewed step) and this CLI PROVES the deploy
      // through the liveness fetch. A future reviewed change may wire an
      // actual `firebase deploy --only hosting` here behind the production
      // gate; execFileSync is imported for that eventual wiring.
      void execFileSync;
      const origin = process.env.LYFELABZ_HOSTING_ORIGIN ?? "";
      return publishRetainedRevision(input, {
        loadRetainedRevision,
        deployHosting: () => Promise.resolve({ ok: true as const }),
        fetchHosted: makeFetchHosted(origin),
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
