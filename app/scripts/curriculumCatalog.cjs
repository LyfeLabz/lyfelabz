/*
 * LyfeLabz homepage curriculum catalog renderer.
 *
 * Renders the "Choose Your Lab" topic groups in the root `index.html`
 * from the canonical curriculum registry. The registry owns the
 * curriculum (topics, gating, grade blocks, units, resources, order);
 * this module owns only the static presentation the registry does not
 * describe (topic icon and color class, scroll-anchor spans, comments).
 *
 * The rendered markup lives between the GENERATED CURRICULUM CATALOG
 * markers in `index.html`. Everything outside the markers (heading,
 * pill legend, filters, empty-state message, scripts) stays
 * hand-authored. `build-curriculum-manifest.cjs` writes and checks the
 * region. Both Hosting builders publish the committed `index.html` bytes
 * unchanged and call `assertCatalogCurrent` first, so a release fails
 * instead of shipping a catalog that disagrees with the registry.
 *
 * Output is deterministic. This module has no external dependencies.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const {
  TOPIC_LABELS,
  RESOURCE_TYPE_BY_ULINK_CLASS,
} = require("./curriculumParser.cjs");
const { parseRegistryText, readRegistryText } = require("./curriculumRegistry.cjs");

const ROOT_INDEX_PATH = path.resolve(__dirname, "..", "..", "index.html");

const BEGIN_MARKER =
  "<!-- BEGIN GENERATED CURRICULUM CATALOG: edit app/src/curriculum/curriculum.registry.json, then run `npm --prefix app run curriculum:build`. -->";
const END_MARKER = "<!-- END GENERATED CURRICULUM CATALOG -->";

// Static presentation per canonical topic. `anchorsByGrade` are the
// legacy in-page scroll targets (#bio, #geo, ...) placed before a grade
// block. Adding a topic here does not add curriculum; the registry does.
const TOPIC_PRESENTATION = Object.freeze({
  "life-science": { className: "tg-life", icon: "🌱", anchorsByGrade: { 6: ["bio"] } },
  "earth-space": { className: "tg-earth", icon: "🌍", anchorsByGrade: { 6: ["geo"] } },
  "physical-science": { className: "tg-physical", icon: "⚡", anchorsByGrade: { 6: ["chem"] } },
  "tech-engineering": { className: "tg-tech", icon: "🔧", anchorsByGrade: { 6: ["sci", "eng"] } },
  "behavioral-science": { className: "tg-psych", icon: "🧠", anchorsByGrade: { 6: ["psych"] } },
});

const ULINK_CLASS_BY_TYPE = Object.freeze(
  Object.fromEntries(
    Object.entries(RESOURCE_TYPE_BY_ULINK_CLASS).map(([cls, type]) => [type, cls]),
  ),
);

const BANNER_WIDTH = 53;

function fail(message) {
  throw new Error(`[curriculum-catalog] ${message}`);
}

function escapeText(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function anchorSpan(id) {
  return `<span id="${id}" style="display:block; position:relative; top:-80px; visibility:hidden;"></span>`;
}

function unitCardLines(id, title, description, resources) {
  const open = id ? `<div class="unit-card" id="unit-${id}">` : `<div class="unit-card">`;
  const lines = [
    open,
    `  <div class="unit-top">`,
    `    <div class="unit-name">${escapeText(title)}</div>`,
    `    <div class="unit-desc">${escapeText(description)}</div>`,
    `  </div>`,
  ];
  if (resources.length === 0) {
    lines.push(`  <div class="unit-links"></div>`);
  } else {
    lines.push(`  <div class="unit-links">`);
    for (const r of resources) {
      const cls = ULINK_CLASS_BY_TYPE[r.type];
      if (!cls) fail(`no ulink class for resource type "${r.type}"`);
      lines.push(`    <a href="${r.filename}" class="ulink ${cls}">${escapeText(r.label)}</a>`);
    }
    lines.push(`  </div>`);
  }
  lines.push(`</div>`);
  return lines;
}

function indent(lines, spaces) {
  const pad = " ".repeat(spaces);
  return lines.map((line) => (line === "" ? "" : pad + line));
}

// Render the catalog region (without markers) from registry JSON text.
// The registry is fully validated first, so only canonical curriculum
// can reach the homepage.
function renderCatalog(registryText = readRegistryText()) {
  parseRegistryText(registryText);
  const registry = JSON.parse(registryText);
  const out = [];
  registry.topicGroups.forEach((tg, groupIndex) => {
    const presentation = TOPIC_PRESENTATION[tg.topic];
    if (!presentation) fail(`no homepage presentation for topic "${tg.topic}"`);
    const label = TOPIC_LABELS[tg.topic];
    const bannerText = `TOPIC GROUP: ${label.toUpperCase()} `;
    const banner = `<!-- ─── ${bannerText}${"─".repeat(Math.max(3, BANNER_WIDTH - bannerText.length))} -->`;
    const groupClass = `topic-group ${presentation.className}${tg.gated ? " psych-locked" : ""}`;

    if (groupIndex > 0) out.push("");
    out.push(
      banner,
      `<div class="${groupClass}" data-group="${tg.topic}">`,
      `  <div class="topic-group-divider">`,
      `    <span class="topic-group-icon">${presentation.icon}</span>`,
      `    <span class="topic-group-name">${escapeText(label)}</span>`,
      `  </div>`,
    );

    for (const block of tg.gradeBlocks) {
      const cards = [];
      for (const u of block.units) {
        // Gated (unreleased) topic cards carry no unit id anchor.
        cards.push(...unitCardLines(tg.gated ? null : u.slug, u.title, u.description, u.resources));
      }
      for (const p of block.placeholderUnits || []) {
        cards.push(...unitCardLines(null, p.title, p.description, []));
      }
      out.push(
        "",
        `  <!-- ${label} - Grade ${block.grade} -->`,
        ...indent((presentation.anchorsByGrade[block.grade] || []).map(anchorSpan), 2),
        `  <div class="subject-block" data-topic="${tg.topic}" data-grades="${block.grade}">`,
        `    <div class="unit-row">`,
        ...indent(cards, 6),
        `    </div>`,
        `  </div>`,
      );
    }

    out.push("", `</div><!-- /${presentation.className} -->`);
  });
  return `${indent(out, 4).join("\n")}\n`;
}

function locateRegion(html) {
  const begin = html.indexOf(BEGIN_MARKER);
  const end = html.indexOf(END_MARKER);
  if (begin === -1 || end === -1) fail("index.html is missing the GENERATED CURRICULUM CATALOG markers");
  if (html.indexOf(BEGIN_MARKER, begin + 1) !== -1 || html.indexOf(END_MARKER, end + 1) !== -1) {
    fail("index.html contains duplicate GENERATED CURRICULUM CATALOG markers");
  }
  const contentStart = html.indexOf("\n", begin) + 1;
  const contentEnd = html.lastIndexOf("\n", end) + 1;
  if (contentStart === 0 || contentStart > contentEnd) {
    fail("GENERATED CURRICULUM CATALOG markers must each sit on their own line, BEGIN before END");
  }
  return { contentStart, contentEnd };
}

// Current generated region (between the marker lines) of an index.html.
function extractCatalog(html) {
  const { contentStart, contentEnd } = locateRegion(html);
  return html.slice(contentStart, contentEnd);
}

// Replace the generated region of an index.html with `catalog`.
function spliceCatalog(html, catalog = renderCatalog()) {
  const { contentStart, contentEnd } = locateRegion(html);
  return html.slice(0, contentStart) + catalog + html.slice(contentEnd);
}

function readRootIndexHtml() {
  return fs.readFileSync(ROOT_INDEX_PATH, "utf8");
}

// Throws unless the generated region of `html` (the committed root
// index.html by default) is exactly what the registry renders. Hosting
// builds call this and then copy the committed bytes; they never regenerate.
function assertCatalogCurrent(html = readRootIndexHtml()) {
  if (extractCatalog(html) !== renderCatalog()) {
    fail(
      "DRIFT: the generated curriculum catalog in root index.html does not match the curriculum registry. " +
        "Edit the registry, not index.html, and regenerate with `npm --prefix app run curriculum:build`.",
    );
  }
}

module.exports = {
  BEGIN_MARKER,
  END_MARKER,
  ROOT_INDEX_PATH,
  TOPIC_PRESENTATION,
  renderCatalog,
  extractCatalog,
  spliceCatalog,
  readRootIndexHtml,
  assertCatalogCurrent,
};
