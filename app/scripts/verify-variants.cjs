#!/usr/bin/env node
/*
 * Differentiated-presentation retention verifier CLI (F5.2 S6, Slice 2).
 *
 * Usage:
 *   node scripts/verify-variants.cjs
 *
 * Runs manifest/retention verification (app/lessons/variants/manifest.json
 * against the committed tree) entirely from repository state, plus the
 * Firebase Hosting exclusion check (F5.2 Slice 3): the retention manifest
 * must not be publicly served while every retained revision HTML remains
 * deployable. Writes nothing, deploys nothing, touches no Firestore data.
 * Today the manifest does not yet exist (no variant has been published), so
 * retention passes trivially with zero entries - it becomes load-bearing
 * once Slice 3+ publish tooling starts appending entries. The hosting
 * exclusion check is load-bearing immediately: it fails if firebase.json
 * would ever serve manifest.json.
 */

"use strict";

const manifestMod = require("./lessonBuilder/variantManifest.cjs");
const hostingExclusion = require("./lessonBuilder/hostingExclusion.cjs");

function main() {
  const failures = [];

  const retention = manifestMod.verifyRetention({});
  const entries = manifestMod.readManifest();
  if (!retention.ok) {
    for (const f of retention.failures) failures.push(`[retention] ${f}`);
  }

  const hosting = hostingExclusion.verifyManifestHostingExclusion({});
  if (!hosting.ok) {
    for (const f of hosting.failures) failures.push(`[hosting-exclusion] ${f}`);
  }

  if (failures.length === 0) {
    process.stdout.write(
      `[verify-variants] OK: ${entries.length} retained revision(s) verified; ` +
        "retention manifest excluded from Hosting, revision artifacts deployable\n",
    );
    return;
  }
  process.stderr.write(`[verify-variants] FAILED (${failures.length} problem(s)):\n`);
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  process.exit(1);
}

main();
