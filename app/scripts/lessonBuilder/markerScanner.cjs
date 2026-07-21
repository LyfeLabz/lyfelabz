/*
 * Context-aware marker scanner for the lesson builder.
 *
 * The source file is a plain HTML document that hosts inline <script>
 * and <style> blocks. Sprint 18 requires markers to be written in the
 * comment grammar appropriate to their host language:
 *
 *   HTML top level : <!-- LYFELABZ:<TARGET>:<BEGIN|END> <label> -->
 *   script block   : slash-star LYFELABZ:<TARGET>:<BEGIN|END> <label> star-slash
 *   style block    : slash-star LYFELABZ:<TARGET>:<BEGIN|END> <label> star-slash
 *
 * (The slash-star and star-slash tokens are the standard block-comment
 * delimiters; they are spelled out here so this doc comment stays
 * syntactically valid.)
 *
 * Marker lines must be standalone. A valid marker line is:
 *   ^[ \t]*<opener><space>LYFELABZ:...<space><closer>[ \t]*$
 * anything else is not a marker. Marker-like text found outside a valid
 * marker line, or inside a JS string / template / regex literal, or as
 * an HTML comment nested inside a <script> or <style> block, is a hard
 * fail-closed error.
 *
 * Genuine JS comments are extracted through acorn (already installed at
 * app/node_modules/acorn). This satisfies Sprint 18 correction 4:
 * "reuse an already-installed parser" beats a bespoke lexer.
 *
 * CSS uses only the slash-star ... star-slash grammar and never allows
 * nested comment openers, so a bounded string scan is a complete
 * parser for CSS comments in the constrained subset we accept.
 *
 * HTML comments are also grammar-bounded (`<!--` starts, first `-->`
 * closes) so the same treatment applies to HTML top level.
 *
 * Scan output: an array of regions
 *   { context: "html"|"js"|"css", target: "V1-ONLY"|"V2-ONLY", label,
 *     openLine, closeLine, openStart, openEnd, closeStart, closeEnd }
 * where the offsets are byte positions in the ORIGINAL source. Regions
 * do not include the marker lines themselves; the transformer decides
 * whether to strip marker + content together.
 *
 * openLine/closeLine are 0-indexed line numbers into the original
 * source and are included in fail-closed diagnostics so authors can
 * locate the offending marker without a byte-offset calculator.
 */

"use strict";

const acorn = require("acorn");

const MARKER_RE_HTML = /^[ \t]*<!--[ \t]+LYFELABZ:(V1-ONLY|V2-ONLY):(BEGIN|END)[ \t]+([A-Za-z0-9_-]+)[ \t]+-->[ \t]*$/;
const MARKER_RE_BLOCK = /^[ \t]*\/\*[ \t]+LYFELABZ:(V1-ONLY|V2-ONLY):(BEGIN|END)[ \t]+([A-Za-z0-9_-]+)[ \t]+\*\/[ \t]*$/;
const SUSPICIOUS_SUBSTRING = "LYFELABZ:";

function fail(message) {
  throw new Error(`[lesson-marker-scanner] ${message}`);
}

