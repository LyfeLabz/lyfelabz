#!/usr/bin/env node
/*
 * F5.3 Slice 1 - Answer-position quality verifier CLI.
 *
 * Usage:
 *   node scripts/verify-assessment-quality.cjs
 *
 * Audits every committed canonical assessment payload
 * (platform/functions/src/scripts/assessments/<slug>.r<N>.json) against the
 * answer-position quality standard in lessonBuilder/assessmentQuality.cjs.
 * Fails on any hard finding that is not recorded legacy debt, and on any
 * debt-register entry that is outside the frozen baseline, stale, or no
 * longer matches its payload (the register may only shrink). Known debt and
 * new warnings are printed but never fail.
 *
 * F5.3 Slice 3: also verifies every retained assessment presentation
 * (platform/functions/src/scripts/assessment-presentations/ap<sha256>.json):
 * exact canonical bytes, content-addressed id, and full validation against
 * its committed canonical assessment payload. Reads only; writes nothing.
 */

"use strict";

const quality = require("./lessonBuilder/assessmentQuality.cjs");
const presentations = require("./lessonBuilder/assessmentPresentation.cjs");

function main() {
  const result = quality.verifyRepository();
  const tag = "[assessment-quality]";
  for (const line of result.debt) process.stdout.write(`${tag} DEBT ${line}\n`);
  for (const line of result.newWarnings) process.stdout.write(`${tag} WARN ${line}\n`);

  const retained = presentations.verifyRetainedRecords();
  const apTag = "[assessment-presentations]";
  for (const line of retained.warnings) process.stdout.write(`${apTag} WARN ${line}\n`);

  if (!result.ok || !retained.ok) {
    for (const line of result.failures) process.stderr.write(`${tag} FAIL ${line}\n`);
    for (const line of retained.failures) process.stderr.write(`${apTag} FAIL ${line}\n`);
    const total = result.failures.length + retained.failures.length;
    process.stderr.write(`${tag} ${total} failure(s); see docs/platform/DIFFERENTIATION_F5_3_ASSESSMENT_ACCESSIBILITY_ADDENDUM.md sections 8, 11, 13\n`);
    process.exit(1);
  }
  process.stdout.write(`${apTag} OK: ${retained.count} retained assessment presentation(s) verified\n`);
  const debtPayloads = new Set(result.debt.map((line) => line.split(":")[0]));
  process.stdout.write(
    `${tag} OK: ${result.audit.length} assessment(s) audited; ${debtPayloads.size} carry recorded legacy debt (target 0); ${result.newWarnings.length} new warning(s)\n`,
  );
}

main();
