/*
 * Canonical-versus-variant invariance gate for authored presentation
 * variants (F5.2 S5.2, Slice 2 tooling).
 *
 * A presentation variant is the SAME lesson with the same instructional
 * contract; only explicitly adaptable prose may differ. This module proves
 * that, comparing the canonical v2 build and the variant v2 build after the
 * same relocation (variantLinks.relocateHtml) and with each file's
 * generated notice removed:
 *
 *   1. Outside the declared adaptable sections the two documents are
 *      byte-identical (head, title, canonical link, vocabulary, quiz,
 *      More Learning, Connections, every non-adaptable section).
 *   2. Every <script> and <style> block is byte-identical, in order.
 *   3. Inside each adaptable section, the LOCKED SKELETON is identical:
 *      every element, attribute, raw block (script/style/svg/comment) and
 *      text node outside an adaptable container, in order. Each run of
 *      adjacent adaptable containers collapses to one placeholder, so an
 *      author may split, merge or re-list prose but may not add, drop,
 *      reorder or edit anything locked.
 *   4. Inside adaptable containers the variant may use only inline prose
 *      tags (strong, em, b, i, br, sup, sub) or an exact tag+attribute form
 *      already used inside canonical adaptable content (for example the
 *      existing `<span class="vocab">`). No raw blocks, comments, or new
 *      styling. Adaptable container open tags must reuse a canonical
 *      container form exactly.
 *   5. The multiset of element ids is identical.
 *   6. No disclosure term appears more often in the variant than in the
 *      canonical lesson (a variant must never say it is adapted). A default
 *      term that is one of the lesson's own glossary terms is exempt.
 *
 * Adaptable containers are declared per lesson with a minimal selector
 * grammar (`tag`, `.class`, `tag.class`); locked selectors take precedence
 * and lock their whole subtree. A container that would be adaptable but
 * has a locked descendant is not adaptable: it stays in the skeleton, so
 * its locked subtree (and its own text) is compared exactly, while any
 * adaptable element inside it elsewhere remains adaptable. Nothing is
 * adaptable unless declared.
 */

"use strict";

const { findTagEnd } = require("./variantLinks.cjs");
const equivalence = require("./equivalence.cjs");

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
]);
const RAW_TAGS = new Set(["script", "style", "svg", "textarea", "template"]);
const INLINE_PROSE_TAGS = new Set(["strong", "em", "b", "i", "br", "sup", "sub"]);
const SELECTOR_RE = /^([a-z][a-z0-9]*)?(?:\.([A-Za-z0-9_-]+))?$/;

// Terms whose appearance in a delivered artifact would disclose that a
// student receives an adapted presentation. Compared as counts: the
// variant may not contain any term MORE often than the canonical lesson,
// so a science lesson that legitimately uses a word keeps working.
const DEFAULT_DISCLOSURE_TERMS = [
  /reading[\s_-]*adapted/gi,
  /adapted\s+(?:version|lesson|presentation|reading)/gi,
  /reading\s+(?:level|support|accessibility|accommodation)/gi,
  /readingaccessibility/gi,
  /simplified/gi,
  /(?:easier|simpler)\s+version/gi,
  /accommodat/gi,
  /\biep\b/gi,
  /\b504\s+plan/gi,
  /differentiat/gi,
  /\bvariant/gi,
];

function fail(message) {
  throw new Error(`[variant-invariance] ${message}`);
}

function parseSelector(sel) {
  const m = SELECTOR_RE.exec(sel);
  if (!m || (!m[1] && !m[2])) fail(`invalid selector "${sel}" (use tag, .class, or tag.class)`);
  return { tag: m[1] || null, cls: m[2] || null, source: sel };
}

function classListOf(attrs) {
  const m = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
  if (!m) return [];
  return (m[1] !== undefined ? m[1] : m[2]).split(/\s+/).filter(Boolean);
}

function matches(selector, tag, classes) {
  if (selector.tag && selector.tag !== tag) return false;
  if (selector.cls && !classes.includes(selector.cls)) return false;
  return true;
}

function normAttrs(attrs) {
  return attrs.replace(/\s+/g, " ").trim();
}

