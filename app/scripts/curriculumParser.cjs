/*
 * LyfeLabz canonical curriculum parser (Sprint 6D.0).
 *
 * Reads the root `index.html` and returns a deterministic,
 * JSON-serialisable description of every unit and resource the homepage
 * surfaces. The authored source of curriculum metadata is the curriculum
 * registry (`curriculumRegistry.cjs`), and the homepage catalog is
 * generated from it (`curriculumCatalog.cjs`). This parser is no longer a
 * source of curriculum: it is an independent reader used by tests to
 * prove the generated homepage round-trips to exactly the registered
 * curriculum. It also hosts the shared topic and resource-type constants
 * (the latter derived from `curriculum.resource-types.json`).
 *
 * The parser is deliberately strict. It fails loudly rather than
 * silently omitting malformed or unrecognized curriculum markup. This
 * module has no external dependencies.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT_INDEX_RELATIVE = path.join("..", "..", "index.html");

// Canonical topic-group data-group ids surfaced by the current index.
// Extending this set requires a deliberate curriculum decision.
const TOPIC_ORDER = Object.freeze([
  "life-science",
  "earth-space",
  "physical-science",
  "tech-engineering",
  "behavioral-science",
]);

const TOPIC_LABELS = Object.freeze({
  "life-science": "Life Science",
  "earth-space": "Earth & Space",
  "physical-science": "Physical Science",
  "tech-engineering": "Tech & Engineering",
  "behavioral-science": "Behavioral Science",
});

// Canonical resource-type policy (`curriculum.resource-types.json`). It is
// the single source of each type's filename prefix, homepage ulink class,
// registry placement, formal status, Teacher Workspace visibility, and
// assignability; the constants below are derived from it.
const RESOURCE_TYPE_POLICY_RELATIVE_TO_APP = path.posix.join(
  "src",
  "curriculum",
  "curriculum.resource-types.json",
);
const RESOURCE_TYPE_POLICY = loadResourceTypePolicy(
  JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", RESOURCE_TYPE_POLICY_RELATIVE_TO_APP), "utf8"),
  ),
);

function loadResourceTypePolicy(raw) {
  const flags = ["formal", "teacherVisible", "assignable"];
  const keys = new Set(["filenamePrefix", "ulinkClass", "placement", ...flags]);
  if (!raw || typeof raw.types !== "object" || raw.types === null) {
    fail("resource-type policy must declare a types object");
  }
  const seenClasses = new Set();
  const out = {};
  for (const [type, p] of Object.entries(raw.types)) {
    if (!/^[a-z]+$/.test(type)) fail(`invalid resource type name "${type}"`);
    for (const key of Object.keys(p)) {
      if (!keys.has(key)) fail(`resource type "${type}" has unknown policy key "${key}"`);
    }
    if (p.filenamePrefix !== `${type}_`) {
      fail(`resource type "${type}" filenamePrefix must be "${type}_"`);
    }
    if (p.placement !== "unit" && p.placement !== "shared") {
      fail(`resource type "${type}" placement must be "unit" or "shared"`);
    }
    if (p.placement === "unit" && typeof p.ulinkClass !== "string") {
      fail(`unit-placed resource type "${type}" needs a homepage ulinkClass`);
    }
    if (p.placement === "shared" && p.ulinkClass !== null) {
      fail(`shared resource type "${type}" must not declare a homepage ulinkClass`);
    }
    if (p.ulinkClass !== null) {
      if (seenClasses.has(p.ulinkClass)) fail(`duplicate ulinkClass "${p.ulinkClass}"`);
      seenClasses.add(p.ulinkClass);
    }
    for (const flag of flags) {
      if (typeof p[flag] !== "boolean") fail(`resource type "${type}" ${flag} must be boolean`);
    }
    if (p.assignable && !p.teacherVisible) {
      fail(`resource type "${type}" cannot be assignable without being teacher-visible`);
    }
    out[type] = Object.freeze({ ...p });
  }
  return Object.freeze(out);
}

// Every supported resource type, in policy order.
const RESOURCE_TYPES = Object.freeze(Object.keys(RESOURCE_TYPE_POLICY));

// Types a registry unit may own (and the homepage catalog may render).
// These fix the manifest `resourceCountsByType` keys and order.
const UNIT_RESOURCE_TYPES = Object.freeze(
  RESOURCE_TYPES.filter((t) => RESOURCE_TYPE_POLICY[t].placement === "unit"),
);

// Types that live in the registry's top-level `sharedResources`.
const SHARED_RESOURCE_TYPES = Object.freeze(
  RESOURCE_TYPES.filter((t) => RESOURCE_TYPE_POLICY[t].placement === "shared"),
);

// Canonical ulink resource-type classes -> internal type identifiers.
// Every anchor inside `.unit-links` must map to one of these.
const RESOURCE_TYPE_BY_ULINK_CLASS = Object.freeze(
  Object.fromEntries(UNIT_RESOURCE_TYPES.map((t) => [RESOURCE_TYPE_POLICY[t].ulinkClass, t])),
);

// Filename prefix expected for each resource type. Used to detect
// href/type disagreements the extractor must not silently accept.
const HREF_PREFIX_BY_TYPE = Object.freeze(
  Object.fromEntries(RESOURCE_TYPES.map((t) => [t, RESOURCE_TYPE_POLICY[t].filenamePrefix])),
);

// ---------------------------------------------------------------------
// String scanning helpers.
// ---------------------------------------------------------------------

function fail(message) {
  throw new Error(`[curriculum-parser] ${message}`);
}

// Find the end index of the `<div>` element whose opening `<` sits at
// `openStart`. Returns the index of the character immediately after the
// matching `</div>`. Balances by counting `<div` / `</div>` occurrences
// in the intervening slice, ignoring HTML comments and self-closing
// tags (of which there are none in the canonical markup).
function findMatchingDivEnd(html, openStart) {
  // openStart points at "<div"; walk forward past its opening ">".
  const openTagEnd = html.indexOf(">", openStart);
  if (openTagEnd === -1) fail("unterminated <div opening tag");
  let depth = 1;
  const openRe = /<div\b/gi;
  const closeRe = /<\/div\s*>/gi;
  openRe.lastIndex = openTagEnd + 1;
  closeRe.lastIndex = openTagEnd + 1;
  while (depth > 0) {
    const openMatch = openRe.exec(html);
    const closeMatch = closeRe.exec(html);
    if (!closeMatch) fail("unterminated <div> block (no matching </div>)");
    if (openMatch && openMatch.index < closeMatch.index) {
      depth += 1;
      closeRe.lastIndex = openMatch.index + 1;
    } else {
      depth -= 1;
      if (depth === 0) return closeMatch.index + closeMatch[0].length;
      openRe.lastIndex = closeMatch.index + closeMatch[0].length;
      closeRe.lastIndex = closeMatch.index + closeMatch[0].length;
    }
  }
  fail("unreachable: div depth did not resolve");
  return -1;
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function collapseWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

function extractSimpleDivText(html, className) {
  const re = new RegExp(
    `<div class="${className}">([\\s\\S]*?)</div>`,
    "g",
  );
  const match = re.exec(html);
  if (!match) return null;
  const stripped = match[1].replace(/<[^>]+>/g, "");
  return collapseWhitespace(decodeEntities(stripped));
}

function extractAttribute(openingTag, attribute) {
  const re = new RegExp(`\\b${attribute}="([^"]*)"`);
  const match = openingTag.match(re);
  return match ? match[1] : null;
}

// Extract the raw opening tag string starting at index `at` (`<div ...>`).
function openingTagAt(html, at) {
  const gt = html.indexOf(">", at);
  if (gt === -1) fail("unterminated opening tag");
  return html.slice(at, gt + 1);
}

// ---------------------------------------------------------------------
// Structural parsing.
// ---------------------------------------------------------------------

function extractTopicGroups(html) {
  const groups = [];
  const openRe = /<div\s+class="topic-group([^"]*)"\s+data-group="([^"]+)"[^>]*>/g;
  let match;
  while ((match = openRe.exec(html))) {
    const classSuffix = match[1];
    const group = match[2];
    const gated = /\bpsych-locked\b/.test(classSuffix);
    const openStart = match.index;
    const end = findMatchingDivEnd(html, openStart);
    groups.push({
      topic: group,
      gated,
      html: html.slice(openStart, end),
    });
    openRe.lastIndex = end;
  }
  if (groups.length === 0) fail("no topic-group elements found in index.html");
  return groups;
}

function extractSubjectBlocks(topicGroupHtml, expectedTopic) {
  const blocks = [];
  const openRe = /<div\s+class="subject-block[^"]*"\s+data-topic="([^"]+)"\s+data-grades="([^"]+)"[^>]*>/g;
  let match;
  while ((match = openRe.exec(topicGroupHtml))) {
    const topic = match[1];
    const grades = match[2];
    if (topic !== expectedTopic) {
      fail(
        `subject-block data-topic "${topic}" does not match enclosing topic-group data-group "${expectedTopic}"`,
      );
    }
    if (!/^[6-8](,[6-8])*$/.test(grades)) {
      fail(`invalid data-grades value "${grades}" on subject-block`);
    }
    const openStart = match.index;
    const end = findMatchingDivEnd(topicGroupHtml, openStart);
    blocks.push({
      topic,
      grades,
      html: topicGroupHtml.slice(openStart, end),
    });
    openRe.lastIndex = end;
  }
  return blocks;
}

function extractUnitCards(subjectBlockHtml) {
  const cards = [];
  const openRe = /<div\s+class="unit-card(?:\s+[^"]*)?"([^>]*)>/g;
  let match;
  while ((match = openRe.exec(subjectBlockHtml))) {
    const openingTagAttrs = match[1];
    const openStart = match.index;
    const end = findMatchingDivEnd(subjectBlockHtml, openStart);
    const cardHtml = subjectBlockHtml.slice(openStart, end);
    const idMatch = openingTagAttrs.match(/\bid="unit-([a-z0-9-]+)"/);
    cards.push({
      idSlug: idMatch ? idMatch[1] : null,
      html: cardHtml,
    });
    openRe.lastIndex = end;
  }
  return cards;
}

function extractLinksBlock(cardHtml) {
  const openRe = /<div\s+class="unit-links"[^>]*>/;
  const openMatch = cardHtml.match(openRe);
  if (!openMatch) fail("unit-card missing <div class=\"unit-links\"> block");
  const openStart = openMatch.index;
  const end = findMatchingDivEnd(cardHtml, openStart);
  return cardHtml.slice(openStart, end);
}

function extractResources(linksHtml) {
  const resources = [];
  const anchorRe = /<a\s+href="([^"]+)"\s+class="ulink\s+([a-z-]+)(?:\s+[^"]*)?"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  let order = 0;
  while ((match = anchorRe.exec(linksHtml))) {
    const href = match[1];
    const ulinkClass = match[2];
    const label = collapseWhitespace(decodeEntities(match[3].replace(/<[^>]+>/g, "")));
    if (/\blegend-pill\b/.test(match[0])) continue;
    const type = RESOURCE_TYPE_BY_ULINK_CLASS[ulinkClass];
    if (!type) fail(`unrecognized ulink resource class "${ulinkClass}"`);
    if (!/^[a-z][a-z0-9_-]*\.html$/.test(href)) {
      fail(`unexpected canonical curriculum href "${href}" (must be a bare filename)`);
    }
    const expectedPrefix = HREF_PREFIX_BY_TYPE[type];
    if (!href.startsWith(expectedPrefix)) {
      fail(
        `resource href "${href}" does not match its declared type "${type}" (expected prefix "${expectedPrefix}")`,
      );
    }
    resources.push({
      type,
      href: `/${href}`,
      filename: href,
      label,
      displayOrder: order++,
    });
  }
  return resources;
}

function slugFromLessonHref(href) {
  const m = href.match(/^\/lesson_([a-z0-9-]+)\.html$/);
  return m ? m[1] : null;
}

function extractUnit(card, topic, grade, gated, displayOrder) {
  const title = extractSimpleDivText(card.html, "unit-name");
  if (!title) fail("unit-card missing <div class=\"unit-name\">");
  const description = extractSimpleDivText(card.html, "unit-desc");
  if (!description) fail(`unit-card "${title}" missing <div class="unit-desc">`);
  const linksHtml = extractLinksBlock(card.html);
  const resources = extractResources(linksHtml);
  let slug = card.idSlug;
  if (!slug) {
    const lesson = resources.find((r) => r.type === "lesson");
    if (lesson) {
      const derived = slugFromLessonHref(lesson.href);
      if (!derived) {
        fail(`unable to derive slug from lesson href "${lesson.href}"`);
      }
      slug = derived;
    } else {
      // Cards with no id and no lesson are placeholders (gated topic
      // "coming soon" entries). Skip them; they are documented as
      // unsurfaced. Only allow this in gated topics.
      if (!gated) {
        fail(
          `non-gated unit-card "${title}" has no id and no lesson resource; slug cannot be derived`,
        );
      }
      return null;
    }
  }
  if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
    fail(`invalid slug "${slug}" on unit "${title}"`);
  }
  return {
    slug,
    title,
    description,
    grade,
    topic,
    gated,
    displayOrder,
    resources,
  };
}

// ---------------------------------------------------------------------
// Manifest construction.
// ---------------------------------------------------------------------

function parseCurriculumFromIndexHtml(indexHtml) {
  const topicGroups = extractTopicGroups(indexHtml);
  const seenTopics = new Set();
  const seenSlugs = new Map();
  const seenHrefs = new Map();
  const orphanUnits = [];
  const outGroups = [];
  let topicDisplayOrder = 0;
  let globalUnitOrder = 0;
  for (const tg of topicGroups) {
    if (!TOPIC_ORDER.includes(tg.topic)) {
      fail(`unknown canonical topic "${tg.topic}"`);
    }
    if (seenTopics.has(tg.topic)) fail(`duplicate topic-group "${tg.topic}"`);
    seenTopics.add(tg.topic);
    const subjectBlocks = extractSubjectBlocks(tg.html, tg.topic);
    if (subjectBlocks.length === 0) {
      fail(`topic-group "${tg.topic}" has no subject-block children`);
    }
    const units = [];
    for (const sb of subjectBlocks) {
      const grades = sb.grades.split(",");
      if (grades.length !== 1) {
        fail(
          `subject-block for "${sb.topic}" declares multiple grades "${sb.grades}"; multi-grade blocks are not yet supported by the canonical index`,
        );
      }
      const grade = grades[0];
      const cards = extractUnitCards(sb.html);
      if (cards.length === 0) {
        fail(`subject-block ${sb.topic}/${sb.grades} contains no unit-card entries`);
      }
      let inBlockOrder = 0;
      for (const card of cards) {
        const unit = extractUnit(card, sb.topic, grade, tg.gated, globalUnitOrder);
        if (!unit) {
          orphanUnits.push({
            topic: sb.topic,
            grade,
            gated: tg.gated,
          });
          continue;
        }
        if (seenSlugs.has(unit.slug)) {
          fail(
            `duplicate unit slug "${unit.slug}" (also in ${seenSlugs.get(unit.slug)})`,
          );
        }
        seenSlugs.set(unit.slug, `${unit.topic}/${unit.grade}`);
        for (const r of unit.resources) {
          if (seenHrefs.has(r.href)) {
            fail(
              `duplicate resource href "${r.href}" (also on ${seenHrefs.get(r.href)})`,
            );
          }
          seenHrefs.set(r.href, unit.slug);
        }
        unit.displayOrder = globalUnitOrder;
        unit.inGroupOrder = inBlockOrder++;
        units.push(unit);
        globalUnitOrder++;
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

  // Compute totals for the manifest header.
  const totals = summarize(outGroups);

  return {
    topicGroups: outGroups,
    orphanUnits,
    totals,
  };
}

function summarize(topicGroups) {
  const byType = Object.fromEntries(UNIT_RESOURCE_TYPES.map((t) => [t, 0]));
  const byGrade = {};
  const byTopic = {};
  const byTopicAndGrade = {};
  let unitCount = 0;
  let gatedUnitCount = 0;
  for (const g of topicGroups) {
    byTopic[g.topic] = byTopic[g.topic] || 0;
    for (const u of g.units) {
      unitCount += 1;
      if (u.gated) gatedUnitCount += 1;
      byGrade[u.grade] = (byGrade[u.grade] || 0) + 1;
      byTopic[u.topic] += 1;
      const key = `${u.topic}/${u.grade}`;
      byTopicAndGrade[key] = (byTopicAndGrade[key] || 0) + 1;
      for (const r of u.resources) byType[r.type] += 1;
    }
  }
  return {
    unitCount,
    gatedUnitCount,
    resourceCountsByType: byType,
    unitsByGrade: byGrade,
    unitsByTopic: byTopic,
    unitsByTopicAndGrade: byTopicAndGrade,
  };
}

function readRootIndexHtml() {
  const p = path.resolve(__dirname, ROOT_INDEX_RELATIVE);
  return fs.readFileSync(p, "utf8");
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

module.exports = {
  ROOT_INDEX_RELATIVE,
  TOPIC_ORDER,
  TOPIC_LABELS,
  RESOURCE_TYPE_POLICY_RELATIVE_TO_APP,
  RESOURCE_TYPE_POLICY,
  RESOURCE_TYPES,
  UNIT_RESOURCE_TYPES,
  SHARED_RESOURCE_TYPES,
  RESOURCE_TYPE_BY_ULINK_CLASS,
  HREF_PREFIX_BY_TYPE,
  parseCurriculumFromIndexHtml,
  readRootIndexHtml,
  sha256,
  summarize,
};