function lineNumberAt(text, offset) {
  let n = 0;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function lineStartAt(text, offset) {
  let i = offset;
  while (i > 0 && text.charCodeAt(i - 1) !== 10) i--;
  return i;
}

function lineEndAt(text, offset) {
  let i = offset;
  while (i < text.length && text.charCodeAt(i) !== 10) i++;
  return i;
}

function fullLineAt(text, offset) {
  const start = lineStartAt(text, offset);
  const end = lineEndAt(text, offset);
  return { start, end, text: text.slice(start, end) };
}

// -------------------------------------------------------------------
// Segment splitting.
// The HTML source is split into an ordered sequence of segments so we
// know which comment grammar applies at every byte. Segments never
// overlap and cover the entire file.
// -------------------------------------------------------------------

function splitSegments(source) {
  const segments = [];
  const openRe = /<(script|style)\b[^>]*>/gi;
  let cursor = 0;
  let m;
  while ((m = openRe.exec(source)) !== null) {
    const openStart = m.index;
    const bodyStart = openRe.lastIndex;
    if (cursor < openStart) {
      segments.push({
        context: "html",
        start: cursor,
        end: openStart,
        text: source.slice(cursor, openStart),
      });
    }
    // The opening tag itself is part of the html-context prelude for
    // diagnostics but has no marker content; we place it in the html
    // segment above. If the opener sits at cursor==openStart we still
    // need to skip past the opening tag to the body.
    const tagName = m[1].toLowerCase();
    const closeTag = `</${tagName}`;
    const closeIdx = source.toLowerCase().indexOf(closeTag, bodyStart);
    if (closeIdx === -1) {
      fail(`unterminated <${tagName}> block starting at line ${lineNumberAt(source, openStart) + 1}`);
    }
    // Record the opening-tag bytes as a separate html-context segment
    // so the marker scanner never sees the tag as JS/CSS text.
    segments.push({
      context: "html-tag",
      start: openStart,
      end: bodyStart,
      text: source.slice(openStart, bodyStart),
    });
    segments.push({
      context: tagName === "script" ? "js" : "css",
      start: bodyStart,
      end: closeIdx,
      text: source.slice(bodyStart, closeIdx),
    });
    const closeGt = source.indexOf(">", closeIdx);
    if (closeGt === -1) fail(`unterminated </${tagName}> at line ${lineNumberAt(source, closeIdx) + 1}`);
    segments.push({
      context: "html-tag",
      start: closeIdx,
      end: closeGt + 1,
      text: source.slice(closeIdx, closeGt + 1),
    });
    cursor = closeGt + 1;
    openRe.lastIndex = cursor;
  }
  if (cursor < source.length) {
    segments.push({
      context: "html",
      start: cursor,
      end: source.length,
      text: source.slice(cursor),
    });
  }
  return segments;
}

// -------------------------------------------------------------------
// Per-context marker collection.
// -------------------------------------------------------------------

function scanHtmlSegment(seg, source) {
  const markers = [];
  const lines = seg.text.split("\n");
  let offset = seg.start;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineStart = offset;
    const lineEnd = offset + line.length;
    const m = line.match(MARKER_RE_HTML);
    if (m) {
      markers.push({
        context: "html",
        target: m[1],
        kind: m[2],
        label: m[3],
        lineStart,
        lineEnd: lineEnd + 1,
        line: lineNumberAt(source, lineStart),
      });
    } else if (line.indexOf(SUSPICIOUS_SUBSTRING) !== -1) {
      // Any LYFELABZ: text at HTML top level that is not a valid marker
      // line is a fail-closed error. This catches malformed markers,
      // inline markers, and hidden LYFELABZ: strings alike.
      fail(
        `stray marker-like text in HTML at line ${lineNumberAt(source, lineStart) + 1}: ${line.trim()}`,
      );
    }
    offset = lineEnd + 1; // account for the \n split ate
  }
  return markers;
}

