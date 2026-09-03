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
const VARIANT_OUTPUT_ROOT = path.join(REPO_ROOT, "app", "lessons", "variants");

/*
 * Target-set registry (P4-3, differentiation F5.2 Slice 2).
 *
 * Every build target - the two existing canonical outputs plus the
 * differentiated-presentation target - is declared once, generically,
 * instead of the two-branch ternary this replaced. Adding a future
 * differentiated target means adding one entry here, not duplicating
 * output-path resolution.
 *
 *   "flat"   - output must live directly inside root (matches the v1
 *              public URL: no subdirectories).
 *   "nested" - output may live anywhere under root, except inside another
 *              target's reserved root (VARIANT_OUTPUT_ROOT is reserved so
 *              a canonical v2 lesson can never accidentally land inside
 *              the differentiated-variant retention tree).
 */
const TARGETS = {
  v1: { root: V1_OUTPUT_ROOT, mode: "flat" },
  v2: { root: V2_OUTPUT_ROOT, mode: "nested" },
  variant: { root: VARIANT_OUTPUT_ROOT, mode: "nested" },
};

const CANONICAL_TARGET_IDS = Object.freeze(["v1", "v2"]);

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
  const def = TARGETS[target];
  if (!def) {
    throw new Error(`[lesson-builder] unknown build target: ${target}`);
  }
  const abs = path.resolve(REPO_ROOT, relPath);
  assertWithinRepo(abs, `${target} output`);
  if (def.mode === "flat") {
    // Flat targets (v1) must land directly at their root, matching the
    // current public URL. Deeper paths are rejected so a misconfigured
    // lesson can not silently write under app/ or lesson-sources/.
    if (path.dirname(abs) !== def.root) {
      throw new Error(
        `[lesson-builder] ${target} output must live at repo root: ${relPath}`,
      );
    }
  } else {
    if (!isWithin(def.root, abs)) {
      throw new Error(
        `[lesson-builder] ${target} output must live under ${path.relative(REPO_ROOT, def.root)}/: ${relPath}`,
      );
    }
    // The differentiated-variant tree is reserved for the variant target
    // only, so a canonical target can never collide with retained variant
    // artifacts (M7 boundary).
    if (target !== "variant" && isWithin(VARIANT_OUTPUT_ROOT, abs)) {
      throw new Error(
        `[lesson-builder] ${target} output must not land under app/lessons/variants/ (reserved for differentiated presentation artifacts): ${relPath}`,
      );
    }
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
  VARIANT_OUTPUT_ROOT,
  TARGETS,
  CANONICAL_TARGET_IDS,
  isWithin,
  resolveSource,
  resolveOutput,
  assertOutputNotSource,
  tmpSibling,
  safeUnlink,
};
