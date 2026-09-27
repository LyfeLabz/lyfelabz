#!/usr/bin/env node
/*
 * F5.3 Slice 6A - local authoring/review CLI for a DRAFT assessment
 * presentation (lessonBuilder/assessmentPresentationReview.cjs).
 *
 * Usage (paths relative to the repository root or absolute):
 *   node scripts/assessment-presentation-review.cjs validate  --draft=<file>
 *       Validate the draft and its notes; print the ap<sha256> id, failures,
 *       and warnings. Exit 1 on any hard failure. Writes nothing.
 *   node scripts/assessment-presentation-review.cjs id        --draft=<file>
 *       Print the draft's assessmentPresentationRevisionId. Writes nothing.
 *   node scripts/assessment-presentation-review.cjs verify-canonical --file=<ap....json>
 *       Verify a canonical record file: name, exact canonical bytes, and
 *       content identity. Writes nothing.
 *   node scripts/assessment-presentation-review.cjs review    --draft=<file> [--out-dir=<dir>]
 *       Validate, render the uncertified preview twice (byte-identical),
 *       and write, under the scratch directory:
 *         <id>.json               canonical record bytes (not a retained record)
 *         <id>.review-packet.md   owner-review packet
 *         <id>.preview.html       marked, uncertified local preview
 *       Exit 1 when any hard failure remains (the files are still written so
 *       the author can see why).
 *
 * The scratch directory defaults to app/dist/assessment-preview/, which is
 * gitignored (dist/) and refused by the Hosting build (app/dist/* other than
 * bundle.js). Any other --out-dir must be outside the repository. This tool
 * never writes a retained record, a review record, a lesson config, a
 * manifest entry, or anything that is deployed.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const paths = require("./lessonBuilder/paths.cjs");
const AP = require("./lessonBuilder/assessmentPresentation.cjs");
const review = require("./lessonBuilder/assessmentPresentationReview.cjs");
const variantSource = require("./lessonBuilder/variantSource.cjs");

const DEFAULT_OUT_DIR = path.join(paths.REPO_ROOT, "app", "dist", "assessment-preview");
const COMMANDS = ["validate", "id", "verify-canonical", "review"];

function parseArgs(argv) {
  const args = { command: argv[0], draft: null, file: null, outDir: null };
  if (!COMMANDS.includes(args.command)) throw new Error(`choose a command: ${COMMANDS.join(", ")}`);
  for (const a of argv.slice(1)) {
    if (a.startsWith("--draft=")) args.draft = a.slice("--draft=".length);
    else if (a.startsWith("--file=")) args.file = a.slice("--file=".length);
    else if (a.startsWith("--out-dir=")) args.outDir = a.slice("--out-dir=".length);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (args.command === "verify-canonical" ? !args.file : !args.draft) {
    throw new Error(args.command === "verify-canonical" ? "--file=<ap....json> is required" : "--draft=<file> is required");
  }
  return args;
}

function resolveFromRoot(p) {
  return path.isAbsolute(p) ? p : path.resolve(paths.REPO_ROOT, p);
}

function resolveOutDir(outDir) {
  const dir = outDir ? resolveFromRoot(outDir) : DEFAULT_OUT_DIR;
  if (paths.isWithin(paths.REPO_ROOT, dir) && !(dir === DEFAULT_OUT_DIR || paths.isWithin(DEFAULT_OUT_DIR, dir))) {
    throw new Error(`--out-dir inside the repository must be under ${path.relative(paths.REPO_ROOT, DEFAULT_OUT_DIR)}/ (gitignored scratch)`);
  }
  return dir;
}

function printAnalysis(a) {
  const out = process.stdout;
  out.write(`[assessment-review] ${a.record.lessonSlug} draft -> ${a.assessmentPresentationRevisionId}\n`);
  if (a.distribution) {
    out.write(`  display positions: ${a.distribution.sequence} (${a.distribution.counts.map((c, i) => `${String.fromCharCode(65 + i)}${c}`).join(" ")}, spread ${a.distribution.spread}, target ${a.distribution.targetMet ? "met" : "NOT met"})\n`);
  }
  for (const t of a.requiredTerms.terms) {
    out.write(`  required term "${t.term}": canonical prompt ${t.canonicalPrompt ? "yes" : "NO"}, adapted prompt ${t.adaptedPrompt ? "yes" : "NO"}\n`);
  }
  out.write(`  identical-to-canonical strings: ${a.identical.length}\n`);
  for (const w of a.warnings) out.write(`  WARN ${w}\n`);
  for (const f of a.hardFailures) out.write(`  FAIL ${f}\n`);
  out.write(`  ${a.ok ? "PASS" : "FAIL"}: ${a.hardFailures.length} hard failure(s), ${a.warnings.length} warning(s)\n`);
}

function writeFile(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  process.stdout.write(`  wrote ${path.relative(paths.REPO_ROOT, file)}\n`);
}

function verifyCanonicalFile(file) {
  const name = path.basename(file);
  const id = name.replace(/\.json$/, "");
  const failures = [];
  if (!AP.AP_ID_PATTERN.test(id) || `${id}.json` !== name) failures.push("file must be named ap<sha256>.json");
  const bytes = fs.readFileSync(file, "utf8");
  const record = JSON.parse(bytes);
  if (bytes !== AP.serializeRecord(record)) failures.push("file bytes are not the canonical serialization");
  const actual = AP.assessmentPresentationRevisionIdFor(record);
  if (actual !== id) failures.push(`content hashes to ${actual}, not ${id}`);
  return { ok: failures.length === 0, failures, id: actual };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`[assessment-review] ${err.message}\n`);
    process.exit(2);
  }
  try {
    if (args.command === "verify-canonical") {
      const r = verifyCanonicalFile(resolveFromRoot(args.file));
      for (const f of r.failures) process.stderr.write(`[assessment-review] FAIL ${f}\n`);
      process.stdout.write(`[assessment-review] ${r.ok ? "OK" : "FAIL"} ${r.id}\n`);
      process.exit(r.ok ? 0 : 1);
    }
    const draft = resolveFromRoot(args.draft);
    if (args.command === "id") {
      process.stdout.write(`${AP.assessmentPresentationRevisionIdFor(JSON.parse(fs.readFileSync(draft, "utf8")))}\n`);
      return;
    }
    const a = review.analyzeDraft(draft);
    if (args.command === "validate") {
      printAnalysis(a);
      process.exit(a.ok ? 0 : 1);
    }

    // review
    const outDir = resolveOutDir(args.outDir);
    const parsed = review.parseDraftFileName(draft);
    if (!parsed) throw new Error("draft file must be named <slug>.<variantKey>.assessment.json");
    let preview = null;
    try {
      preview = variantSource.buildUncertifiedAssessmentPreview({ slug: parsed.lessonSlug, variantKey: parsed.variantKey, record: a.record });
    } catch (err) {
      a.hardFailures.push(`preview: ${err.message}`);
      a.ok = false;
    }
    if (preview && preview.assessmentPresentationRevisionId !== a.assessmentPresentationRevisionId) {
      a.hardFailures.push("preview id does not match the analyzed draft id");
      a.ok = false;
    }
    printAnalysis(a);
    const id = a.assessmentPresentationRevisionId;
    writeFile(path.join(outDir, `${id}.json`), a.canonicalBytes);
    const check = verifyCanonicalFile(path.join(outDir, `${id}.json`));
    if (!check.ok) throw new Error(`canonical bytes failed verification: ${check.failures.join("; ")}`);
    writeFile(path.join(outDir, `${id}.review-packet.md`), review.renderPacket(a, { preview }));
    if (preview) {
      writeFile(path.join(outDir, `${id}.preview.html`), preview.html);
      process.stdout.write(`  instructional base: ${preview.instructionPresentationRevisionId}\n`);
      process.stdout.write(`  projected bound artifact (not generated): ${preview.projectedPresentationRevisionId}\n`);
    }
    process.exit(a.ok ? 0 : 1);
  } catch (err) {
    process.stderr.write(`[assessment-review] ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { DEFAULT_OUT_DIR, resolveOutDir, verifyCanonicalFile };
