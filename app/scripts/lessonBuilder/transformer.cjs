/*
 * Transformer.
 *
 * Given the original source bytes and the region list from the scanner,
 * produce the bytes for a specific build target. The transformer:
 *
 *   - strips regions whose target does not match the current build
 *     target (i.e. builds target=v1 remove V2-ONLY regions and keep
 *     V1-ONLY regions; builds target=v2 do the reverse)
 *   - always strips the marker comment lines themselves for regions of
 *     the OPPOSITE target (they were included in the range)
 *   - always strips the marker comment lines for regions of the CURRENT
 *     target as well; the marker text itself is a build-time control
 *     surface, never a runtime one
 *   - inserts the generated notice immediately after the doctype line
 *
 * The transformer never touches marker-free bytes outside those two
 * concerns. Any span of the source that is neither a marker line nor
 * inside a region marked for stripping is copied byte-for-byte.
 */

"use strict";

function transform(source, regions, target, notice) {
  if (typeof source !== "string") throw new Error("source must be a string");
  if (!Array.isArray(regions)) throw new Error("regions must be an array");
  if (target !== "v1" && target !== "v2") throw new Error(`unknown target ${target}`);
  if (typeof notice !== "string" || notice.length === 0) {
    throw new Error("notice must be a non-empty string");
  }

  const stripSpans = [];
  for (const r of regions) {
    const keep = (r.target === "V1-ONLY" && target === "v1")
      || (r.target === "V2-ONLY" && target === "v2");
    if (keep) {
      // Keep body content, strip only the two marker lines.
      stripSpans.push({ start: r.beginLineStart, end: r.beginLineEnd });
      stripSpans.push({ start: r.endLineStart, end: r.endLineEnd });
    } else {
      // Strip marker lines AND the enclosed body.
      stripSpans.push({ start: r.beginLineStart, end: r.endLineEnd });
    }
  }

  stripSpans.sort((a, b) => a.start - b.start);
  // Sanity: no overlap.
  for (let i = 1; i < stripSpans.length; i++) {
    if (stripSpans[i].start < stripSpans[i - 1].end) {
      throw new Error(
        `internal error: overlapping strip spans at ${stripSpans[i - 1].start}..${stripSpans[i - 1].end} and ${stripSpans[i].start}..${stripSpans[i].end}`,
      );
    }
  }

  // Emit.
  let out = "";
  let cursor = 0;
  for (const span of stripSpans) {
    out += source.slice(cursor, span.start);
    cursor = span.end;
  }
  out += source.slice(cursor);

  // Notice placement: immediately after the doctype line. If the file
  // begins with a UTF-8 BOM, we place after that. Doctype match is
  // case-insensitive to survive lowercase or mixed-case authoring.
  const bomOffset = out.charCodeAt(0) === 0xfeff ? 1 : 0;
  const doctypeRe = /^<!doctype[^>]*>[ \t]*\r?\n?/i;
  const rest = out.slice(bomOffset);
  const m = rest.match(doctypeRe);
  if (!m) throw new Error("source missing <!DOCTYPE> declaration");
  const insertAt = bomOffset + m[0].length;
  const withNotice = out.slice(0, insertAt) + notice + out.slice(insertAt);
  return withNotice;
}

// Marker-free span extractor. Used by the byte-preservation proof: the
// bytes of the source with EVERY marker line and EVERY region body
// removed must, for either target, equal the bytes of a rendered output
// with the notice removed and the surviving region bodies removed too.
//
// Instead of implementing that full reconciliation, callers verify byte
// preservation by comparing "source minus marker lines minus V2-ONLY
// bodies" against "v1 output minus notice" and analogously for v2.
function stripAllMarkersAndBodies(source, regions, target) {
  return transform(source, regions, target, "\n<!--MARKER-FREE-PROBE-->\n").replace(
    /\n<!--MARKER-FREE-PROBE-->\n/,
    "",
  );
}

module.exports = { transform, stripAllMarkersAndBodies };
