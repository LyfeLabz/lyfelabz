/*
 * Retention ledger for differentiated presentation artifacts (F5.2 S7,
 * Slice 2).
 *
 * The manifest at app/lessons/variants/manifest.json is append-only:
 * this module never edits or removes an existing entry. Every function
 * accepts an optional `repoRoot` (defaults to the real repository root)
 * so tests can point the whole ledger at an isolated temp directory
 * instead of touching the real retained-artifact tree.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const paths = require("./paths.cjs");
const { sha256Hex } = require("./hash.cjs");
const identity = require("./variantIdentity.cjs");

const MANIFEST_FIELDS = ["lessonSlug", "variantKey", "presentationRevisionId", "path", "sha256", "publishedAt"];

function fail(message) {
  throw new Error(`[variant-manifest] ${message}`);
}

function resolveVariantsRoot(repoRoot = paths.REPO_ROOT) {
  return path.join(repoRoot, "app", "lessons", "variants");
}

function resolveManifestPath(repoRoot = paths.REPO_ROOT) {
  return path.join(resolveVariantsRoot(repoRoot), "manifest.json");
}

function readManifest(repoRoot = paths.REPO_ROOT) {
  const manifestPath = resolveManifestPath(repoRoot);
  if (!fs.existsSync(manifestPath)) return [];
  const raw = fs.readFileSync(manifestPath, "utf8");
  if (raw.trim().length === 0) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail(`manifest at ${manifestPath} is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(parsed)) {
    fail(`manifest at ${manifestPath} must be a JSON array of entries`);
  }
  return parsed;
}

// Deterministic serialization: stable field order per entry, strict
// insertion order preserved (append-only - never resorted, since sorting
// would rewrite the ledger's historical ordering), 2-space indent, single
// trailing newline.
function serializeManifest(entries) {
  const normalized = entries.map((e) => ({
    lessonSlug: e.lessonSlug,
    variantKey: e.variantKey,
    presentationRevisionId: e.presentationRevisionId,
    path: e.path,
    sha256: e.sha256,
    publishedAt: e.publishedAt,
  }));
  return `${JSON.stringify(normalized, null, 2)}\n`;
}

function validateEntryShape(entry) {
  if (!entry || typeof entry !== "object") fail("manifest entry must be an object");
  for (const field of MANIFEST_FIELDS) {
    if (typeof entry[field] !== "string" || entry[field].length === 0) {
      fail(`manifest entry missing/invalid field "${field}" (path: ${entry && entry.path})`);
    }
  }
  identity.assertValidLessonSlugForVariant(entry.lessonSlug);
  identity.assertValidPresentationRevisionId(entry.presentationRevisionId);
  if (!/^[0-9a-f]{64}$/.test(entry.sha256)) {
    fail(`manifest entry sha256 is not a 64-hex-char digest: ${entry.path}`);
  }
  if (entry.presentationRevisionId !== `pr${entry.sha256}`) {
    fail(`presentationRevisionId does not match sha256 for entry at "${entry.path}" (identity self-consistency failure)`);
  }
  const expectedPath = identity.variantRelativeOutputPath(entry.lessonSlug, entry.presentationRevisionId);
  if (entry.path !== expectedPath) {
    fail(`manifest entry path "${entry.path}" does not match the identity formula "${expectedPath}"`);
  }
}

function sameEntry(a, b) {
  return (
    a.lessonSlug === b.lessonSlug &&
    a.variantKey === b.variantKey &&
    a.presentationRevisionId === b.presentationRevisionId &&
    a.sha256 === b.sha256 &&
    a.path === b.path
  );
}

// Append-only write. `publishedAt` on a true duplicate is never rewritten:
// the FIRST accepted publish's timestamp is retained forever, matching the
// immutability rule "same path + identical bytes = harmless no-op".
function appendEntry(entry, { repoRoot = paths.REPO_ROOT } = {}) {
  validateEntryShape(entry);
  const manifestPath = resolveManifestPath(repoRoot);
  const entries = readManifest(repoRoot);
  const existing = entries.find((e) => e.path === entry.path);
  if (existing) {
    if (sameEntry(existing, entry)) {
      return { entry: existing, appended: false };
    }
    fail(
      `refusing to alter existing manifest entry at path "${entry.path}" ` +
        "(immutability violation: an existing entry with this identity does not match the requested entry)",
    );
  }
  const next = entries.concat([entry]);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const tmp = paths.tmpSibling(manifestPath);
  try {
    fs.writeFileSync(tmp, serializeManifest(next), "utf8");
    fs.renameSync(tmp, manifestPath);
  } finally {
    paths.safeUnlink(tmp);
  }
  return { entry, appended: true };
}

// M7 safeguard: any future "clean output directory" step must call this
// before recursively deleting anything. It refuses whenever the directory
// being cleared IS the differentiated-variant retention root, or is an
// ancestor of it, while the manifest still lists retained artifacts. This
// protection is independent of verifyRetention() below - it runs on the
// generation/build path itself (see variantBuild.cjs), not only in CI.
function guardAgainstDestructiveClear(targetDir, { repoRoot = paths.REPO_ROOT } = {}) {
  const entries = readManifest(repoRoot);
  if (entries.length === 0) return;
  const variantsRoot = resolveVariantsRoot(repoRoot);
  const absTarget = path.resolve(targetDir);
  const rel = path.relative(absTarget, variantsRoot);
  const targetContainsRetainedRoot = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  if (targetContainsRetainedRoot) {
    fail(
      `refusing destructive clear of "${targetDir}": it contains ${entries.length} manifest-listed retained ` +
        "variant artifact(s). Historical variant artifacts are add-only (M7); regenerate new revisions instead " +
        "of clearing the retention tree.",
    );
  }
}

// Deterministic retention/build verifier (F5.2 S7.3). Fails whenever:
//   - any manifest path is absent from the tree
//   - any manifest-listed file's bytes hash differently than recorded
//   - any manifest entry is malformed, or its own id/sha256/path disagree
//   - two entries share a presentationRevisionId with different sha256
//     (a full-digest collision over different bytes, T-D4)
//   - a retained artifact file on disk has no corresponding manifest entry
//     (detects a manifest entry that was removed while its file was left
//     behind - T-E3)
//   - a lessonSlug violates the M3 charset
// Runs entirely from repository-tree state; no git plumbing, no network,
// no Firestore access.
function verifyRetention({ repoRoot = paths.REPO_ROOT } = {}) {
  const variantsRoot = resolveVariantsRoot(repoRoot);
  const failures = [];

  let entries;
  try {
    entries = readManifest(repoRoot);
  } catch (err) {
    return { ok: false, failures: [err.message] };
  }

  const seenPaths = new Set();
  const idToSha = new Map();

  for (const entry of entries) {
    try {
      validateEntryShape(entry);
    } catch (err) {
      failures.push(err.message);
      continue;
    }

    if (seenPaths.has(entry.path)) {
      failures.push(`duplicate manifest entry for path "${entry.path}"`);
    }
    seenPaths.add(entry.path);

    const priorSha = idToSha.get(entry.presentationRevisionId);
    if (priorSha !== undefined && priorSha !== entry.sha256) {
      failures.push(
        `integrity failure: presentationRevisionId "${entry.presentationRevisionId}" identifies more than one byte sequence`,
      );
    }
    idToSha.set(entry.presentationRevisionId, entry.sha256);

    const absFile = path.join(repoRoot, entry.path);
    if (!fs.existsSync(absFile)) {
      failures.push(`manifest-listed artifact missing from tree: ${entry.path}`);
      continue;
    }
    const onDisk = fs.readFileSync(absFile);
    const actualSha = sha256Hex(onDisk);
    if (actualSha !== entry.sha256) {
      failures.push(
        `manifest-listed artifact altered: ${entry.path} (expected sha256 ${entry.sha256}, found ${actualSha})`,
      );
    }
  }

  if (fs.existsSync(variantsRoot)) {
    const onDiskFiles = fs
      .readdirSync(variantsRoot)
      .filter((f) => f.endsWith(".html"))
      .map((f) => path.posix.join("app", "lessons", "variants", f));
    for (const relFile of onDiskFiles) {
      if (!seenPaths.has(relFile)) {
        failures.push(`retained artifact on disk has no manifest entry: ${relFile}`);
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

module.exports = {
  MANIFEST_FIELDS,
  resolveVariantsRoot,
  resolveManifestPath,
  readManifest,
  serializeManifest,
  validateEntryShape,
  appendEntry,
  guardAgainstDestructiveClear,
  verifyRetention,
};
