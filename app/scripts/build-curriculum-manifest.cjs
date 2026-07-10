#!/usr/bin/env node
/*
 * LyfeLabz canonical curriculum manifest build script (Sprint 6D.0).
 *
 * Reads the root canonical `index.html` and (re)generates
 * `app/src/curriculum/curriculum.manifest.json`. Also supports a
 * `--check` mode used by the drift test: it fails with a clear message
 * if the checked-in manifest and the freshly parsed manifest disagree.
 *
 * The manifest is authoritative for teacher-application code. The root
 * index.html is authoritative for the manifest. See PDR-007 and
 * TEACHER_EXPERIENCE_PHILOSOPHY.md §3.9.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const { buildManifest } = require("./curriculumParser.cjs");

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
  if (check) {
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
        `[curriculum-manifest] DRIFT: root index.html and ${path.relative(process.cwd(), MANIFEST_PATH)} disagree. ` +
          `Regenerate with \`npm run curriculum:build\` inside app/.\n`,
      );
      process.exit(1);
    }
    process.stdout.write(
      `[curriculum-manifest] OK: manifest matches canonical index.html (units=${manifest.totals.unitCount})\n`,
    );
    return;
  }
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, nextText, "utf8");
  process.stdout.write(
    `[curriculum-manifest] wrote ${path.relative(process.cwd(), MANIFEST_PATH)} ` +
      `(units=${manifest.totals.unitCount}, resources=${Object.values(manifest.totals.resourceCountsByType).reduce((a, b) => a + b, 0)})\n`,
  );
}

main();
