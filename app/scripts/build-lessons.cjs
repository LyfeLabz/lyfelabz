#!/usr/bin/env node
/*
 * LyfeLabz lesson builder CLI (Sprint 18).
 *
 * Usage:
 *   node scripts/build-lessons.cjs                  # build both targets for every configured lesson
 *   node scripts/build-lessons.cjs --check          # verify (no writes)
 *   node scripts/build-lessons.cjs --only=<slug>
 *   node scripts/build-lessons.cjs --target=v1|v2
 *
 * --check is what the validation chain runs. It never writes files.
 */

"use strict";

const builder = require("./lessonBuilder/index.cjs");

function parseArgs(argv) {
  const args = { check: false, only: null, target: null };
  for (const a of argv) {
    if (a === "--check") args.check = true;
    else if (a.startsWith("--only=")) args.only = a.slice("--only=".length);
    else if (a.startsWith("--target=")) args.target = a.slice("--target=".length);
    else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "Usage: build-lessons.cjs [--check] [--only=<slug>] [--target=v1|v2]\n",
      );
      process.exit(0);
    } else {
      process.stderr.write(`[build-lessons] unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  if (args.target !== null && args.target !== "v1" && args.target !== "v2") {
    process.stderr.write(`[build-lessons] --target must be v1 or v2\n`);
    process.exit(2);
  }
  return args;
}

function selectedSlugs(args) {
  if (args.only) return [args.only];
  return builder.listConfiguredSlugs();
}

function selectedTargets(args) {
  if (args.target) return [args.target];
  return ["v1", "v2"];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const slugs = selectedSlugs(args);
  const targets = selectedTargets(args);

  if (slugs.length === 0) {
    process.stdout.write("[build-lessons] no configured lessons\n");
    return;
  }

  if (args.check) {
    for (const slug of slugs) {
      const res = builder.verifyLesson({ slug });
      process.stdout.write(
        `[build-lessons] OK verify ${slug}: v1=${res.v1.sha256.slice(0, 12)} v2=${res.v2.sha256.slice(0, 12)}\n`,
      );
    }
    return;
  }

  for (const slug of slugs) {
    for (const target of targets) {
      const res = builder.buildLesson({ slug, target, write: true });
      process.stdout.write(
        `[build-lessons] wrote ${target} for ${slug}: ${res.sha256.slice(0, 12)} -> ${res.outputPath}\n`,
      );
    }
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
