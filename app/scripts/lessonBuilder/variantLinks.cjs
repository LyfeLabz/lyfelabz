/*
 * Same-origin reference relocation for authored presentation variants
 * (F5.2 S5.2 output addressing, Slice 2 tooling).
 *
 * A canonical v2 lesson is served from /app/lessons/ and uses relative
 * references (`index.html`, `lesson_<slug>.html`, `favicon.ico`, ...) that
 * resolve against that directory. A presentation variant of the same lesson
 * is served one level deeper, from /app/lessons/variants/, where the same
 * relative references would resolve to files that do not exist (and the
 * curated Hosting artifact builder would refuse the deploy).
 *
 * relocateHtml() rewrites every relative same-origin reference to the
 * absolute path it resolves to from the canonical directory, so a variant
 * reaches exactly the same targets the canonical lesson does. It never
 * touches:
 *   - in-page fragments (`#quiz`), query-only references, empty values;
 *   - absolute paths (`/assets/...`), protocol-relative (`//host`), or any
 *     scheme (`https:`, `mailto:`, `data:`, `javascript:` ...).
 *
 * A `<base>` element would also relocate references, but it would break
 * every in-page `#section` anchor, so it is refused rather than used.
 *
 * Script bodies are never rewritten: rewriting JavaScript is not safe to do
 * textually. Instead, a script body that appears to carry a relative URL is
 * a hard failure, so an unsupported lesson stops instead of shipping a
 * variant whose script navigates to a missing page. Comments are left
 * byte-for-byte.
 *
 * The same function is applied to the canonical v2 bytes before any
 * canonical-versus-variant comparison, so "identical" always means
 * "identical after the same relocation".
 */

"use strict";

const path = require("path");

const CANONICAL_BASE_DIR = "/app/lessons/";

// Attributes whose value is a single URL. `srcset` (a candidate list) and
// `@import` are refused below rather than half-supported.
const URL_ATTRIBUTES = [
  "href",
  "src",
  "action",
  "formaction",
  "poster",
  "data",
  "background",
  "cite",
  "longdesc",
  "xlink:href",
];