// Flat token stream. Raw elements (script/style/svg/textarea/template) and
// comments are single opaque tokens so their bytes are compared whole.
function tokenize(html) {
  const tokens = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      tokens.push({ type: "text", value: html.slice(i) });
      break;
    }
    if (lt > i) tokens.push({ type: "text", value: html.slice(i, lt) });
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      if (end === -1) fail("unterminated HTML comment");
      tokens.push({ type: "raw", kind: "comment", value: html.slice(lt, end + 3) });
      i = end + 3;
      continue;
    }
    if (/^<!/i.test(html.slice(lt, lt + 2))) {
      const end = html.indexOf(">", lt);
      tokens.push({ type: "raw", kind: "decl", value: html.slice(lt, end + 1) });
      i = end + 1;
      continue;
    }
    const m = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)/.exec(html.slice(lt, lt + 64));
    if (!m) {
      tokens.push({ type: "text", value: "<" });
      i = lt + 1;
      continue;
    }
    const end = findTagEnd(html, lt);
    const raw = html.slice(lt, end);
    const tag = m[2].toLowerCase();
    if (m[1] === "/") {
      tokens.push({ type: "close", tag, raw });
      i = end;
      continue;
    }
    const attrs = raw.slice(m[0].length, raw.length - 1).replace(/\/\s*$/, "");
    if (RAW_TAGS.has(tag) && !/\/\s*>$/.test(raw)) {
      const closeRe = new RegExp(`</${tag}\\s*>`, "i");
      const rest = html.slice(end);
      const cm = closeRe.exec(rest);
      if (!cm) fail(`unterminated <${tag}> element`);
      const whole = raw + rest.slice(0, cm.index + cm[0].length);
      tokens.push({ type: "raw", kind: tag, value: whole });
      i = end + cm.index + cm[0].length;
      continue;
    }
    const selfClosing = VOID_TAGS.has(tag) || /\/\s*>$/.test(raw);
    tokens.push({ type: "open", tag, attrs, raw, classes: classListOf(attrs), selfClosing });
    i = end;
  }
  return tokens;
}

// Byte range [start, end) of the <section> carrying id="<id>", matching
// nested sections. Returns null when absent.
function findSectionRange(html, id) {
  const re = new RegExp(`<section\\b[^>]*\\bid\\s*=\\s*["']${id.replace(/[-]/g, "\\-")}["'][^>]*>`, "gi");
  const hits = [];
  let m;
  while ((m = re.exec(html)) !== null) hits.push(m.index);
  if (hits.length === 0) return null;
  if (hits.length > 1) fail(`section id "${id}" appears more than once`);
  const start = hits[0];
  const openRe = /<section\b/gi;
  const closeRe = /<\/section\s*>/gi;
  openRe.lastIndex = start + 1;
  closeRe.lastIndex = start + 1;
  let depth = 1;
  for (;;) {
    const o = openRe.exec(html);
    const c = closeRe.exec(html);
    if (!c) fail(`section "${id}" is not closed`);
    if (o && o.index < c.index) {
      depth += 1;
      closeRe.lastIndex = o.index + 1;
    } else {
      depth -= 1;
      if (depth === 0) return { start, end: c.index + c[0].length };
      openRe.lastIndex = c.index + c[0].length;
      closeRe.lastIndex = c.index + c[0].length;
    }
  }
}

// Split a document into alternating outside segments and adaptable
// section bodies, in document order.
function splitSections(html, sectionIds, label) {
  const ranges = sectionIds.map((id) => {
    const r = findSectionRange(html, id);
    if (!r) fail(`${label}: adaptable section "${id}" not found`);
    return { id, ...r };
  });
  ranges.sort((a, b) => a.start - b.start);
  for (let k = 1; k < ranges.length; k++) {
    if (ranges[k].start < ranges[k - 1].end) fail(`${label}: adaptable sections overlap ("${ranges[k - 1].id}", "${ranges[k].id}")`);
  }
  const outside = [];
  const sections = [];
  let cursor = 0;
  for (const r of ranges) {
    outside.push(html.slice(cursor, r.start));
    sections.push({ id: r.id, html: html.slice(r.start, r.end) });
    cursor = r.end;
  }
  outside.push(html.slice(cursor));
  return { outside, sections };
}

