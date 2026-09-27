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
 * new warnings are printed but never fail. Reads only; writes nothing.
 */

"use strict";

const quality = require("./lessonBuilder/assessmentQuality.cjs");

function main() {
  const result = quality.verifyRepository();
  const tag = "[assessment-quality]";
  for (const line of result.debt) process.stdout.write(`${tag} DEBT ${line}\n`);
  for (const line of result.newWarnings) process.stdout.write(`${tag} WARN ${line}\n`);
  if (!result.ok) {
    for (const line of result.failures) process.stderr.write(`${tag} FAIL ${line}\n`);
    process.stderr.write(`${tag} ${result.failures.length} failure(s); see docs/platform/DIFFERENTIATION_F5_3_ASSESSMENT_ACCESSIBILITY_ADDENDUM.md section 13\n`);
    process.exit(1);
  }
  const debtPayloads = new Set(result.debt.map((line) => line.split(":")[0]));
  process.stdout.write(
    `${tag} OK: ${result.audit.length} assessment(s) audited; ${debtPayloads.size} carry recorded legacy debt (target 0); ${result.newWarnings.length} new warning(s)\n`,
  );
}

main();