function scanJsSegment(seg, source) {
  const markers = [];
  const seenComments = [];

  // acorn.parse with onComment gives every legal JS comment; anything
  // inside strings/templates/regex literals is not delivered here.
  let parseError = null;
  try {
    acorn.parse(seg.text, {
      ecmaVersion: 2022,
      sourceType: "script",
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowHashBang: true,
      onComment: (isBlock, text, start, end, startLoc, endLoc) => {
        seenComments.push({ isBlock, text, start, end });
      },
    });
  } catch (err) {
    parseError = err;
  }

  // Even if acorn cannot parse (e.g. because a snippet is not a full
  // program - inline <script> content is usually a full script but not
  // always), we still refuse to emit markers we did not classify. If
  // the parse failed, fall back to a strict line scan that only accepts
  // markers on their own line AND still fail-closes on stray marker-like
  // text. This preserves fail-closed guarantees.
  if (parseError !== null) {
    // Line-level scan.
    const lines = seg.text.split("\n");
    let offset = seg.start;
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const lineStart = offset;
      const lineEnd = offset + line.length;
      const m = line.match(MARKER_RE_BLOCK);
      if (m) {
        markers.push({
          context: "js",
          target: m[1],
          kind: m[2],
          label: m[3],
          lineStart,
          lineEnd: lineEnd + 1,
          line: lineNumberAt(source, lineStart),
        });
      } else if (line.indexOf(SUSPICIOUS_SUBSTRING) !== -1) {
        fail(
          `stray marker-like text in <script> at line ${lineNumberAt(source, lineStart) + 1}: ${line.trim()}`,
        );
      } else if (line.indexOf("<!--") !== -1 || line.indexOf("-->") !== -1) {
        fail(
          `HTML-style comment not allowed inside <script> at line ${lineNumberAt(source, lineStart) + 1}`,
        );
      }
      offset = lineEnd + 1;
    }
    return markers;
  }

  // Parse succeeded. Walk acorn's comments; only genuine block comments
  // that occupy a standalone line are candidate markers.
  const commentSpans = [];
  for (const c of seenComments) {
    if (!c.isBlock) continue;
    const abs = seg.start + c.start;
    const absEnd = seg.start + c.end;
    const line = fullLineAt(source, abs);
    // Marker must occupy the entire line.
    if (line.start !== abs - (source.slice(line.start, abs).match(/^[ \t]*$/) ? source.slice(line.start, abs).length : Infinity)) {
      // fallthrough: relaxed check below
    }
    const stripped = source.slice(line.start, line.end).match(MARKER_RE_BLOCK);
    if (stripped) {
      markers.push({
        context: "js",
        target: stripped[1],
        kind: stripped[2],
        label: stripped[3],
        lineStart: line.start,
        lineEnd: line.end + 1,
        line: lineNumberAt(source, line.start),
      });
      commentSpans.push({ start: line.start, end: line.end + 1 });
    } else if (c.text.indexOf(SUSPICIOUS_SUBSTRING) !== -1) {
      fail(
        `LYFELABZ marker text found in a non-standalone JS comment at line ${lineNumberAt(source, abs) + 1}`,
      );
    }
  }
  // Additional sweep: any occurrence of LYFELABZ: in raw script text
  // that is NOT covered by a marker comment span is stray. This
  // catches marker text hidden inside a string, template literal, or
  // regex, because acorn would not have delivered those as comments.
  const text = seg.text;
  let idx = 0;
  while ((idx = text.indexOf(SUSPICIOUS_SUBSTRING, idx)) !== -1) {
    const abs = seg.start + idx;
    let covered = false;
    for (const span of commentSpans) {
      if (abs >= span.start && abs < span.end) {
        covered = true;
        break;
      }
    }
    if (!covered) {
      const line = fullLineAt(source, abs);
      fail(
        `stray marker-like text in <script> at line ${lineNumberAt(source, abs) + 1}: ${source.slice(line.start, line.end).trim()}`,
      );
    }
    idx += SUSPICIOUS_SUBSTRING.length;
  }
  // Also reject HTML-style comments inside <script>.
  if (text.indexOf("<!--") !== -1 || text.indexOf("-->") !== -1) {
    const bad = text.indexOf("<!--") !== -1 ? text.indexOf("<!--") : text.indexOf("-->");
    fail(
      `HTML-style comment not allowed inside <script> at line ${lineNumberAt(source, seg.start + bad) + 1}`,
    );
  }
  return markers;
}

function scanCssSegment(seg, source) {
  const markers = [];
  const text = seg.text;
  const commentSpans = [];

  // Bounded CSS comment scan. CSS block comments cannot nest and cannot
  // sit inside strings; a simple state machine that tracks '"..."', "'...'"
  // and /* ... */ is a complete parser for the subset we accept.
  let i = 0;
  let inString = null; // '"' or "'"
  while (i < text.length) {
    const ch = text[i];
    if (inString !== null) {
      if (ch === "\\" && i + 1 < text.length) { i += 2; continue; }
      if (ch === inString) inString = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = ch; i++; continue; }
    if (ch === "/" && text[i + 1] === "*") {
      const start = i;
      const closeIdx = text.indexOf("*/", i + 2);
      if (closeIdx === -1) fail(`unterminated /* */ comment in <style> at line ${lineNumberAt(source, seg.start + start) + 1}`);
      const end = closeIdx + 2;
      commentSpans.push({ start: seg.start + start, end: seg.start + end });
      const commentText = text.slice(start, end);
      if (commentText.indexOf(SUSPICIOUS_SUBSTRING) !== -1) {
        const line = fullLineAt(source, seg.start + start);
        const lineText = source.slice(line.start, line.end);
        const m = lineText.match(MARKER_RE_BLOCK);
        if (m) {
          markers.push({
            context: "css",
            target: m[1],
            kind: m[2],
            label: m[3],
            lineStart: line.start,
            lineEnd: line.end + 1,
            line: lineNumberAt(source, line.start),
          });
        } else {
          fail(
            `LYFELABZ marker text found in a non-standalone <style> comment at line ${lineNumberAt(source, seg.start + start) + 1}`,
          );
        }
      }
      i = end;
      continue;
    }
    i++;
  }
  // Stray marker text outside comments (in strings, in selectors) is
  // an error.
  let idx = 0;
  while ((idx = text.indexOf(SUSPICIOUS_SUBSTRING, idx)) !== -1) {
    const abs = seg.start + idx;
    let covered = false;
    for (const span of commentSpans) {
      if (abs >= span.start && abs < span.end) { covered = true; break; }
    }
    if (!covered) {
      const line = fullLineAt(source, abs);
      fail(
        `stray marker-like text in <style> at line ${lineNumberAt(source, abs) + 1}: ${source.slice(line.start, line.end).trim()}`,
      );
    }
    idx += SUSPICIOUS_SUBSTRING.length;
  }
  if (text.indexOf("<!--") !== -1 || text.indexOf("-->") !== -1) {
    const bad = text.indexOf("<!--") !== -1 ? text.indexOf("<!--") : text.indexOf("-->");
    fail(
      `HTML-style comment not allowed inside <style> at line ${lineNumberAt(source, seg.start + bad) + 1}`,
    );
  }
  return markers;
}

