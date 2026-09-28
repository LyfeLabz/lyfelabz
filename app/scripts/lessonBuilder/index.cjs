/*
 * Public builder API.
 *
 * buildLesson({slug, target, write})    -> { bytes, sha256 }
 * verifyLesson({slug})                  -> {v1, v2, renditions, ok:true}
 * buildPathTable() / writePathTable()   -> revision-to-path table
 * verifyRenditionTree()                 -> drift check of the rendition tree
 *
 * When write=true, the builder writes the output to a PID-suffixed tmp
 * sibling and atomically renames on success. When write=false (the
 * default), the builder returns bytes without touching the filesystem.
 * verifyLesson always runs in memory.
 *
 * F5.3 Slice 9B (assessmentRenditions.cjs): every canonical v1 and v2 build
 * must be faithful to the lesson's configured canonical assessment revision
 * and carries that revision's declaration; a lesson with more than one
 * committed revision also builds one v2 rendition per revision. The variant
 * build path (variantSource.cjs) never goes through this module.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const paths = require("./paths.cjs");
const scanner = require("./markerScanner.cjs");
const transformer = require("./transformer.cjs");
const configMod = require("./config.cjs");
const equivalence = require("./equivalence.cjs");
const fidelity = require("./assessmentFidelity.cjs");
const assessmentRevisions = require("./assessmentRevisions.cjs");
const renditions = require("./assessmentRenditions.cjs");
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

function lessonRevisions(slug, revisionsBySlug) {
  if (revisionsBySlug) return revisionsBySlug.get(slug) || [];
  return assessmentRevisions.revisionsForLesson(slug);
}

function buildAllTargets(cfg, sourceBytes, revisionsBySlug = null) {
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

  // F5.3 Slice 9B: the canonical pages display the configured canonical
  // revision (fail closed if the quiz is not faithful to it) and declare it.
  const committed = lessonRevisions(cfg.slug, revisionsBySlug);
  const canonical = assessmentRevisions.resolveCanonicalRevision(cfg, committed);
  for (const target of paths.CANONICAL_TARGET_IDS) {
    const quiz = fidelity.extractCanonicalQuiz(built[target].bytes, cfg.slug);
    const problems = fidelity.checkFidelity(cfg.slug, canonical.payload, quiz);
    if (problems.length > 0) {
      throw new Error(
        `[lesson-builder] ${cfg.slug} ${target}: canonical quiz is not faithful to its configured revision ${canonical.file}:\n${problems.join("\n")}`,
      );
    }
    built[target].bytes = renditions.insertDeclaration(built[target].bytes, cfg.slug, canonical.assessmentRevisionId);
  }

  // One rendition per committed revision, only for multi-revision lessons.
  built.renditions = [];
  if (committed.length > 1) {
    const scan = scanner.scan(sourceBytes);
    for (const entry of committed) {
      const make = () =>
        renditions.buildRendition(
          transformer.transform(sourceBytes, scan.regions, "v2", renditions.renditionNotice(cfg, entry)),
          cfg.slug,
          entry,
        );
      const first = make();
      if (make().bytes !== first.bytes) {
        throw new Error(`[lesson-builder] ${cfg.slug}: rendition of ${entry.assessmentRevisionId} is not deterministic`);
      }
      built.renditions.push(first);
    }
  }
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

function renditionAbs(relPath) {
  return paths.resolveOutput("rendition", relPath);
}

function buildLesson({ slug, target, write = false, revisionsBySlug = null }) {
  const cfg = configMod.loadConfig(slug);
  const { bytes: sourceBytes } = readSource(cfg);
  const built = buildAllTargets(cfg, sourceBytes, revisionsBySlug);
  const picked = built[target];
  if (!picked || !paths.CANONICAL_TARGET_IDS.includes(target)) throw new Error(`[lesson-builder] unknown build target: ${target}`);
  const outAbs = paths.resolveOutput(target, cfg.outputs[target]);
  const srcAbs = paths.resolveSource(cfg.canonicalSource);
  paths.assertOutputNotSource(srcAbs, outAbs);
  const renditionOutputs = target === "v2" ? built.renditions : [];
  if (write) {
    writeAtomically(outAbs, picked.bytes);
    for (const r of renditionOutputs) {
      const abs = renditionAbs(r.path);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      writeAtomically(abs, r.bytes);
    }
  }
  return {
    slug,
    target,
    outputPath: outAbs,
    bytes: picked.bytes,
    sha256: sha256(picked.bytes),
    renditions: renditionOutputs.map((r) => ({ path: r.path, assessmentRevisionId: r.assessmentRevisionId, sha256: sha256(r.bytes) })),
  };
}

function verifyLesson({ slug, revisionsBySlug = null }) {
  const cfg = configMod.loadConfig(slug);
  const { bytes: sourceBytes } = readSource(cfg);
  const built = buildAllTargets(cfg, sourceBytes, revisionsBySlug);
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
  results.renditions = built.renditions.map((r) => {
    const abs = renditionAbs(r.path);
    if (!fs.existsSync(abs) || fs.readFileSync(abs, "utf8") !== r.bytes) {
      throw new Error(
        `[lesson-verify] ${slug}: assessment-revision rendition ${r.path} is missing or drifts from the canonical source and ${r.assessmentRevisionId}. ` +
          `Regenerate with \`npm --prefix app run lessons:build -- --only=${slug}\`.`,
      );
    }
    return { path: r.path, assessmentRevisionId: r.assessmentRevisionId, sha256: sha256(r.bytes) };
  });
  return { slug, ok: true, ...results };
}

// -- Revision-to-path table and rendition tree (F5.3 Slice 9B) -------------

function buildPathTable({ revisionsBySlug = null } = {}) {
  const bySlug = revisionsBySlug || assessmentRevisions.loadRevisions().bySlug;
  const configs = configMod.listConfiguredSlugs().map((s) => configMod.loadConfig(s));
  return renditions.buildRevisionPathTable(configs, bySlug);
}

function pathTableAbs() {
  return renditionAbs(renditions.PATH_TABLE_FILE);
}

function clientPathTableAbs() {
  return path.join(paths.REPO_ROOT, renditions.CLIENT_PATH_TABLE_FILE);
}

function writePathTable(options = {}) {
  const bytes = renditions.serializePathTable(buildPathTable(options));
  const abs = pathTableAbs();
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  writeAtomically(abs, bytes);
  // F5.3 Slice 9D: the client's bundled copy, byte-identical.
  writeAtomically(clientPathTableAbs(), bytes);
  return { outputPath: abs, sha256: sha256(bytes) };
}

// The rendition tree holds exactly the path table plus the renditions the
// table names: a stale, orphaned, or hand-added file fails.
function verifyRenditionTree(options = {}) {
  const table = buildPathTable(options);
  const expectedTable = renditions.serializePathTable(table);
  const abs = pathTableAbs();
  if (!fs.existsSync(abs) || fs.readFileSync(abs, "utf8") !== expectedTable) {
    throw new Error(
      `[lesson-verify] ${renditions.PATH_TABLE_FILE} is missing or drifts from the committed revisions. ` +
        "Regenerate with `npm --prefix app run lessons:build`.",
    );
  }
  const clientAbs = clientPathTableAbs();
  if (!fs.existsSync(clientAbs) || fs.readFileSync(clientAbs, "utf8") !== expectedTable) {
    throw new Error(
      `[lesson-verify] ${renditions.CLIENT_PATH_TABLE_FILE} is missing or drifts from ${renditions.PATH_TABLE_FILE}. ` +
        "Regenerate with `npm --prefix app run lessons:build`.",
    );
  }
  const expected = new Set([renditions.PATH_TABLE_FILE, ...renditions.renditionPathsInTable(table)]);
  const dir = paths.RENDITION_OUTPUT_ROOT;
  const actual = fs.readdirSync(dir, { withFileTypes: true }).map((d) => {
    if (!d.isFile()) throw new Error(`[lesson-verify] unexpected entry in ${renditions.RENDITION_DIR}/: ${d.name}`);
    return `${renditions.RENDITION_DIR}/${d.name}`;
  });
  const unexpected = actual.filter((p) => !expected.has(p)).sort();
  if (unexpected.length > 0) {
    throw new Error(`[lesson-verify] unexpected file(s) in ${renditions.RENDITION_DIR}/ (no committed revision renders them): ${unexpected.join(", ")}`);
  }
  const missing = [...expected].filter((p) => !actual.includes(p)).sort();
  if (missing.length > 0) throw new Error(`[lesson-verify] missing: ${missing.join(", ")}`);
  return { table, sha256: sha256(expectedTable), renditions: expected.size - 1 };
}

module.exports = {
  buildAllTargets,
  buildLesson,
  verifyLesson,
  buildPathTable,
  writePathTable,
  verifyRenditionTree,
  sha256,
  listConfiguredSlugs: configMod.listConfiguredSlugs,
};
