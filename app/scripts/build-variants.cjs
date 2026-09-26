#!/usr/bin/env node
/*
 * Authored presentation-variant CLI (F5.2 S5.2, Slice 2 tooling).
 *
 * Usage:
 *   node scripts/build-variants.cjs --check
 *       Build and gate every declared authored variant in memory and
 *       confirm each current build is a retained manifest revision.
 *       Writes nothing. (Also run by `variants:verify`.)
 *
 *   node scripts/build-variants.cjs --dry-run --lesson=<slug> --variant=<key>
 *       Build and gate one variant in memory; print its would-be revision
 *       id, relocated references, bound assessment revisions and prose
 *       statistics. Writes nothing.
 *
 *   node scripts/build-variants.cjs --generate --lesson=<slug> --variant=<key> --published-at=<ISO-8601>
 *       Build, gate, and retain the artifact through the existing
 *       content-addressed generateVariantArtifact(): writes the add-only
 *       revision file under app/lessons/variants/ and appends one manifest
 *       entry. Repository-only: it never commits, deploys, writes the
 *       presentation index, or touches Firestore.
 */

"use strict";

const variantSource = require("./lessonBuilder/variantSource.cjs");

function parseArgs(argv) {
  const args = { mode: null, lesson: null, variant: null, publishedAt: null };
  for (const a of argv) {
    if (a === "--check" || a === "--dry-run" || a === "--generate") {
      if (args.mode) throw new Error("choose exactly one of --check, --dry-run, --generate");
      args.mode = a.slice(2);
    } else if (a.startsWith("--lesson=")) args.lesson = a.slice("--lesson=".length);
    else if (a.startsWith("--variant=")) args.variant = a.slice("--variant=".length);
    else if (a.startsWith("--published-at=")) args.publishedAt = a.slice("--published-at=".length);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!args.mode) throw new Error("choose one of --check, --dry-run, --generate");
  if (args.mode !== "check" && (!args.lesson || !args.variant)) {
    throw new Error(`--${args.mode} requires --lesson=<slug> and --variant=<variantKey>`);
  }
  if (args.mode === "generate") {
    if (!args.publishedAt || Number.isNaN(Date.parse(args.publishedAt)) || !/^\d{4}-\d{2}-\d{2}T/.test(args.publishedAt)) {
      throw new Error("--generate requires an explicit --published-at=<ISO-8601 timestamp>");
    }
  }
  return args;
}

function printBuild(r) {
  const out = process.stdout;
  out.write(`[build-variants] ${r.lessonSlug}/${r.variantKey} -> ${r.presentationRevisionId}\n`);
  out.write(`  path: ${r.path}\n`);
  out.write(`  assessment revisions bound: ${r.assessmentRevisions.join(", ")}\n`);
  out.write(`  relocated references: ${r.relocatedReferences.length}\n`);
  const c = r.review.canonicalProse;
  const v = r.review.variantProse;
  out.write(
    `  adaptable prose: canonical ${c.words} words / ${c.sentences} sentences (avg ${c.averageSentenceWords}, max ${c.longestSentenceWords}, >20: ${c.sentencesOver20Words}); ` +
      `variant ${v.words} words / ${v.sentences} sentences (avg ${v.averageSentenceWords}, max ${v.longestSentenceWords}, >20: ${v.sentencesOver20Words})\n`,
  );
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`[build-variants] ${err.message}\n`);
    process.exit(2);
  }
  try {
    if (args.mode === "check") {
      const res = variantSource.checkAuthoredVariants({});
      if (!res.ok) {
        process.stderr.write(`[build-variants] FAILED (${res.failures.length}):\n`);
        for (const f of res.failures) process.stderr.write(`  - ${f}\n`);
        process.exit(1);
      }
      process.stdout.write(`[build-variants] OK: ${res.checked.length} authored variant source(s) gated and retained\n`);
      return;
    }
    if (args.mode === "dry-run") {
      printBuild(variantSource.buildAuthoredVariant({ slug: args.lesson, variantKey: args.variant }));
      return;
    }
    const r = variantSource.generateAuthoredVariant({
      slug: args.lesson,
      variantKey: args.variant,
      publishedAt: args.publishedAt,
    });
    printBuild(r);
    process.stdout.write(`  file written: ${r.fileWritten}; manifest appended: ${r.appended}\n`);
  } catch (err) {
    process.stderr.write(`[build-variants] ${err.message}\n`);
    process.exit(1);
  }
}

main();
