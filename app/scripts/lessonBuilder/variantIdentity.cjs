/*
 * Presentation identity contract (F5.2 S5.1/S5.2, Slice 2).
 *
 * Pure helpers only - no filesystem access. Four identities stay
 * distinct per the spec and are never collapsed here:
 *
 *   lessonSlug              - canonical lesson identity (unchanged).
 *   variantKey               - logical accommodation-presentation identity
 *                               ("reading-adapted" in V1). Never appears in
 *                               a student-visible artifact path (M4).
 *   presentationRevisionId   - identity of one exact immutable delivered
 *                               build of (lessonSlug, variantKey); derived
 *                               from the full 64-hex-char SHA-256 of the
 *                               exact final artifact bytes (M2).
 *   assessmentRevisionId     - untouched by this feature; not referenced
 *                               here at all.
 */

"use strict";

const path = require("path");

const { sha256Hex } = require("./hash.cjs");

// M3: any lessonSlug participating in variant publication must match this
// charset (no underscore), so the "__" delimiter in manifest keys and
// (later, Slice 3) presentationVariants doc IDs stays unambiguous. This
// restriction applies only to variant publication, never to canonical
// lesson behavior.
const LESSON_SLUG_VARIANT_RE = /^[a-z0-9-]+$/;

// "pr" + full 64 lowercase-hex-char SHA-256 digest. Full digest from the
// start (M2): no prefix-collision remediation scheme exists or is needed.
const PRESENTATION_REVISION_ID_RE = /^pr[0-9a-f]{64}$/;

function fail(message) {
  throw new Error(`[variant-identity] ${message}`);
}

function assertValidLessonSlugForVariant(slug) {
  if (typeof slug !== "string" || slug.length === 0) {
    fail("lessonSlug must be a non-empty string");
  }
  if (!LESSON_SLUG_VARIANT_RE.test(slug)) {
    fail(
      `lessonSlug "${slug}" is not valid for variant publication: must match ^[a-z0-9-]+$ ` +
        "(lowercase letters, digits, hyphens only - no underscore, no path separators)",
    );
  }
  // Defense in depth: the charset above already excludes "/", "\\", and
  // "..", but keep this explicit so the function stays correct even if the
  // charset were ever loosened by a future revision.
  if (slug.includes("/") || slug.includes("\\") || slug.includes("..")) {
    fail(`lessonSlug "${slug}" contains unsafe path characters`);
  }
  return slug;
}

function isValidLessonSlugForVariant(slug) {
  try {
    assertValidLessonSlugForVariant(slug);
    return true;
  } catch {
    return false;
  }
}

// Derives presentationRevisionId from the EXACT final bytes that will be
// served to the student - never source text, never a metadata object,
// never a normalized/truncated form. Identical bytes always produce the
// identical ID; different bytes (short of an actual SHA-256 break) always
// produce a different ID.
function computePresentationRevisionId(finalArtifactBytes) {
  return `pr${sha256Hex(finalArtifactBytes)}`;
}

function assertValidPresentationRevisionId(id) {
  if (typeof id !== "string" || !PRESENTATION_REVISION_ID_RE.test(id)) {
    fail(`malformed presentationRevisionId: ${JSON.stringify(id)}`);
  }
  return id;
}

// Output addressing (M4): the path carries only lessonSlug and the opaque
// content-hash revision ID. No variantKey, accommodation category,
// student identifier, or any other sensitive token may ever appear here.
function variantRelativeOutputPath(lessonSlug, presentationRevisionId) {
  assertValidLessonSlugForVariant(lessonSlug);
  assertValidPresentationRevisionId(presentationRevisionId);
  return path.posix.join(
    "app",
    "lessons",
    "variants",
    `lesson_${lessonSlug}__${presentationRevisionId}.html`,
  );
}

module.exports = {
  LESSON_SLUG_VARIANT_RE,
  PRESENTATION_REVISION_ID_RE,
  assertValidLessonSlugForVariant,
  isValidLessonSlugForVariant,
  computePresentationRevisionId,
  assertValidPresentationRevisionId,
  variantRelativeOutputPath,
};
