/*
 * LyfeLabz canonical curriculum parser (Sprint 6D.0).
 *
 * Reads the root `index.html` treated as the authoritative curriculum
 * inventory (PDR-007, TEACHER_EXPERIENCE_PHILOSOPHY.md §3.9). Returns a
 * deterministic, JSON-serialisable manifest of every unit and resource
 * surfaced by the canonical index.
 *
 * The parser is deliberately strict. It fails loudly rather than
 * silently omitting malformed or unrecognized curriculum markup. This
 * module has no external dependencies; it is required by the manifest
 * build script and by the drift test in `app/src/curriculum`.
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

// Canonical ulink resource-type classes -> internal type identifiers.
// Every anchor inside `.unit-links` must map to one of these.
const RESOURCE_TYPE_BY_ULINK_CLASS = Object.freeze({
  live: "lesson",
  sim: "simulation",
  inv: "investigation",
  ext: "extension",
  chal: "challenge",
  activity: "activity",
  game: "game",
  map: "map",
  dis: "disease",
});

const RESOURCE_TYPES = Object.freeze([
  "lesson",
  "simulation",
  "investigation",
  "extension",
  "challenge",
  "activity",
  "game",
  "map",
  "disease",
]);

// Filename prefix expected for each resource type. Used to detect
// href/type disagreements the extractor must not silently accept.
const HREF_PREFIX_BY_TYPE = Object.freeze({
  lesson: "lesson_",
  simulation: "simulation_",
  investigation: "investigation_",
  extension: "extension_",
  challenge: "challenge_",
  activity: "activity_",
  game: "game_",
  map: "map_",
  disease: "disease_",
});

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
  const byType = Object.fromEntries(RESOURCE_TYPES.map((t) => [t, 0]));
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

function buildManifest() {
  const indexHtml = readRootIndexHtml();
  const parsed = parseCurriculumFromIndexHtml(indexHtml);
  return {
    schemaVersion: 1,
    generated: true,
    generatedBy: "app/scripts/build-curriculum-manifest.cjs",
    canonicalSource: "index.html",
    canonicalSourceRelativeToApp: "../index.html",
    canonicalSourceSha256: sha256(indexHtml),
    doNotEditByHand:
      "This file is generated from the root canonical index.html. Do not edit by hand. Regenerate with `npm run curriculum:build` inside app/.",
    totals: parsed.totals,
    topicGroups: parsed.topicGroups,
    orphanUnits: parsed.orphanUnits,
  };
}

module.exports = {
  ROOT_INDEX_RELATIVE,
  TOPIC_ORDER,
  TOPIC_LABELS,
  RESOURCE_TYPES,
  RESOURCE_TYPE_BY_ULINK_CLASS,
  HREF_PREFIX_BY_TYPE,
  parseCurriculumFromIndexHtml,
  readRootIndexHtml,
  buildManifest,
  sha256,
};
