/*
 * Public builder API.
 *
 * buildLesson({slug, target, write})    -> { bytes, sha256 }
 * verifyLesson({slug})                  -> {v1, v2, ok:true}
 *
 * When write=true, the builder writes the output to a PID-suffixed tmp
 * sibling and atomically renames on success. When write=false (the
 * default), the builder returns bytes without touching the filesystem.
 * verifyLesson always runs in memory.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const paths = require("./paths.cjs");
const scanner = require("./markerScanner.cjs");
const transformer = require("./transformer.cjs");
const configMod = require("./config.cjs");
const equivalence = require("./equivalence.cjs");
const { sha256Hex: sha256 } = require("./hash.cjs");

function readSource(cfg) {
  const abs = paths.resolveSource(cfg.canonicalSource);
  const bytes = fs.readFileSync(abs, "utf8");
  return { abs, bytes };
}

function buildBytes(cfg, target, sourceBytes) {
  const scan = scanner.scan(sourceBytes);
  configMod.validateScanAgainstConfig(cfg, scan);
  const notice = cfg.generatedNotice[target];
  const out = transformer.transform(sourceBytes, scan.regions, target, notice);
  return { bytes: out, scan };
}

function buildAllTargets(cfg, sourceBytes) {
  // Target-set model (P4-3): every configured canonical target is built
  // from one loop over paths.CANONICAL_TARGET_IDS instead of two literal
  // branches. The per-pair signature/equivalence checks below remain
  // v1/v2-specific by design - that is the canonical instructional
  // contract between the public and authenticated lesson, not build-target
  // dispatch, and F5.2 leaves it unchanged.
  const built = {};
  for (const target of paths.CANONICAL_TARGET_IDS) {
    built[target] = buildBytes(cfg, target, sourceBytes);
  }
  configMod.assertSignatures(cfg, built.v1.bytes, built.v2.bytes);
  equivalence.assertEquivalent(built.v1.bytes, built.v2.bytes, cfg.equivalenceExclusions);
  return built;
}

function writeAtomically(finalAbs, bytes) {
  const tmp = paths.tmpSibling(finalAbs);
  try {
    fs.writeFileSync(tmp, bytes, { encoding: "utf8", mode: 0o644 });
    fs.renameSync(tmp, finalAbs);
  } finally {
    paths.safeUnlink(tmp);
  }
}

function buildLesson({ slug, target, write = false }) {
  const cfg = configMod.loadConfig(slug);
  const { bytes: sourceBytes } = readSource(cfg);
  const built = buildAllTargets(cfg, sourceBytes);
  const picked = built[target];
  if (!picked) throw new Error(`[lesson-builder] unknown build target: ${target}`);
  const outAbs = paths.resolveOutput(target, cfg.outputs[target]);
  const srcAbs = paths.resolveSource(cfg.canonicalSource);
  paths.assertOutputNotSource(srcAbs, outAbs);
  if (write) writeAtomically(outAbs, picked.bytes);
  return { slug, target, outputPath: outAbs, bytes: picked.bytes, sha256: sha256(picked.bytes) };
}

function verifyLesson({ slug }) {
  const cfg = configMod.loadConfig(slug);
  const { bytes: sourceBytes } = readSource(cfg);
  const built = buildAllTargets(cfg, sourceBytes);
  const results = {};
  for (const target of paths.CANONICAL_TARGET_IDS) {
    const outAbs = paths.resolveOutput(target, cfg.outputs[target]);
    if (!fs.existsSync(outAbs)) {
      throw new Error(
        `[lesson-verify] ${slug} ${target}: committed artifact missing at ${path.relative(paths.REPO_ROOT, outAbs)}. ` +
          `Regenerate with \`npm --prefix app run lessons:build -- --only=${slug} --target=${target}\`.`,
      );
    }
    const onDisk = fs.readFileSync(outAbs, "utf8");
    const builtBytes = built[target].bytes;
    if (onDisk !== builtBytes) {
      throw new Error(
        `[lesson-verify] ${slug} ${target}: committed artifact drifts from canonical source. ` +
          `Regenerate with \`npm --prefix app run lessons:build -- --only=${slug} --target=${target}\`.`,
      );
    }
    results[target] = { outputPath: outAbs, sha256: sha256(onDisk) };
  }
  return { slug, ok: true, ...results };
}

module.exports = {
  buildLesson,
  verifyLesson,
  sha256,
  listConfiguredSlugs: configMod.listConfiguredSlugs,
};