// -------------------------------------------------------------------
// Assemble regions from the flat marker list.
// -------------------------------------------------------------------

function pairMarkers(allMarkers) {
  const regions = [];
  const stack = [];
  const seenLabels = new Set();
  for (const m of allMarkers) {
    if (m.kind === "BEGIN") {
      if (seenLabels.has(m.label)) {
        fail(`duplicate marker label "${m.label}" at line ${m.line + 1}`);
      }
      seenLabels.add(m.label);
      if (stack.length > 0) {
        fail(
          `nested LYFELABZ region not allowed: "${m.label}" (line ${m.line + 1}) inside "${stack[stack.length - 1].label}" (line ${stack[stack.length - 1].line + 1})`,
        );
      }
      stack.push(m);
    } else {
      // END
      if (stack.length === 0) {
        fail(`END marker "${m.label}" at line ${m.line + 1} has no matching BEGIN`);
      }
      const begin = stack.pop();
      if (begin.label !== m.label) {
        fail(
          `mismatched labels: BEGIN "${begin.label}" (line ${begin.line + 1}) vs END "${m.label}" (line ${m.line + 1})`,
        );
      }
      if (begin.target !== m.target) {
        fail(
          `mismatched targets for "${m.label}": BEGIN ${begin.target} (line ${begin.line + 1}) vs END ${m.target} (line ${m.line + 1})`,
        );
      }
      if (begin.context !== m.context) {
        fail(
          `cross-context markers for "${m.label}": BEGIN ${begin.context} (line ${begin.line + 1}) vs END ${m.context} (line ${m.line + 1})`,
        );
      }
      regions.push({
        label: m.label,
        target: m.target,
        context: m.context,
        beginLineStart: begin.lineStart,
        beginLineEnd: begin.lineEnd,
        endLineStart: m.lineStart,
        endLineEnd: m.lineEnd,
        beginLine: begin.line,
        endLine: m.line,
      });
    }
  }
  if (stack.length > 0) {
    const orphan = stack[stack.length - 1];
    fail(`unbalanced marker: BEGIN "${orphan.label}" at line ${orphan.line + 1} has no END`);
  }
  return regions;
}

// -------------------------------------------------------------------
// Public entry point.
// -------------------------------------------------------------------

function scan(source) {
  if (typeof source !== "string") fail("source must be a string");
  const segments = splitSegments(source);
  const markers = [];
  for (const seg of segments) {
    if (seg.context === "html") markers.push(...scanHtmlSegment(seg, source));
    else if (seg.context === "js") markers.push(...scanJsSegment(seg, source));
    else if (seg.context === "css") markers.push(...scanCssSegment(seg, source));
    else if (seg.context === "html-tag") {
      // Marker text inside an opening/closing script/style tag is a
      // fail-closed error. We look for it explicitly.
      if (seg.text.indexOf(SUSPICIOUS_SUBSTRING) !== -1) {
        fail(`stray marker-like text inside <script>/<style> tag at line ${lineNumberAt(source, seg.start) + 1}`);
      }
    }
  }
  // Sort markers by lineStart so pairing sees them in document order.
  markers.sort((a, b) => a.lineStart - b.lineStart);
  const regions = pairMarkers(markers);
  return { regions, markers };
}

module.exports = { scan };