// True when the element opened at tokens[i] has a descendant matching a
// locked selector. Such an element is never adaptable: adaptability may
// not swallow a locked subtree (for example the wrap-up chain chips inside
// an otherwise adaptable callout).
function hasLockedDescendant(tokens, i, lockedSelectors) {
  let depth = 0;
  for (let k = i + 1; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type === "open") {
      if (lockedSelectors.some((s) => matches(s, t.tag, t.classes))) return true;
      if (!t.selfClosing) depth += 1;
    } else if (t.type === "close") {
      if (depth === 0) return false;
      depth -= 1;
    }
  }
  return false;
}

// Locked skeleton of one section plus the captured adaptable runs.
function analyzeSection(html, rules, label) {
  const tokens = tokenize(html);
  const skeleton = [];
  const runs = [];
  const stack = []; // { tag, locked, adaptable }
  let capture = null; // tokens inside the current adaptable container

  const pushSkeleton = (item) => skeleton.push(item);
  const lockedAbove = () => stack.some((s) => s.locked);

  for (let ti = 0; ti < tokens.length; ti++) {
    const tok = tokens[ti];
    if (capture) {
      if (tok.type === "open" && !tok.selfClosing) stack.push({ tag: tok.tag, locked: false, adaptable: false });
      if (tok.type === "close") {
        const top = stack.pop();
        if (!top || top.tag !== tok.tag) fail(`${label}: unbalanced </${tok.tag}> inside adaptable content`);
        if (top.adaptable) {
          capture.closeRaw = tok.raw;
          const run = runs[runs.length - 1];
          run.containers.push(capture);
          capture = null;
          continue;
        }
      }
      capture.tokens.push(tok);
      continue;
    }

    if (tok.type === "text") {
      const t = tok.value.replace(/\s+/g, " ").trim();
      if (t.length > 0) pushSkeleton({ k: "text", v: t });
      continue;
    }
    if (tok.type === "raw") {
      pushSkeleton({ k: "raw", v: tok.value });
      continue;
    }
    if (tok.type === "close") {
      const top = stack.pop();
      if (!top || top.tag !== tok.tag) fail(`${label}: unbalanced </${tok.tag}>`);
      pushSkeleton({ k: "close", v: tok.tag });
      continue;
    }
    // open
    const locked = lockedAbove() || rules.locked.some((s) => matches(s, tok.tag, tok.classes));
    const adaptable =
      !locked &&
      !tok.selfClosing &&
      rules.adaptable.some((s) => matches(s, tok.tag, tok.classes)) &&
      !hasLockedDescendant(tokens, ti, rules.locked);
    if (adaptable) {
      const last = skeleton[skeleton.length - 1];
      if (!last || last.k !== "adapt") {
        pushSkeleton({ k: "adapt" });
        runs.push({ containers: [] });
      }
      stack.push({ tag: tok.tag, locked: false, adaptable: true });
      capture = { openTag: tok.tag, openAttrs: normAttrs(tok.attrs), tokens: [] };
      continue;
    }
    pushSkeleton({ k: "open", v: `${tok.tag} ${normAttrs(tok.attrs)}`.trim() });
    if (!tok.selfClosing) stack.push({ tag: tok.tag, locked, adaptable: false });
  }
  if (capture || stack.length > 0) fail(`${label}: unclosed element(s) in section`);
  return { skeleton, runs };
}

function describeItem(item) {
  if (!item) return "(end of section)";
  if (item.k === "adapt") return "[adaptable prose]";
  const v = item.v.length > 120 ? `${item.v.slice(0, 117)}...` : item.v;
  return `${item.k}: ${v}`;
}

function compareSkeletons(canon, variant, sectionId) {
  const n = Math.max(canon.length, variant.length);
  for (let k = 0; k < n; k++) {
    const a = canon[k];
    const b = variant[k];
    const same = a && b && a.k === b.k && a.v === b.v;
    if (!same) {
      fail(
        `section "${sectionId}": locked markup differs at position ${k}\n` +
          `  canonical: ${describeItem(a)}\n  variant:   ${describeItem(b)}`,
      );
    }
  }
}

