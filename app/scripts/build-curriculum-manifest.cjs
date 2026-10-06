#!/usr/bin/env node
/*
 * LyfeLabz canonical curriculum manifest build script (Sprint 6D.0).
 *
 * Reads the authored curriculum registry
 * (`app/src/curriculum/curriculum.registry.json`) and (re)generates
 * `app/src/curriculum/curriculum.manifest.json` and the generated
 * curriculum catalog region of the root `index.html` (see
 * `curriculumCatalog.cjs`). Also supports a `--check` mode used by
 * `curriculum:verify`: it fails with a clear message if either checked-in
 * output disagrees with a fresh build from the registry.
 *
 * The manifest is authoritative for teacher-application code. The
 * registry is authoritative for the manifest and the homepage catalog.
 * See PDR-007 and TEACHER_EXPERIENCE_PHILOSOPHY.md §3.9.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const { buildManifest } = require("./curriculumRegistry.cjs");
const {
  ROOT_INDEX_PATH,
  renderCatalog,
  extractCatalog,
  spliceCatalog,
  readRootIndexHtml,
} = require("./curriculumCatalog.cjs");

const MANIFEST_PATH = path.resolve(
  __dirname,
  "..",
  "src",
  "curriculum",
  "curriculum.manifest.json",
);

function serialise(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const manifest = buildManifest();
  const nextText = serialise(manifest);
  const catalog = renderCatalog();
  const indexHtml = readRootIndexHtml();
  if (check) {
    if (extractCatalog(indexHtml) !== catalog) {
      process.stderr.write(
        `[curriculum-manifest] DRIFT: the generated curriculum catalog in root index.html does not match the curriculum registry. ` +
          `Edit the registry, not index.html, and regenerate with \`npm run curriculum:build\` inside app/.\n`,
      );
      process.exit(1);
    }
    if (!fs.existsSync(MANIFEST_PATH)) {
      process.stderr.write(
        `[curriculum-manifest] manifest missing at ${path.relative(process.cwd(), MANIFEST_PATH)}. ` +
          `Regenerate with \`npm run curriculum:build\` inside app/.\n`,
      );
      process.exit(1);
    }
    const currentText = fs.readFileSync(MANIFEST_PATH, "utf8");
    if (currentText !== nextText) {
      process.stderr.write(
        `[curriculum-manifest] DRIFT: the curriculum registry and ${path.relative(process.cwd(), MANIFEST_PATH)} disagree. ` +
          `Regenerate with \`npm run curriculum:build\` inside app/.\n`,
      );
      process.exit(1);
    }
    process.stdout.write(
      `[curriculum-manifest] OK: manifest and root index.html catalog match the curriculum registry (units=${manifest.totals.unitCount})\n`,
    );
    return;
  }
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, nextText, "utf8");
  process.stdout.write(
    `[curriculum-manifest] wrote ${path.relative(process.cwd(), MANIFEST_PATH)} ` +
      `(units=${manifest.totals.unitCount}, resources=${Object.values(manifest.totals.resourceCountsByType).reduce((a, b) => a + b, 0)})\n`,
  );
  const nextIndexHtml = spliceCatalog(indexHtml, catalog);
  if (nextIndexHtml !== indexHtml) {
    fs.writeFileSync(ROOT_INDEX_PATH, nextIndexHtml, "utf8");
    process.stdout.write(`[curriculum-manifest] wrote curriculum catalog in ${path.relative(process.cwd(), ROOT_INDEX_PATH)}\n`);
  }
}

main();
