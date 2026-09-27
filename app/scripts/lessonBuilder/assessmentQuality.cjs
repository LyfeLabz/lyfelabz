/*
 * F5.3 Slice 1 - Answer-position quality standard for canonical assessments.
 *
 * Students notice and exploit skewed or patterned correct-answer positions
 * (for example "the answer is usually B"). This module evaluates the
 * DISPLAYED position of each item's correct option (its index in the item's
 * authored `options` order, which is the order the lesson renders; the
 * assessment-fidelity contract keeps the two identical) against the approved
 * F5.3 standard (DIFFERENTIATION_F5_3_ASSESSMENT_ACCESSIBILITY_ADDENDUM.md
 * section 13):
 *
 *   n = item count, k = options per item, e = n / k
 *   HARD (fails verification unless allowlisted legacy debt):
 *     POSITION_NEVER_CORRECT  a position is never correct while n >= k
 *     POSITION_OVER_CAP       a position is correct more than ceil(e) + 1 times
 *     SPREAD_TOO_WIDE         max count - min count >= 3
 *     RUN_TOO_LONG            3 or more consecutive items share a position
 *   WARNING (reported, never fails):
 *     SPREAD_OF_TWO           max count - min count == 2
 *     PERIODIC_PATTERN        a repeating cycle of period p (2 <= p <= k,
 *                             n >= 2p) holds for >= 80% of comparisons
 *   TARGET: spread <= 1, no run above 2, no visible cycle.
 *
 * Distributions are authored, not randomized: this module never reorders
 * anything and never writes. Committed payloads are immutable revisions;
 * existing violations are recorded as explicit debt in
 * assessment-quality-allowlist.json, which may only SHRINK (see
 * checkAllowlist). The long-term target is an empty allowlist, reached only
 * through new canonical revisions, never by editing a deployed revision.
 *
 * Pure evaluation (evaluateDistribution) is reusable for F5.3 Slice 3
 * assessment presentations, whose display positions are subject to the same
 * standard.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const HARD_CODES = Object.freeze([
  "POSITION_NEVER_CORRECT",
  "POSITION_OVER_CAP",
  "SPREAD_TOO_WIDE",
  "RUN_TOO_LONG",
  "OPTION_COUNT_NOT_UNIFORM",
  "CORRECT_OPTION_MISSING",
]);
const WARNING_CODES = Object.freeze(["SPREAD_OF_TWO", "PERIODIC_PATTERN"]);

const PERIODIC_MATCH_THRESHOLD = 0.8;
const PAYLOAD_FILE_PATTERN = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.r([1-9][0-9]*)\.json$/;

// Frozen legacy baseline (repository state at 176fe27, 2026-09-27): the
// ONLY assessments that may ever appear in the allowlist, each pinned to the
// exact correct-position sequence it had then. An entry outside this list is
// refused, so the allowlist cannot grow; a revision r2 or later can never be
// debt. Remove an entry here (and from the allowlist) when its lesson gains
// a compliant canonical revision; never add one.
const LEGACY_DEBT_BASELINE = Object.freeze([
  "cell-types.r1.json:ACBCBDCDAC",
  "communication-systems.r1.json:BACDBACDBA",
  "design-tradeoffs.r1.json:ACBBCCABBC",
  "earths-layers.r1.json:CBBBBABABB",
  "earths-place-in-the-universe.r1.json:CBDACBDACB",
  "ecosystem-stability.r1.json:BDACBDACBA",
  "engineering-systems.r1.json:ACBCBAABBC",
  "human-impacts.r1.json:BDACBDACBD",
  "introduction-to-electricity.r1.json:CABDCABDCB",
  "organelles.r1.json:CBDCCDBCDC",
  "parts-of-an-ecosystem.r1.json:CADBCADBCA",
  "technology-and-society.r1.json:BCBCBBADCB",
  "transportation-systems.r1.json:BCADBCADBC",
  "water-cycle.r1.json:ACBDACBDAC",
]);

function positionLetter(index) {
  return String.fromCharCode(65 + index);
}

function sequenceString(positions) {
  return positions.map(positionLetter).join("");
}

// Pure evaluation of displayed correct positions (0-based indexes) for a
// quiz whose items all show `optionCount` options.
function evaluateDistribution(positions, optionCount) {
  const n = positions.length;
  const k = optionCount;
  const counts = new Array(k).fill(0);
  for (const p of positions) counts[p] += 1;
  const expected = n / k;
  const cap = Math.ceil(expected) + 1;
  const max = Math.max(...counts);
  const min = Math.min(...counts);
  const spread = max - min;
  const hard = [];
  const warnings = [];
  const countText = counts.map((c, i) => `${positionLetter(i)}${c}`).join(" ");

  if (n >= k) {
    const never = counts.flatMap((c, i) => (c === 0 ? [positionLetter(i)] : []));
    if (never.length > 0) {
      hard.push({
        code: "POSITION_NEVER_CORRECT",
        detail: `position ${never.join(", ")} is never correct (${countText}); every position must be correct at least once when there are ${n} items and ${k} options`,
      });
    }
  }
  const over = counts.flatMap((c, i) => (c > cap ? [`${positionLetter(i)}=${c}`] : []));
  if (over.length > 0) {
    hard.push({
      code: "POSITION_OVER_CAP",
      detail: `${over.join(", ")} exceeds the cap of ${cap} (ceil(${n}/${k}) + 1) (${countText})`,
    });
  }
  if (spread >= 3) {
    hard.push({
      code: "SPREAD_TOO_WIDE",
      detail: `spread ${spread} (max ${max} - min ${min}) is 3 or more (${countText}); target spread is 1 or less`,
    });
  } else if (spread === 2) {
    warnings.push({
      code: "SPREAD_OF_TWO",
      detail: `spread 2 (max ${max} - min ${min}) (${countText}); target spread is 1 or less`,
    });
  }

  let runStart = 0;
  let longest = { length: n > 0 ? 1 : 0, start: 0 };
  for (let i = 1; i <= n; i += 1) {
    if (i === n || positions[i] !== positions[runStart]) {
      const length = i - runStart;
      if (length > longest.length) longest = { length, start: runStart };
      runStart = i;
    }
  }
  if (longest.length >= 3) {
    hard.push({
      code: "RUN_TOO_LONG",
      detail: `items ${longest.start + 1}-${longest.start + longest.length} are all position ${positionLetter(positions[longest.start])} (${longest.length} in a row); at most 2 consecutive items may share a position`,
    });
  }

  for (let p = 2; p <= k && n >= 2 * p; p += 1) {
    let matches = 0;
    for (let i = 0; i + p < n; i += 1) if (positions[i] === positions[i + p]) matches += 1;
    const ratio = matches / (n - p);
    const unit = new Set(positions.slice(0, p));
    if (ratio >= PERIODIC_MATCH_THRESHOLD && unit.size >= 2) {
      warnings.push({
        code: "PERIODIC_PATTERN",
        detail: `repeating cycle of period ${p} (${sequenceString(positions.slice(0, p))}...) holds for ${Math.round(ratio * 100)}% of items; students can predict answers from the pattern`,
      });
      break;
    }
  }

  return { n, k, counts, spread, sequence: sequenceString(positions), hard, warnings };
}

// Displayed correct positions for a deployment payload (authored option
// order). Structural problems are hard findings rather than exceptions, so
// the report stays complete.
function evaluatePayload(payload) {
  const items = Array.isArray(payload && payload.items) ? payload.items : [];
  const optionCounts = new Set(items.map((item) => (Array.isArray(item.options) ? item.options.length : 0)));
  const positions = [];
  const structural = [];
  items.forEach((item, i) => {
    const ids = Array.isArray(item.options) ? item.options.map((o) => o.optionId) : [];
    const index = ids.indexOf(item.correctOptionId);
    if (index < 0) {
      structural.push({
        code: "CORRECT_OPTION_MISSING",
        detail: `item ${i + 1} (${item.itemId}) correctOptionId "${item.correctOptionId}" is not among its options`,
      });
    }
    positions.push(index);
  });
  if (items.length === 0) {
    structural.push({ code: "CORRECT_OPTION_MISSING", detail: "payload has no items" });
  }
  if (optionCounts.size > 1) {
    structural.push({
      code: "OPTION_COUNT_NOT_UNIFORM",
      detail: `items show different option counts (${[...optionCounts].sort().join(", ")}); the position standard is defined for a uniform option count and needs an explicit extension before mixed quizzes are allowed`,
    });
  }
  if (structural.length > 0) {
    return { n: items.length, k: null, counts: [], spread: null, sequence: null, hard: structural, warnings: [] };
  }
  return evaluateDistribution(positions, [...optionCounts][0]);
}

function defaultRepoRoot() {
  return path.resolve(__dirname, "..", "..", "..");
}

function payloadDirectory(repoRoot) {
  return path.join(repoRoot, "platform", "functions", "src", "scripts", "assessments");
}

function allowlistPath() {
  return path.join(__dirname, "assessment-quality-allowlist.json");
}

function readAllowlist(file = allowlistPath()) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error(`[assessment-quality] ${file} must be { schemaVersion: 1, entries: [...] }`);
  }
  return parsed.entries;
}

function auditCommittedPayloads(repoRoot = defaultRepoRoot()) {
  const dir = payloadDirectory(repoRoot);
  return fs
    .readdirSync(dir)
    .filter((file) => PAYLOAD_FILE_PATTERN.test(file))
    .sort()
    .map((file) => ({
      file,
      result: evaluatePayload(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"))),
    }));
}

function codesOf(findings) {
  return findings.map((f) => f.code).sort();
}

function sameCodes(a, b) {
  return a.length === b.length && a.every((code, i) => code === b[i]);
}

// Checks audit results against the allowlist. Returns { failures, debt,
// newWarnings }:
//   - failures: blocking problems (new hard findings, and any allowlist
//     entry that is outside the frozen baseline, stale, duplicated, or no
//     longer describes its payload exactly);
//   - debt: allowlisted findings (reported as known assessment-quality debt);
//   - newWarnings: warnings on assessments without an allowlist entry
//     (reported, never blocking).
function checkAllowlist(audit, entries, baseline = LEGACY_DEBT_BASELINE) {
  const failures = [];
  const debt = [];
  const newWarnings = [];
  const byFile = new Map();

  for (const entry of entries) {
    const key = `${entry.payload}:${entry.correctSequence}`;
    if (byFile.has(entry.payload)) {
      failures.push(`allowlist entry for ${entry.payload} is duplicated`);
      continue;
    }
    byFile.set(entry.payload, entry);
    const match = PAYLOAD_FILE_PATTERN.exec(entry.payload || "");
    if (!match || match[2] !== "1") {
      failures.push(`allowlist entry ${entry.payload} is refused: only legacy r1 payloads can be debt; a new revision must meet the standard`);
    } else if (!baseline.includes(key)) {
      failures.push(`allowlist entry ${key} is not in the frozen legacy baseline; the allowlist may only shrink`);
    }
    if (!Array.isArray(entry.findings) || typeof entry.reason !== "string" || entry.reason.trim().length === 0) {
      failures.push(`allowlist entry ${entry.payload} must list its findings and a non-empty reason`);
    }
  }

  const auditedFiles = new Set(audit.map((a) => a.file));
  for (const file of byFile.keys()) {
    if (!auditedFiles.has(file)) {
      failures.push(`allowlist entry ${file} names no committed payload; remove it`);
    }
  }

  for (const { file, result } of audit) {
    const entry = byFile.get(file);
    const hardCodes = codesOf(result.hard);
    const warnCodes = codesOf(result.warnings);
    const allCodes = [...hardCodes, ...warnCodes].sort();
    if (!entry) {
      for (const f of result.hard) failures.push(`${file}: ${f.code} - ${f.detail}`);
      for (const f of result.warnings) newWarnings.push(`${file}: ${f.code} - ${f.detail}`);
      continue;
    }
    if (entry.correctSequence !== result.sequence) {
      failures.push(`${file}: allowlisted sequence ${entry.correctSequence} does not match the committed payload (${result.sequence}); deployed revisions are immutable - restore the payload, or ship a new compliant revision and remove the entry`);
      continue;
    }
    if (allCodes.length === 0) {
      failures.push(`${file}: allowlist entry is stale (no findings remain); remove it`);
      continue;
    }
    if (!sameCodes([...entry.findings].sort(), allCodes)) {
      failures.push(`${file}: allowlisted findings [${[...entry.findings].sort().join(", ")}] differ from current findings [${allCodes.join(", ")}]; update the entry only to remove findings`);
      continue;
    }
    for (const f of [...result.hard, ...result.warnings]) debt.push(`${file}: ${f.code} - ${f.detail}`);
  }

  return { failures, debt, newWarnings };
}

function verifyRepository({ repoRoot = defaultRepoRoot(), allowlistFile = allowlistPath() } = {}) {
  const audit = auditCommittedPayloads(repoRoot);
  const outcome = checkAllowlist(audit, readAllowlist(allowlistFile));
  return { ok: outcome.failures.length === 0, audit, ...outcome };
}

module.exports = {
  HARD_CODES,
  WARNING_CODES,
  LEGACY_DEBT_BASELINE,
  evaluateDistribution,
  evaluatePayload,
  auditCommittedPayloads,
  readAllowlist,
  checkAllowlist,
  verifyRepository,
  allowlistPath,
};