// Forms (tag + normalized attrs) the author may reuse inside adaptable
// content, and forms allowed for adaptable container open tags, both
// harvested from the canonical document.
function harvestForms(canonAnalyses) {
  const inner = new Set();
  const containers = new Set();
  for (const a of canonAnalyses) {
    for (const run of a.runs) {
      for (const c of run.containers) {
        containers.add(`${c.openTag} ${c.openAttrs}`.trim());
        for (const tok of c.tokens) {
          if (tok.type === "open") inner.add(`${tok.tag} ${normAttrs(tok.attrs)}`.trim());
          if (tok.type === "raw" && tok.kind !== "comment") {
            fail(`canonical adaptable content contains a <${tok.kind}> block; lock that container instead`);
          }
        }
      }
    }
  }
  return { inner, containers };
}

function validateVariantContent(variantAnalyses, forms, sectionIds) {
  variantAnalyses.forEach((a, si) => {
    for (const run of a.runs) {
      // A run may be split, merged or re-worded, but never emptied: prose
      // between two locked elements cannot be silently dropped.
      const text = run.containers
        .flatMap((c) => c.tokens.filter((t) => t.type === "text").map((t) => t.value))
        .join("")
        .replace(/&nbsp;|&#160;/gi, " ")
        .trim();
      if (text.length === 0) fail(`section "${sectionIds[si]}": an adaptable prose run is empty`);
      for (const c of run.containers) {
        const form = `${c.openTag} ${c.openAttrs}`.trim();
        if (!forms.containers.has(form)) {
          fail(`section "${sectionIds[si]}": adaptable container <${form}> is not a form used by the canonical lesson`);
        }
        for (const tok of c.tokens) {
          if (tok.type === "raw") {
            fail(`section "${sectionIds[si]}": adaptable content may not contain ${tok.kind === "comment" ? "comments" : `<${tok.kind}>`}`);
          }
          if (tok.type === "open") {
            const f = `${tok.tag} ${normAttrs(tok.attrs)}`.trim();
            const bareInline = INLINE_PROSE_TAGS.has(tok.tag) && normAttrs(tok.attrs) === "";
            if (!bareInline && !forms.inner.has(f)) {
              fail(`section "${sectionIds[si]}": <${f}> is not allowed in adaptable prose (use inline prose tags or an existing form)`);
            }
          }
        }
      }
    }
  });
}

function extractBlocks(html, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, "gi");
  return html.match(re) || [];
}

function idMultiset(html) {
  const counts = {};
  const re = /\sid\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) counts[m[1]] = (counts[m[1]] || 0) + 1;
  return counts;
}

function countMatches(text, re) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  return (text.match(g) || []).length;
}

// A default term that matches one of the canonical lesson's own glossary
// terms is science vocabulary in that lesson (Earth's Layers teaches
// "Differentiation"), so adapted prose may repeat it. Literal extras (the
// variantKey, the source filename) are never exempt.
function glossaryTerms(canonical) {
  return equivalence.buildContract(canonical).vocabulary.map((v) => v.term).filter(Boolean);
}

