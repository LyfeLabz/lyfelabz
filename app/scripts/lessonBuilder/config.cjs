/*
 * Declarative lesson-config loader + validator.
 *
 * The build engine is generic. Each lesson lives in
 * app/scripts/lessonBuilder/lessons/<slug>.cjs and declares its paths,
 * required labels, required/prohibited signatures, and any lesson-
 * specific integrity anchors. This module loads a config by slug and
 * cross-checks it against a scan result.
 */

"use strict";

const path = require("path");
const fs = require("fs");

const LESSONS_DIR = path.join(__dirname, "lessons");

function fail(message) {
  throw new Error(`[lesson-config] ${message}`);
}

function loadConfig(slug) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) fail(`invalid slug: ${slug}`);
  const file = path.join(LESSONS_DIR, `${slug}.cjs`);
  if (!fs.existsSync(file)) fail(`no configured lesson at ${file}`);
  // eslint-disable-next-line global-require
  const cfg = require(file);
  validateConfigShape(cfg, slug);
  return cfg;
}

function listConfiguredSlugs() {
  return fs
    .readdirSync(LESSONS_DIR)
    .filter((n) => n.endsWith(".cjs") && n !== "index.cjs")
    .map((n) => n.slice(0, -".cjs".length))
    .sort();
}

function validateConfigShape(cfg, slug) {
  if (!cfg || typeof cfg !== "object") fail(`config for ${slug} is not an object`);
  if (cfg.slug !== slug) fail(`config.slug "${cfg.slug}" does not match filename "${slug}"`);
  if (typeof cfg.canonicalSource !== "string") fail(`${slug}: canonicalSource missing`);
  if (!cfg.outputs || typeof cfg.outputs.v1 !== "string" || typeof cfg.outputs.v2 !== "string") {
    fail(`${slug}: outputs.v1 and outputs.v2 must be strings`);
  }
  if (!cfg.generatedNotice || typeof cfg.generatedNotice.v1 !== "string" || typeof cfg.generatedNotice.v2 !== "string") {
    fail(`${slug}: generatedNotice.v1 and generatedNotice.v2 must be strings`);
  }
  if (!cfg.requiredLabels || !Array.isArray(cfg.requiredLabels.v1Only) || !Array.isArray(cfg.requiredLabels.v2Only)) {
    fail(`${slug}: requiredLabels.v1Only and requiredLabels.v2Only must be arrays`);
  }
  if (!cfg.expectedContexts || typeof cfg.expectedContexts !== "object") {
    fail(`${slug}: expectedContexts must be an object`);
  }
  const declared = new Set([...cfg.requiredLabels.v1Only, ...cfg.requiredLabels.v2Only]);
  for (const label of Object.keys(cfg.expectedContexts)) {
    if (!declared.has(label)) fail(`${slug}: expectedContexts label "${label}" is not in requiredLabels`);
  }
  for (const label of declared) {
    if (!cfg.expectedContexts[label]) fail(`${slug}: expectedContexts missing entry for "${label}"`);
    const ctx = cfg.expectedContexts[label];
    if (ctx !== "html" && ctx !== "js" && ctx !== "css") {
      fail(`${slug}: expectedContexts["${label}"] must be html|js|css`);
    }
  }
  if (!Array.isArray(cfg.v2ProhibitedSignatures)) fail(`${slug}: v2ProhibitedSignatures must be an array`);
  if (!Array.isArray(cfg.v1RequiredSignatures)) fail(`${slug}: v1RequiredSignatures must be an array`);
  if (!Array.isArray(cfg.sharedRequiredSignatures)) fail(`${slug}: sharedRequiredSignatures must be an array`);
}

function validateScanAgainstConfig(cfg, scan) {
  const declared = new Set([...cfg.requiredLabels.v1Only, ...cfg.requiredLabels.v2Only]);
  const seenBySlug = new Map();
  for (const region of scan.regions) {
    if (!declared.has(region.label)) {
      throw new Error(
        `[lesson-config] ${cfg.slug}: undeclared marker label "${region.label}" at line ${region.beginLine + 1}`,
      );
    }
    const expectedCtx = cfg.expectedContexts[region.label];
    if (region.context !== expectedCtx) {
      throw new Error(
        `[lesson-config] ${cfg.slug}: label "${region.label}" appears in ${region.context} context but registry expects ${expectedCtx}`,
      );
    }
    const expectedTarget = cfg.requiredLabels.v1Only.includes(region.label) ? "V1-ONLY" : "V2-ONLY";
    if (region.target !== expectedTarget) {
      throw new Error(
        `[lesson-config] ${cfg.slug}: label "${region.label}" declared as ${expectedTarget} but source uses ${region.target}`,
      );
    }
    seenBySlug.set(region.label, region);
  }
  for (const label of cfg.requiredLabels.v1Only) {
    if (!seenBySlug.has(label)) {
      throw new Error(
        `[lesson-config] ${cfg.slug}: required V1-ONLY label "${label}" missing from source`,
      );
    }
  }
  for (const label of cfg.requiredLabels.v2Only) {
    if (!seenBySlug.has(label)) {
      throw new Error(
        `[lesson-config] ${cfg.slug}: required V2-ONLY label "${label}" missing from source`,
      );
    }
  }
}

function assertSignatures(cfg, v1Bytes, v2Bytes) {
  for (const sig of cfg.v1RequiredSignatures) {
    if (!v1Bytes.includes(sig)) {
      throw new Error(
        `[lesson-config] ${cfg.slug}: v1 output missing required signature: ${sig}`,
      );
    }
  }
  for (const sig of cfg.v2ProhibitedSignatures) {
    if (v2Bytes.includes(sig)) {
      throw new Error(
        `[lesson-config] ${cfg.slug}: v2 output contains prohibited legacy signature: ${sig}`,
      );
    }
  }
  for (const sig of cfg.sharedRequiredSignatures) {
    if (!v1Bytes.includes(sig)) {
      throw new Error(
        `[lesson-config] ${cfg.slug}: v1 output missing required shared signature: ${sig}`,
      );
    }
    if (!v2Bytes.includes(sig)) {
      throw new Error(
        `[lesson-config] ${cfg.slug}: v2 output missing required shared signature: ${sig}`,
      );
    }
  }
}

module.exports = {
  loadConfig,
  listConfiguredSlugs,
  validateConfigShape,
  validateScanAgainstConfig,
  assertSignatures,
  LESSONS_DIR,
};
