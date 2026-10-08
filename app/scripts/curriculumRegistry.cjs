/*
 * LyfeLabz canonical curriculum registry loader.
 *
 * Reads the authored curriculum registry
 * (`app/src/curriculum/curriculum.registry.json`) and derives the
 * manifest body consumed by `build-curriculum-manifest.cjs`. The registry
 * replaces the root `index.html` as the authored source of curriculum
 * metadata. The homepage curriculum catalog is rendered from the same
 * registry by `curriculumCatalog.cjs`. Top-level `sharedResources` (types
 * whose policy placement is "shared", e.g. tools) are carried into the
 * manifest but never into the homepage catalog.
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
  UNIT_RESOURCE_TYPES,
  SHARED_RESOURCE_TYPES,
  HREF_PREFIX_BY_TYPE,
  sha256,
  summarize,
} = require("./curriculumParser.cjs");
const {
  ACTIVITY_RESOURCE_TYPES,
  activityIdForResource,
  reservedTypeForActivityId,
} = require("./activityIdentifiers.cjs");

const REGISTRY_RELATIVE_TO_APP = path.posix.join(
  "src",
  "curriculum",
  "curriculum.registry.json",
);
const REGISTRY_PATH = path.resolve(__dirname, "..", REGISTRY_RELATIVE_TO_APP);

const REGISTRY_KEYS = new Set(["schemaVersion", "$comment", "topicGroups", "sharedResources"]);
const TOPIC_GROUP_KEYS = new Set(["topic", "gated", "gradeBlocks"]);
const GRADE_BLOCK_KEYS = new Set(["grade", "units", "placeholderUnits"]);
const UNIT_KEYS = new Set(["slug", "title", "description", "resources"]);
const PLACEHOLDER_KEYS = new Set(["title", "description"]);
const RESOURCE_KEYS = new Set(["type", "filename", "label"]);
const SHARED_RESOURCE_KEYS = new Set(["id", "type", "filename", "label", "description", "relatedUnits"]);
const SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;

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
// ({ topicGroups, orphanUnits, totals, sharedResources }). The first three
// are in the exact shape and key order `parseCurriculumFromIndexHtml`
// produces; `sharedResources` has no homepage counterpart.
function deriveCurriculumFromRegistry(registry) {
  checkKeys(registry, REGISTRY_KEYS, "registry");
  if (registry.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (!Array.isArray(registry.topicGroups) || registry.topicGroups.length === 0) {
    fail("topicGroups must be a non-empty array");
  }

  const seenTopics = new Set();
  const seenSlugs = new Map();
  const seenHrefs = new Map();
  const seenActivityIds = new Map();
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
      const placeholderUnits = block.placeholderUnits === undefined ? [] : block.placeholderUnits;
      if (!Array.isArray(placeholderUnits)) {
        fail(`${where}/${grade} placeholderUnits must be an array`);
      }
      placeholderUnits.forEach((p, i) => {
        checkKeys(p, PLACEHOLDER_KEYS, `placeholder unit ${i} in ${where}/${grade}`);
        checkText(p.title, `placeholder unit ${i} in ${where}/${grade} title`);
        checkText(p.description, `placeholder unit "${p.title}" description`);
      });
      const placeholders = placeholderUnits.length;
      if (placeholders > 0 && !tg.gated) {
        fail(`${where}/${grade} declares placeholder units outside a gated topic group`);
      }
      if (block.units.length + placeholders === 0) {
        fail(`${where}/${grade} contains no units`);
      }

      let inBlockOrder = 0;
      for (const u of block.units) {
        checkKeys(u, UNIT_KEYS, `unit in ${where}/${grade}`);
        if (typeof u.slug !== "string" || !SLUG_PATTERN.test(u.slug)) {
          fail(`invalid slug "${u.slug}" in ${where}/${grade}`);
        }
        if (reservedTypeForActivityId(u.slug) !== null) {
          fail(`unit slug "${u.slug}" begins with a reserved activity identifier prefix`);
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
          checkResourceType(r.type, UNIT_RESOURCE_TYPES, `unit "${u.slug}"`);
          checkFilename(r.filename, r.type);
          checkText(r.label, `resource "${r.filename}" label`);
          const href = claimHref(seenHrefs, r.filename, u.slug);
          claimActivityId(seenActivityIds, r, u.slug);
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

  const sharedResources = deriveSharedResources(registry.sharedResources, seenSlugs, seenHrefs);

  return {
    topicGroups: outGroups,
    orphanUnits,
    totals: summarize(outGroups),
    sharedResources,
  };
}

// Top-level resources no unit owns (e.g. reusable tools). They are never
// rendered by the homepage catalog. `relatedUnits` records a conceptual
// relationship to existing units; it implies no homepage nesting.
function deriveSharedResources(entries, unitSlugs, seenHrefs) {
  if (entries === undefined) return [];
  if (!Array.isArray(entries)) fail("sharedResources must be an array");
  const seenIds = new Set();
  return entries.map((r, order) => {
    checkKeys(r, SHARED_RESOURCE_KEYS, `shared resource ${order}`);
    if (typeof r.id !== "string" || !SLUG_PATTERN.test(r.id)) {
      fail(`invalid shared resource id "${r.id}"`);
    }
    if (seenIds.has(r.id)) fail(`duplicate shared resource id "${r.id}"`);
    seenIds.add(r.id);
    checkResourceType(r.type, SHARED_RESOURCE_TYPES, `shared resource "${r.id}"`);
    checkFilename(r.filename, r.type);
    checkText(r.label, `shared resource "${r.id}" label`);
    checkText(r.description, `shared resource "${r.id}" description`);
    const href = claimHref(seenHrefs, r.filename, `shared resource "${r.id}"`);

    let relatedUnits = [];
    if (r.relatedUnits !== undefined) {
      if (!Array.isArray(r.relatedUnits) || r.relatedUnits.length === 0) {
        fail(`shared resource "${r.id}" relatedUnits must be a non-empty array when present`);
      }
      const seenRelated = new Set();
      for (const slug of r.relatedUnits) {
        if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
          fail(`shared resource "${r.id}" has malformed related unit "${slug}"`);
        }
        if (!unitSlugs.has(slug)) {
          fail(`shared resource "${r.id}" relates to unknown unit "${slug}"`);
        }
        if (seenRelated.has(slug)) {
          fail(`shared resource "${r.id}" lists related unit "${slug}" more than once`);
        }
        seenRelated.add(slug);
      }
      relatedUnits = r.relatedUnits.slice();
    }

    return {
      id: r.id,
      type: r.type,
      href,
      filename: r.filename,
      label: r.label,
      description: r.description,
      relatedUnits,
      displayOrder: order,
    };
  });
}

function checkResourceType(type, allowed, where) {
  if (!RESOURCE_TYPES.includes(type)) {
    fail(`unrecognized resource type "${type}" on ${where}`);
  }
  if (!allowed.includes(type)) {
    fail(`resource type "${type}" is not permitted on ${where}`);
  }
}

function checkFilename(filename, type) {
  if (typeof filename !== "string" || !/^[a-z][a-z0-9_-]*\.html$/.test(filename)) {
    fail(`unexpected canonical curriculum filename "${filename}" (must be a bare filename)`);
  }
  if (!filename.startsWith(HREF_PREFIX_BY_TYPE[type])) {
    fail(
      `resource filename "${filename}" does not match its declared type "${type}" (expected prefix "${HREF_PREFIX_BY_TYPE[type]}")`,
    );
  }
}

// Every resource that carries an assignment activity identifier
// (`activityIdentifiers.cjs`) must yield a valid one, unique across all
// resource types; a lesson's identifier must be its unit's slug.
function claimActivityId(seenActivityIds, resource, unitSlug) {
  if (!ACTIVITY_RESOURCE_TYPES.includes(resource.type)) return;
  const activityId = activityIdForResource(resource.type, resource.filename);
  if (activityId === null) {
    fail(`resource "${resource.filename}" does not yield a valid assignment activity identifier`);
  }
  if (resource.type === "lesson" && activityId !== unitSlug) {
    fail(`lesson "${resource.filename}" activity identifier "${activityId}" does not match unit slug "${unitSlug}"`);
  }
  if (seenActivityIds.has(activityId)) {
    fail(`duplicate activity identifier "${activityId}" (also on ${seenActivityIds.get(activityId)})`);
  }
  seenActivityIds.set(activityId, resource.filename);
}

// Every registered href (unit-owned or shared) is unique.
function claimHref(seenHrefs, filename, owner) {
  const href = `/${filename}`;
  if (seenHrefs.has(href)) {
    fail(`duplicate resource href "${href}" (also on ${seenHrefs.get(href)})`);
  }
  seenHrefs.set(href, owner);
  return href;
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
    sharedResources: derived.sharedResources,
  };
}

module.exports = {
  REGISTRY_PATH,
  REGISTRY_RELATIVE_TO_APP,
  deriveCurriculumFromRegistry,
  parseRegistryText,
  readRegistryText,
  buildManifest,
};