function assertNoDisclosure(canonical, variant, extraLiterals) {
  const vocabulary = glossaryTerms(canonical);
  const terms = DEFAULT_DISCLOSURE_TERMS.filter((re) => !vocabulary.some((t) => countMatches(t, re) > 0));
  for (const lit of extraLiterals || []) {
    if (typeof lit === "string" && lit.length > 0) {
      terms.push(new RegExp(lit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"));
    }
  }
  for (const re of terms) {
    const c = countMatches(canonical, re);
    const v = countMatches(variant, re);
    if (v > c) fail(`disclosure term ${re} appears ${v} time(s) in the variant but ${c} in the canonical lesson`);
  }
}

// Deterministic reading statistics over adaptable prose only, for review
// (never a pass/fail gate).
function proseStats(analyses) {
  let text = "";
  for (const a of analyses) {
    for (const run of a.runs) {
      for (const c of run.containers) {
        for (const tok of c.tokens) if (tok.type === "text") text += ` ${tok.value}`;
        text += " \n";
      }
    }
  }
  const plain = text.replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
  const sentences = plain
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => /[a-z]/i.test(s));
  const lengths = sentences.map((s) => s.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length);
  const words = lengths.reduce((x, y) => x + y, 0);
  const over20 = lengths.filter((l) => l > 20).length;
  return {
    words,
    sentences: sentences.length,
    averageSentenceWords: sentences.length ? Math.round((words / sentences.length) * 10) / 10 : 0,
    longestSentenceWords: lengths.length ? Math.max(...lengths) : 0,
    sentencesOver20Words: over20,
  };
}

// Full gate. Both inputs are already relocated and have had their
// generated notices removed. Throws on the first violation; returns
// review statistics on success.
function assertPresentationInvariance({ canonicalHtml, variantHtml, variantConfig, disclosureLiterals }) {
  const sectionIds = variantConfig.adaptableSections;
  const rules = {
    adaptable: variantConfig.adaptableSelectors.map(parseSelector),
    locked: (variantConfig.lockedSelectors || []).map(parseSelector),
  };

  const cScripts = extractBlocks(canonicalHtml, "script");
  const vScripts = extractBlocks(variantHtml, "script");
  const cStyles = extractBlocks(canonicalHtml, "style");
  const vStyles = extractBlocks(variantHtml, "style");
  if (cScripts.length !== vScripts.length || cScripts.some((s, k) => s !== vScripts[k])) {
    fail("script blocks are not byte-identical to the canonical lesson");
  }
  if (cStyles.length !== vStyles.length || cStyles.some((s, k) => s !== vStyles[k])) {
    fail("style blocks are not byte-identical to the canonical lesson");
  }

  const cSplit = splitSections(canonicalHtml, sectionIds, "canonical");
  const vSplit = splitSections(variantHtml, sectionIds, "variant");
  cSplit.sections.forEach((s, k) => {
    if (s.id !== vSplit.sections[k].id) fail(`adaptable sections are reordered (canonical "${s.id}", variant "${vSplit.sections[k].id}")`);
  });
  cSplit.outside.forEach((seg, k) => {
    if (seg !== vSplit.outside[k]) {
      const where = k === 0 ? "before the first adaptable section" : `after section "${cSplit.sections[k - 1].id}"`;
      fail(`markup outside adaptable sections differs (${where})`);
    }
  });

  const cAnalyses = cSplit.sections.map((s) => analyzeSection(s.html, rules, `canonical ${s.id}`));
  const vAnalyses = vSplit.sections.map((s) => analyzeSection(s.html, rules, `variant ${s.id}`));
  cAnalyses.forEach((a, k) => compareSkeletons(a.skeleton, vAnalyses[k].skeleton, cSplit.sections[k].id));

  const forms = harvestForms(cAnalyses);
  validateVariantContent(vAnalyses, forms, cSplit.sections.map((s) => s.id));

  const cIds = idMultiset(canonicalHtml);
  const vIds = idMultiset(variantHtml);
  const idKeys = new Set([...Object.keys(cIds), ...Object.keys(vIds)]);
  for (const id of idKeys) {
    if (cIds[id] !== vIds[id]) fail(`element id "${id}" occurs ${vIds[id] || 0} time(s) in the variant but ${cIds[id] || 0} in the canonical lesson`);
  }

  assertNoDisclosure(canonicalHtml, variantHtml, disclosureLiterals);

  return {
    adaptableRuns: cAnalyses.reduce((n, a) => n + a.runs.length, 0),
    canonicalProse: proseStats(cAnalyses),
    variantProse: proseStats(vAnalyses),
  };
}

module.exports = {
  DEFAULT_DISCLOSURE_TERMS,
  INLINE_PROSE_TAGS,
  parseSelector,
  tokenize,
  findSectionRange,
  analyzeSection,
  assertNoDisclosure,
  assertPresentationInvariance,
};
