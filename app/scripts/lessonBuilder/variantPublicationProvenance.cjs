/*
 * F5.3 Slice 9C-2 - assessment-revision provenance of a retained variant for
 * publication (DIFFERENTIATION_F5_3_ASSESSMENT_ACCESSIBILITY_ADDENDUM.md
 * section 21.7, owner ruling S9-D7).
 *
 * Given one append-only manifest entry and the exact retained artifact bytes,
 * decides which committed assessment revision the artifact covers, or refuses.
 * Order of provenance:
 *
 *   1. AP-bound entry: the certified assessment-presentation record supplies
 *      the revision. The record must be retained, content-addressed,
 *      certified, of this lesson, and the manifest's own revision must agree.
 *   2. Unbound entry: the manifest's explicit `assessmentRevisionId`.
 *   3. Unbound entry with no recorded revision: ONLY a pinned historical
 *      artifact (variantManifest.LEGACY_R1_UNBOUND_REVISIONS), interpreted as
 *      r1. Any other revisionless entry is refused; there is no opt-in.
 *
 * The resolved revision must be a committed revision of the lesson with a
 * canonical page in the committed revision-path table (so a canonical
 * fallback for it exists in the same Hosting release), and the artifact's
 * rendered quiz must be exactly that revision's:
 *   - AP-bound: the rendered literal equals the presentation rendering of the
 *     record against the revision's payload, and the embedded binding block
 *     names this record and revision;
 *   - unbound: the rendered quiz is faithful to that revision's payload and to
 *     no other committed revision of the lesson, and carries no binding block.
 *
 * Variant HTML never carries the canonical revision declaration (S9-D7); this
 * module reads provenance from metadata and proves it against the bytes.
 * Reads only; writes nothing. Whether the revision is DEPLOYED is a Firestore
 * question answered by the publisher, not here.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const paths = require("./paths.cjs");
const fidelity = require("./assessmentFidelity.cjs");
const revisions = require("./assessmentRevisions.cjs");
const renditions = require("./assessmentRenditions.cjs");
const AP = require("./assessmentPresentation.cjs");
const render = require("./assessmentPresentationRender.cjs");
const manifestMod = require("./variantManifest.cjs");

function refuse(error) {
  return { ok: false, error: `[variant-provenance] ${error}` };
}

function readPathTable(repoRoot) {
  const file = path.join(repoRoot, renditions.PATH_TABLE_FILE);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function resolvePublicationProvenance({ entry, artifactBytes, repoRoot = paths.REPO_ROOT }) {
  try {
    manifestMod.validateEntryShape(entry);
  } catch (err) {
    return refuse(err.message);
  }
  const slug = entry.lessonSlug;
  const text = Buffer.isBuffer(artifactBytes) ? artifactBytes.toString("utf8") : String(artifactBytes);

  // Provenance (S9-D7 order).
  let assessmentRevisionId;
  let source;
  let record = null;
  if (entry.assessmentPresentationRevisionId !== undefined) {
    const checked = AP.checkCertifiedPresentation(entry.assessmentPresentationRevisionId, { repoRoot, lessonSlug: slug });
    if (checked.failures.length > 0 || !checked.record) {
      return refuse(`assessment presentation ${entry.assessmentPresentationRevisionId} is not certified for ${slug}: ${checked.failures.join("; ")}`);
    }
    record = checked.record;
    if (entry.assessmentRevisionId !== record.assessmentRevisionId) {
      return refuse(`manifest entry records ${String(entry.assessmentRevisionId)} but its assessment presentation maps to ${record.assessmentRevisionId}`);
    }
    assessmentRevisionId = record.assessmentRevisionId;
    source = "assessmentPresentation";
  } else if (entry.assessmentRevisionId !== undefined) {
    assessmentRevisionId = entry.assessmentRevisionId;
    source = "declared";
  } else if (manifestMod.LEGACY_R1_UNBOUND_REVISIONS.includes(entry.presentationRevisionId)) {
    assessmentRevisionId = revisions.revisionIdFor(slug, 1);
    source = "legacyR1";
  } else {
    return refuse(`unbound entry ${entry.presentationRevisionId} records no assessmentRevisionId and is not a pinned historical legacy-r1 artifact`);
  }

  // Committed revision of THIS lesson, with a canonical page.
  const parsed = revisions.parseRevisionId(assessmentRevisionId);
  if (parsed === null || parsed.slug !== slug) {
    return refuse(`${String(assessmentRevisionId)} is not a revision of assessment_${slug}`);
  }
  let lessonRevisions;
  try {
    lessonRevisions = revisions.revisionsForLesson(slug, { repoRoot });
  } catch (err) {
    return refuse(err.message);
  }
  const revision = lessonRevisions.find((e) => e.assessmentRevisionId === assessmentRevisionId);
  if (!revision) return refuse(`${assessmentRevisionId} is not a committed assessment revision`);
  let table;
  try {
    table = readPathTable(repoRoot);
  } catch (err) {
    return refuse(`revision path table is unreadable: ${err.message}`);
  }
  if (renditions.resolveRevisionPath(table, slug, assessmentRevisionId) === null) {
    return refuse(`${assessmentRevisionId} has no canonical page in ${renditions.PATH_TABLE_FILE}`);
  }

  // Rendered-assessment fidelity against the exact retained bytes.
  let block;
  try {
    block = render.readBindingBlock(text);
  } catch (err) {
    return refuse(err.message);
  }
  if (record !== null) {
    if (!block || block.assessmentPresentationRevisionId !== entry.assessmentPresentationRevisionId || block.assessmentRevisionId !== assessmentRevisionId || block.lessonSlug !== slug) {
      return refuse("the artifact's assessment-presentation binding block does not name its certified presentation and revision");
    }
    let expected;
    let actual;
    try {
      expected = render.buildPresentationQuiz(record, revision.payload).questions;
      actual = fidelity.extractCanonicalQuizRaw(text, slug).questions;
    } catch (err) {
      return refuse(err.message);
    }
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      return refuse(`the artifact's rendered quiz is not the rendering of ${entry.assessmentPresentationRevisionId} against ${assessmentRevisionId}`);
    }
  } else {
    if (block !== null) return refuse("an unbound entry's artifact carries an assessment-presentation binding block");
    let quiz;
    try {
      quiz = fidelity.extractCanonicalQuiz(text, slug);
    } catch (err) {
      return refuse(err.message);
    }
    const faithful = lessonRevisions.filter((e) => fidelity.checkFidelity(slug, e.payload, quiz).length === 0).map((e) => e.assessmentRevisionId);
    if (faithful.length !== 1 || faithful[0] !== assessmentRevisionId) {
      return refuse(`the artifact's rendered quiz is faithful to [${faithful.join(", ")}], not exactly ${assessmentRevisionId}`);
    }
  }
  return { ok: true, assessmentRevisionId, source };
}

module.exports = { resolvePublicationProvenance };
