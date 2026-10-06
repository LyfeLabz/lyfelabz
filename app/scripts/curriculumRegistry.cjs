/*
 * LyfeLabz canonical curriculum registry loader.
 *
 * Reads the authored curriculum registry
 * (`app/src/curriculum/curriculum.registry.json`) and derives the
 * manifest body consumed by `build-curriculum-manifest.cjs`. The registry
 * replaces the root `index.html` as the authored source of curriculum
 * metadata; the generated manifest contract is unchanged.
 *
 * During migration the homepage is still hand-authored, so
 * `compareRegistryWithIndexHtml` keeps the two in lockstep: the registry
 * must describe exactly the curriculum `curriculumParser.cjs` extracts
 * from `index.html`.
 *
 * Validation is deliberately strict and mirrors the parser's guarantees.
 * This module has no external dependencies.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const {
  TOPIC_ORDER,
  TOPIC_LABELS,
  RESOURCE_TYPES,
  HREF_PREFIX_BY_TYPE,
  parseCurriculumFromIndexHtml,
  readRootIndexHtml,
  sha256,
  summarize,
} = require("./curriculumParser.cjs");

const REGISTRY_RELATIVE_TO_APP = path.posix.join(
  "src",
  "curriculum",
  "curriculum.registry.json",
);
const REGISTRY_PATH = path.resolve(__dirname, "..", REGISTRY_RELATIVE_TO_APP);

const REGISTRY_KEYS = new Set(["schemaVersion", "$comment", "topicGroups"]);
const TOPIC_GROUP_KEYS = new Set(["topic", "gated", "gradeBlocks"]);
const GRADE_BLOCK_KEYS = new Set(["grade", "units", "placeholderUnits"]);
const UNIT_KEYS = new Set(["slug", "title", "description", "resources"]);
const RESOURCE_KEYS = new Set(["type", "filename", "label"]);

function fail(message) {
  throw new Error(`[curriculum-registry] ${message}`);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkKeys(value, allowed, where) {
  if (!isPlainObject(value)) fail(`${where} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${where} has unknown key "${key}"`);
  }
}

// Text fields must already be in the collapsed form the manifest carries.
function checkText(value, where) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${where} must be a non-empty string`);
  }
  if (value !== value.replace(/\s+/g, " ").trim()) {
    fail(`${where} must not contain leading, trailing, or repeated whitespace`);
  }
}

function readRegistryText() {
  return fs.readFileSync(REGISTRY_PATH, "utf8");
}

// Validate an authored registry and derive the manifest body
// ({ topicGroups, orphanUnits, totals }) in the exact shape and key order
// `parseCurriculumFromIndexHtml` produces.
function deriveCurriculumFromRegistry(registry) {
  checkKeys(registry, REGISTRY_KEYS, "registry");
  if (registry.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (!Array.isArray(registry.topicGroups) || registry.topicGroups.length === 0) {
    fail("topicGroups must be a non-empty array");
  }

  const seenTopics = new Set();
  const seenSlugs = new Map();
  const seenHrefs = new Map();
  const orphanUnits = [];
  const outGroups = [];
  let topicDisplayOrder = 0;
  let globalUnitOrder = 0;

  for (const tg of registry.topicGroups) {
    checkKeys(tg, TOPIC_GROUP_KEYS, "topic group");
    if (!TOPIC_ORDER.includes(tg.topic)) fail(`unknown canonical topic "${tg.topic}"`);
    if (seenTopics.has(tg.topic)) fail(`duplicate topic group "${tg.topic}"`);
    seenTopics.add(tg.topic);
    if (typeof tg.gated !== "boolean") fail(`topic group "${tg.topic}" gated must be boolean`);
    if (!Array.isArray(tg.gradeBlocks) || tg.gradeBlocks.length === 0) {
      fail(`topic group "${tg.topic}" has no gradeBlocks`);
    }

    const units = [];
    for (const block of tg.gradeBlocks) {
      const where = `grade block ${tg.topic}`;
      checkKeys(block, GRADE_BLOCK_KEYS, where);
      if (typeof block.grade !== "string" || !/^[6-8]$/.test(block.grade)) {
        fail(`invalid grade "${block.grade}" in ${where}`);
      }
      const grade = block.grade;
      if (!Array.isArray(block.units)) fail(`${where}/${grade} units must be an array`);
      const placeholders = block.placeholderUnits === undefined ? 0 : block.placeholderUnits;
      if (!Number.isInteger(placeholders) || placeholders < 0) {
        fail(`${where}/${grade} placeholderUnits must be a non-negative integer`);
      }
      if (placeholders > 0 && !tg.gated) {
        fail(`${where}/${grade} declares placeholder units outside a gated topic group`);
      }
      if (block.units.length + placeholders === 0) {
        fail(`${where}/${grade} contains no units`);
      }

      let inBlockOrder = 0;
      for (const u of block.units) {
        checkKeys(u, UNIT_KEYS, `unit in ${where}/${grade}`);
        if (typeof u.slug !== "string" || !/^[a-z][a-z0-9-]*$/.test(u.slug)) {
          fail(`invalid slug "${u.slug}" in ${where}/${grade}`);
        }
        checkText(u.title, `unit "${u.slug}" title`);
        checkText(u.description, `unit "${u.slug}" description`);
        if (seenSlugs.has(u.slug)) {
          fail(`duplicate unit slug "${u.slug}" (also in ${seenSlugs.get(u.slug)})`);
        }
        seenSlugs.set(u.slug, `${tg.topic}/${grade}`);
        if (!Array.isArray(u.resources)) fail(`unit "${u.slug}" resources must be an array`);

        const resources = u.resources.map((r, order) => {
          checkKeys(r, RESOURCE_KEYS, `resource on unit "${u.slug}"`);
          if (!RESOURCE_TYPES.includes(r.type)) {
            fail(`unrecognized resource type "${r.type}" on unit "${u.slug}"`);
          }
          if (typeof r.filename !== "string" || !/^[a-z][a-z0-9_-]*\.html$/.test(r.filename)) {
            fail(`unexpected canonical curriculum filename "${r.filename}" (must be a bare filename)`);
          }
          if (!r.filename.startsWith(HREF_PREFIX_BY_TYPE[r.type])) {
            fail(
              `resource filename "${r.filename}" does not match its declared type "${r.type}" (expected prefix "${HREF_PREFIX_BY_TYPE[r.type]}")`,
            );
          }
          checkText(r.label, `resource "${r.filename}" label`);
          const href = `/${r.filename}`;
          if (seenHrefs.has(href)) {
            fail(`duplicate resource href "${href}" (also on ${seenHrefs.get(href)})`);
          }
          seenHrefs.set(href, u.slug);
          return {
            type: r.type,
            href,
            filename: r.filename,
            label: r.label,
            displayOrder: order,
          };
        });

        units.push({
          slug: u.slug,
          title: u.title,
          description: u.description,
          grade,
          topic: tg.topic,
          gated: tg.gated,
          displayOrder: globalUnitOrder++,
          resources,
          inGroupOrder: inBlockOrder++,
        });
      }

      for (let i = 0; i < placeholders; i++) {
        orphanUnits.push({ topic: tg.topic, grade, gated: tg.gated });
      }
    }

    outGroups.push({
      topic: tg.topic,
      label: TOPIC_LABELS[tg.topic],
      gated: tg.gated,
      displayOrder: topicDisplayOrder++,
      units,
    });
  }

  return {
    topicGroups: outGroups,
    orphanUnits,
    totals: summarize(outGroups),
  };
}

function parseRegistryText(text) {
  let registry;
  try {
    registry = JSON.parse(text);
  } catch (error) {
    fail(`registry is not valid JSON: ${error.message}`);
  }
  return deriveCurriculumFromRegistry(registry);
}

function buildManifest() {
  const registryText = readRegistryText();
  const derived = parseRegistryText(registryText);
  return {
    schemaVersion: 1,
    generated: true,
    generatedBy: "app/scripts/build-curriculum-manifest.cjs",
    canonicalSource: `app/${REGISTRY_RELATIVE_TO_APP}`,
    canonicalSourceRelativeToApp: REGISTRY_RELATIVE_TO_APP,
    canonicalSourceSha256: sha256(registryText),
    doNotEditByHand:
      "This file is generated from the canonical curriculum registry app/src/curriculum/curriculum.registry.json. Do not edit by hand. Regenerate with `npm run curriculum:build` inside app/.",
    totals: derived.totals,
    topicGroups: derived.topicGroups,
    orphanUnits: derived.orphanUnits,
  };
}

// First path at which two JSON-compatible values differ, or null.
function firstDifference(a, b, where = "$") {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    return where;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return where;
  const keys = Array.isArray(a)
    ? [...Array(Math.max(a.length, b.length)).keys()]
    : [...new Set([...Object.keys(a), ...Object.keys(b)])];
  if (!Array.isArray(a) && Object.keys(a).join() !== Object.keys(b).join()) {
    return `${where} (key order)`;
  }
  for (const key of keys) {
    const diff = firstDifference(a[key], b[key], `${where}.${key}`);
    if (diff) return diff;
  }
  return null;
}

// Migration lockstep: the registry must describe exactly the curriculum
// the hand-authored homepage presents. Returns null when they agree, or
// the first differing path.
function compareRegistryWithIndexHtml(
  registryText = readRegistryText(),
  indexHtml = readRootIndexHtml(),
) {
  return firstDifference(
    parseRegistryText(registryText),
    parseCurriculumFromIndexHtml(indexHtml),
  );
}

module.exports = {
  REGISTRY_PATH,
  REGISTRY_RELATIVE_TO_APP,
  deriveCurriculumFromRegistry,
  parseRegistryText,
  readRegistryText,
  buildManifest,
  compareRegistryWithIndexHtml,
};
