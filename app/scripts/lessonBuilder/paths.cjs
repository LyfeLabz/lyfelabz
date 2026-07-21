/*
 * Path boundary utilities for the lesson builder.
 *
 * Sprint 18 correction 7. Every source and output path is resolved
 * against the repository root and rejected if it escapes the expected
 * boundary. Source overwrites are refused. Temporary sibling filenames
 * include the process id so a crashed build never collides with a
 * concurrent build in a peer worktree.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const CANONICAL_ROOT = path.join(REPO_ROOT, "lesson-sources");
const V1_OUTPUT_ROOT = REPO_ROOT;
const V2_OUTPUT_ROOT = path.join(REPO_ROOT, "app", "lessons");

function isWithin(parent, child) {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function assertWithinRepo(absPath, label) {
  if (!isWithin(REPO_ROOT, absPath) && absPath !== REPO_ROOT) {
    throw new Error(
      `[lesson-builder] ${label} escapes repository root: ${absPath}`,
    );
  }
}

function resolveSource(relPath) {
  const abs = path.resolve(REPO_ROOT, relPath);
  assertWithinRepo(abs, "canonical source");
  if (!isWithin(CANONICAL_ROOT, abs)) {
    throw new Error(
      `[lesson-builder] canonical source must live under lesson-sources/: ${relPath}`,
    );
  }
  return abs;
}

function resolveOutput(target, relPath) {
  const abs = path.resolve(REPO_ROOT, relPath);
  assertWithinRepo(abs, `${target} output`);
  const expectedRoot = target === "v1" ? V1_OUTPUT_ROOT : V2_OUTPUT_ROOT;
  if (target === "v1") {
    // v1 output must live directly at the repo root, matching the current
    // public URL. Deeper paths are rejected so a misconfigured lesson can
    // not silently write under app/ or lesson-sources/.
    if (path.dirname(abs) !== expectedRoot) {
      throw new Error(
        `[lesson-builder] v1 output must live at repo root: ${relPath}`,
      );
    }
  } else if (target === "v2") {
    if (!isWithin(expectedRoot, abs)) {
      throw new Error(
        `[lesson-builder] v2 output must live under app/lessons/: ${relPath}`,
      );
    }
  } else {
    throw new Error(`[lesson-builder] unknown build target: ${target}`);
  }
  return abs;
}

function assertOutputNotSource(sourceAbs, outputAbs) {
  if (sourceAbs === outputAbs) {
    throw new Error(
      `[lesson-builder] refusing to overwrite canonical source with build output: ${sourceAbs}`,
    );
  }
  if (isWithin(CANONICAL_ROOT, outputAbs)) {
    throw new Error(
      `[lesson-builder] build output must not land under lesson-sources/: ${outputAbs}`,
    );
  }
}

function tmpSibling(finalAbs) {
  const dir = path.dirname(finalAbs);
  const base = path.basename(finalAbs);
  return path.join(dir, `.${base}.build-tmp.${process.pid}`);
}

function safeUnlink(p) {
  try {
    fs.unlinkSync(p);
  } catch (err) {
    if (err && err.code === "ENOENT") return;
    // Any other error is silent by design; the finally-clean is best
    // effort and a leftover tmp file is preferable to masking a real
    // build error.
  }
}

module.exports = {
  REPO_ROOT,
  CANONICAL_ROOT,
  V1_OUTPUT_ROOT,
  V2_OUTPUT_ROOT,
  isWithin,
  resolveSource,
  resolveOutput,
  assertOutputNotSource,
  tmpSibling,
  safeUnlink,
};
