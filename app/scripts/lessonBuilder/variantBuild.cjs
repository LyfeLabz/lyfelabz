/*
 * Differentiated-presentation artifact generation (F5.2 S5.2/S6.8 steps
 * 1-4, Slice 2).
 *
 * generateVariantArtifact() performs exactly the Slice-2-owned prefix of
 * the §6.8 publication state machine: build (caller-supplied, already
 * deterministic bytes), derive the full-digest presentationRevisionId,
 * add the revision-specific artifact file (add-only), and append the
 * manifest entry (append-only). It does NOT commit, deploy, run a
 * liveness check, or touch presentationVariants - those are steps 6-9,
 * owned by Slice 3's publish tooling.
 *
 * This module implements no instructional differentiation itself: callers
 * supply the exact final bytes to retain. Production adapted-lesson
 * content does not exist yet; only this repository's own test fixtures
 * call this function today.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const paths = require("./paths.cjs");
const { sha256Hex } = require("./hash.cjs");
const identity = require("./variantIdentity.cjs");
const manifestMod = require("./variantManifest.cjs");

// F5.3 Slice 6A: every local, uncertified assessment-presentation preview
// (variantSource.buildUncertifiedAssessmentPreview) carries this marker, and
// retention refuses any bytes that contain it, so a preview can never become
// a retained revision or a manifest entry.
const UNCERTIFIED_PREVIEW_MARKER = "LYFELABZ:UNCERTIFIED-ASSESSMENT-PREVIEW";

function fail(message) {
  throw new Error(`[variant-build] ${message}`);
}

function generateVariantArtifact({
  lessonSlug,
  variantKey,
  bytes,
  publishedAt,
  repoRoot = paths.REPO_ROOT,
  write = true,
  assessmentBinding = null,
}) {
  identity.assertValidLessonSlugForVariant(lessonSlug);
  if (typeof variantKey !== "string" || variantKey.length === 0) {
    fail("variantKey must be a non-empty string");
  }
  if (typeof bytes !== "string" && !Buffer.isBuffer(bytes)) {
    fail("bytes must be the exact final artifact content (string or Buffer) - never source text or metadata");
  }
  if ((Buffer.isBuffer(bytes) ? bytes.toString("utf8") : bytes).includes(UNCERTIFIED_PREVIEW_MARKER)) {
    fail("bytes are an uncertified assessment-presentation preview; a preview is never retained or published");
  }
  if (typeof publishedAt !== "string" || publishedAt.length === 0) {
    // No implicit wall-clock default: forces every caller (real publish
    // tooling and test fixtures alike) to decide deliberately what this
    // value means, so a test fixture can never be mistaken for a real
    // production publication timestamp.
    fail("publishedAt must be an explicit ISO-8601 timestamp string");
  }

  const presentationRevisionId = identity.computePresentationRevisionId(bytes);
  const relPath = identity.variantRelativeOutputPath(lessonSlug, presentationRevisionId);
  const absPath = path.join(repoRoot, relPath);
  const sha256 = sha256Hex(bytes);
  const newBuf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, "utf8");

  let fileWritten = false;
  if (fs.existsSync(absPath)) {
    const onDisk = fs.readFileSync(absPath);
    if (!onDisk.equals(newBuf)) {
      // Structurally this can only happen via an actual SHA-256 collision
      // (M2/T-D4): the path is derived from the hash of these exact
      // bytes, so two different byte sequences landing on the same path
      // means their hashes collided. Refuse rather than silently keep
      // either version.
      fail(
        `integrity failure: "${relPath}" already exists with different bytes than the requested publish ` +
          "(full-digest collision over different content, or the retained file was altered out of band)",
      );
    }
    // Identical bytes at an existing path: harmless no-op for the file.
  } else if (write) {
    // fs.mkdirSync(..., {recursive:true}) is additive, never destructive,
    // so it needs no M7 guard here - the guard exists for a hypothetical
    // future clean/delete step (see variantManifest.guardAgainstDestructiveClear),
    // not for this add-only write path.
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    const tmp = paths.tmpSibling(absPath);
    try {
      fs.writeFileSync(tmp, newBuf, { mode: 0o644 });
      fs.renameSync(tmp, absPath);
    } finally {
      paths.safeUnlink(tmp);
    }
    fileWritten = true;
  }

  const entry = { lessonSlug, variantKey, presentationRevisionId, path: relPath, sha256, publishedAt };
  // F5.3 Slice 4: an artifact rendered from a certified assessment
  // presentation records its binding in the append-only manifest entry.
  if (assessmentBinding !== null) {
    entry.assessmentRevisionId = assessmentBinding.assessmentRevisionId;
    entry.assessmentPresentationRevisionId = assessmentBinding.assessmentPresentationRevisionId;
  }
  const { appended } = write ? manifestMod.appendEntry(entry, { repoRoot }) : { appended: false };

  return { ...entry, absPath, fileWritten, appended };
}

module.exports = { UNCERTIFIED_PREVIEW_MARKER, generateVariantArtifact };
