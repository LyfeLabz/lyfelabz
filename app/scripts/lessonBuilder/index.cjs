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
const crypto = require("crypto");

const paths = require("./paths.cjs");
const scanner = require("./markerScanner.cjs");
const transformer = require("./transformer.cjs");
const configMod = require("./config.cjs");
const equivalence = require("./equivalence.cjs");

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

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

function buildBoth(cfg, sourceBytes) {
  const v1 = buildBytes(cfg, "v1", sourceBytes);
  const v2 = buildBytes(cfg, "v2", sourceBytes);
  configMod.assertSignatures(cfg, v1.bytes, v2.bytes);
  equivalence.assertEquivalent(v1.bytes, v2.bytes, cfg.equivalenceExclusions);
  return { v1, v2 };
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
  const { v1, v2 } = buildBoth(cfg, sourceBytes);
  const picked = target === "v1" ? v1 : v2;
  const outAbs = paths.resolveOutput(target, cfg.outputs[target]);
  const srcAbs = paths.resolveSource(cfg.canonicalSource);
  paths.assertOutputNotSource(srcAbs, outAbs);
  if (write) writeAtomically(outAbs, picked.bytes);
  return { slug, target, outputPath: outAbs, bytes: picked.bytes, sha256: sha256(picked.bytes) };
}

function verifyLesson({ slug }) {
  const cfg = configMod.loadConfig(slug);
  const { bytes: sourceBytes } = readSource(cfg);
  const { v1, v2 } = buildBoth(cfg, sourceBytes);
  const results = {};
  for (const target of ["v1", "v2"]) {
    const outAbs = paths.resolveOutput(target, cfg.outputs[target]);
    if (!fs.existsSync(outAbs)) {
      throw new Error(
        `[lesson-verify] ${slug} ${target}: committed artifact missing at ${path.relative(paths.REPO_ROOT, outAbs)}. ` +
          `Regenerate with \`npm --prefix app run lessons:build -- --only=${slug} --target=${target}\`.`,
      );
    }
    const onDisk = fs.readFileSync(outAbs, "utf8");
    const built = target === "v1" ? v1.bytes : v2.bytes;
    if (onDisk !== built) {
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