const ATTR_RE = new RegExp(
  `(\\s)(${URL_ATTRIBUTES.map((a) => a.replace(":", "\\:")).join("|")})(\\s*=\\s*)("([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
  "gi",
);
const CSS_URL_RE = /url\(\s*(["']?)([^"')]*?)\1\s*\)/gi;
const RELATIVE_ASSET_LITERAL_RE =
  /^[^:/#?\s][^\s]*\.(?:html?|png|jpe?g|gif|svg|webp|ico|css|m?js|json|mp3|mp4|wav|webm|pdf)(?:[?#][^\s]*)?$/i;
const SCRIPT_ATTR_RE = /(?:src|href)\s*=\s*\\?["']([^"'\\]+)\\?["']/gi;
const STRING_LITERAL_RE = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;

function fail(message) {
  throw new Error(`[variant-links] ${message}`);
}

// True when a reference must be relocated: a same-origin relative path.
function isRelativeReference(raw) {
  const ref = raw.trim();
  if (ref.length === 0) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return false; // any scheme
  if (ref.startsWith("//") || ref.startsWith("/")) return false; // absolute
  if (ref.startsWith("#") || ref.startsWith("?")) return false; // same document
  return true;
}

// Resolve a relative reference against the canonical directory, keeping
// its query and fragment exactly.
function relocateReference(raw, baseDir = CANONICAL_BASE_DIR) {
  if (!isRelativeReference(raw)) return raw;
  const ref = raw.trim();
  const cut = ref.search(/[?#]/);
  const pathPart = cut === -1 ? ref : ref.slice(0, cut);
  const suffix = cut === -1 ? "" : ref.slice(cut);
  let resolved = path.posix.normalize(path.posix.join(baseDir, pathPart));
  if (pathPart.endsWith("/") && !resolved.endsWith("/")) resolved += "/";
  if (!resolved.startsWith("/")) fail(`reference did not resolve to an absolute path: ${raw}`);
  return resolved + suffix;
}

function relocateCss(css, where, rewritten) {
  if (/@import\s+(?:url\(\s*)?["']?(?![a-z][a-z0-9+.-]*:|\/)/i.test(css)) {
    fail(`${where}: relative @import cannot be relocated`);
  }
  return css.replace(CSS_URL_RE, (whole, quote, ref) => {
    if (!isRelativeReference(ref)) return whole;
    const next = relocateReference(ref);
    rewritten.push({ from: ref, to: next });
    return `url(${quote}${next}${quote})`;
  });
}

function relocateTag(tag, rewritten) {
  if (/^<base\b/i.test(tag)) fail("a <base> element is not supported in a relocatable lesson");
  const srcset = tag.match(/\ssrcset\s*=\s*("([^"]*)"|'([^']*)')/i);
  if (srcset) {
    const value = srcset[2] !== undefined ? srcset[2] : srcset[3];
    const candidates = value.split(",").map((c) => c.trim().split(/\s+/)[0]);
    if (candidates.some(isRelativeReference)) fail(`srcset with relative candidates cannot be relocated: ${value}`);
  }
  let out = tag.replace(ATTR_RE, (whole, lead, name, eq, _v, dq, sq, bare) => {
    const value = dq !== undefined ? dq : sq !== undefined ? sq : bare;
    if (!isRelativeReference(value)) return whole;
    const next = relocateReference(value);
    rewritten.push({ from: value, to: next });
    const quoted = dq !== undefined ? `"${next}"` : sq !== undefined ? `'${next}'` : next;
    return `${lead}${name}${eq}${quoted}`;
  });
  out = out.replace(/(\sstyle\s*=\s*)("([^"]*)"|'([^']*)')/i, (whole, lead, _v, dq, sq) => {
    const css = dq !== undefined ? dq : sq;
    const next = relocateCss(css, "style attribute", rewritten);
    return dq !== undefined ? `${lead}"${next}"` : `${lead}'${next}'`;
  });
  return out;
}

// Refuse a script body that appears to reference a relative URL. The
// check is deliberately broad: a false positive stops the build with a
// clear message; a false negative would ship a broken navigation.
function assertScriptRelocatable(body, index) {
  SCRIPT_ATTR_RE.lastIndex = 0;
  let m;
  while ((m = SCRIPT_ATTR_RE.exec(body)) !== null) {
    if (isRelativeReference(m[1])) {
      fail(`script block ${index} contains a relative URL attribute (${m[1]}); scripts are never rewritten`);
    }
  }
  STRING_LITERAL_RE.lastIndex = 0;
  while ((m = STRING_LITERAL_RE.exec(body)) !== null) {
    const literal = m[2];
    if (RELATIVE_ASSET_LITERAL_RE.test(literal) && isRelativeReference(literal)) {
      fail(`script block ${index} contains a relative URL literal (${literal}); scripts are never rewritten`);
    }
  }
}

// Rewrite every relative same-origin reference in `html` to the absolute
// path it resolves to from the canonical /app/lessons/ directory. Returns
// { html, rewritten: [{from, to}] } in document order.
function relocateHtml(html) {
  if (typeof html !== "string") fail("html must be a string");
  const rewritten = [];
  let out = "";
  let i = 0;
  let scriptIndex = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      if (end === -1) fail("unterminated HTML comment");
      out += html.slice(lt, end + 3);
      i = end + 3;
      continue;
    }
    const tagMatch = /^<\/?([A-Za-z][A-Za-z0-9:-]*)/.exec(html.slice(lt, lt + 64));
    if (!tagMatch) {
      out += "<";
      i = lt + 1;
      continue;
    }
    const tagEnd = findTagEnd(html, lt);
    const tag = html.slice(lt, tagEnd);
    const name = tagMatch[1].toLowerCase();
    const isClose = tag.startsWith("</");
    out += isClose ? tag : relocateTag(tag, rewritten);
    i = tagEnd;
    if (!isClose && (name === "script" || name === "style")) {
      const closeRe = new RegExp(`</${name}\\s*>`, "i");
      const rest = html.slice(i);
      const cm = closeRe.exec(rest);
      if (!cm) fail(`unterminated <${name}> block`);
      const body = rest.slice(0, cm.index);
      if (name === "script") {
        assertScriptRelocatable(body, scriptIndex);
        scriptIndex += 1;
        out += body;
      } else {
        out += relocateCss(body, "style block", rewritten);
      }
      out += cm[0];
      i += cm.index + cm[0].length;
    }
  }
  return { html: out, rewritten };
}

// Index just past the `>` closing the tag that starts at `start`,
// respecting quoted attribute values that may contain `>`.
function findTagEnd(html, start) {
  let quote = null;
  for (let j = start + 1; j < html.length; j++) {
    const ch = html[j];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return j + 1;
    }
  }
  fail(`unterminated tag at offset ${start}`);
  return html.length;
}

// Every relative same-origin reference still present in markup or CSS
// (script bodies are covered by assertScriptRelocatable). Used as a
// post-condition: a relocated document must return [].
function findRelativeReferences(html) {
  const found = [];
  const probe = relocateHtml(html);
  for (const r of probe.rewritten) found.push(r.from);
  return found;
}

module.exports = {
  CANONICAL_BASE_DIR,
  isRelativeReference,
  relocateReference,
  relocateHtml,
  findRelativeReferences,
  findTagEnd,
};
