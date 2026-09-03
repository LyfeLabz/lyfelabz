#!/usr/bin/env node
/*
 * Differentiated-presentation retention verifier CLI (F5.2 S6, Slice 2).
 *
 * Usage:
 *   node scripts/verify-variants.cjs
 *
 * Runs manifest/retention verification (app/lessons/variants/manifest.json
 * against the committed tree) entirely from repository state. Writes
 * nothing, deploys nothing, touches no Firestore data. Today the manifest
 * does not yet exist (no variant has been published), so this passes
 * trivially with zero entries - it becomes load-bearing once Slice 3+
 * publish tooling starts appending entries.
 */

"use strict";

const manifestMod = require("./lessonBuilder/variantManifest.cjs");

function main() {
  const result = manifestMod.verifyRetention({});
  const entries = manifestMod.readManifest();
  if (result.ok) {
    process.stdout.write(`[verify-variants] OK: ${entries.length} retained revision(s) verified\n`);
    return;
  }
  process.stderr.write(`[verify-variants] FAILED (${result.failures.length} problem(s)):\n`);
  for (const f of result.failures) process.stderr.write(`  - ${f}\n`);
  process.exit(1);
}

main();
