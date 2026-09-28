/*
 * Authored presentation variants (F5.2 S5.2 "variant authored source +
 * shared transformer config", Slice 2 tooling).
 *
 * A configured lesson may declare, in its existing lesson config, one
 * authored source per V1 variantKey:
 *
 *   variants: {
 *     "reading-adapted": {
 *       source: "lesson-sources/variants/<slug>.reading-adapted.html",
 *       adaptableSections: ["explore", ...],     // section ids
 *       adaptableSelectors: ["p", ".callout-body"],
 *       lockedSelectors: [".edu-note", ".qr-card"],
 *     },
 *   },
 *
 * The variant source is a full copy of the canonical source (same V1/V2
 * markers) whose adaptable prose has been rewritten. It is built with the
 * SAME scanner, config validation and transformer as the canonical lesson,
 * for the v2 target only (a variant is only ever delivered to
 * authenticated launches), then:
 *
 *   - given a neutral generated notice that names neither the variantKey
 *     nor the source file (artifact bytes are publicly fetchable);
 *   - relocated so relative references resolve from /app/lessons/variants/
 *     exactly as the canonical lesson's do from /app/lessons/;
 *   - gated against the canonical v2 build: presentation invariance
 *     (variantInvariance.cjs), the full instructional-equivalence contract
 *     with zero exclusions, quiz identity, and assessment fidelity against
 *     the variant's own assessment revision;
 *   - built twice and required to be byte-identical (determinism).
 *
 * F5.3 Slice 4: when the variant config names an
 * `assessmentPresentationRevisionId`, every gate above still runs on the
 * instruction-only build (so the authored source can never hand-edit the
 * quiz); the certified assessment presentation is then rendered into the
 * quiz, directions, and Show Your Thinking by assessmentPresentationRender.cjs
 * (twice, byte-identical), the no-disclosure check re-runs on the final bytes,
 * and the manifest entry records the binding.
 *
 * F5.3 Slice 9B (addendum section 21.3, "variant baseline"): the canonical
 * baseline is the canonical rendition of the VARIANT's assessment revision,
 * not whichever revision the source currently represents. The variant's
 * revision is, in order: the bound assessment presentation's revision; else
 * the variant config's explicit `assessmentRevisionId`; else, ONLY for a
 * historical approved artifact pinned in LEGACY_R1_UNBOUND_REVISIONS, the
 * legacy-r1 rule (`prff01d9...375c` was authored while r1 was the only
 * revision). An unbound build with no explicit revision whose bytes are not a
 * pinned legacy artifact is refused: a newly authored variant never receives
 * r1 by default (owner ruling S9-D7, 9B closure). A declared revision that
 * disagrees with the bound presentation, or that is not committed, is
 * refused. Variant provenance is build/publication metadata; variant HTML
 * never gains the canonical revision declaration. When the
 * variant's revision is the configured canonical revision the baseline is
 * the plain canonical v2 build, byte-for-byte as before. Otherwise only the
 * quiz literal is regenerated from the variant revision's payload
 * (assessmentRenditions.cjs), and for the comparison only, the variant's own
 * literal, after it is proven to be exactly that revision's quiz, is given
 * the same generated text. The variant's delivered bytes are never
 * normalized, and the canonical revision declaration is never inserted on
 * this path, so retained variant bytes reproduce exactly.
 *
 * Generation hands the exact final bytes to the existing content-addressed
 * generateVariantArtifact() (Slice 2): the revision id, retained path and
 * append-only manifest entry come from there, unchanged. Nothing here
 * commits, deploys, writes a presentation index, or touches Firestore.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const paths = require("./paths.cjs");
const scanner = require("./markerScanner.cjs");
const transformer = require("./transformer.cjs");
const configMod = require("./config.cjs");
const equivalence = require("./equivalence.cjs");
const fidelity = require("./assessmentFidelity.cjs");
const assessmentRevisions = require("./assessmentRevisions.cjs");
const renditions = require("./assessmentRenditions.cjs");
const identity = require("./variantIdentity.cjs");
const manifestMod = require("./variantManifest.cjs");
const { generateVariantArtifact, UNCERTIFIED_PREVIEW_MARKER } = require("./variantBuild.cjs");
const { relocateHtml } = require("./variantLinks.cjs");
const invariance = require("./variantInvariance.cjs");
const { sha256Hex } = require("./hash.cjs");
const presentationRender = require("./assessmentPresentationRender.cjs");
const assessmentPresentation = require("./assessmentPresentation.cjs");

const ASSESSMENT_PAYLOAD_DIR = path.join("platform", "functions", "src", "scripts", "assessments");

function fail(message) {
  throw new Error(`[variant-source] ${message}`);
}

// Historical approved unbound artifacts that predate explicit variant
// revision provenance and may only be interpreted as r1 (S9-D2, S9-D7). The
// list is pinned and may only shrink; never add a newly authored variant.
// Defined once, with the manifest that enforces it (variantManifest.cjs).
const LEGACY_R1_UNBOUND_REVISIONS = manifestMod.LEGACY_R1_UNBOUND_REVISIONS;

// Neutral generated notice. Deterministic, and deliberately free of the
// variantKey, the accommodation category, and the authored source path.
function neutralNotice(slug) {
  return `<!--
GENERATED FILE. DO NOT EDIT DIRECTLY.
Alternate presentation of lesson_${slug}.
-->
`;
}

function buildV2(cfg, sourceBytes, notice, label) {
  const scan = scanner.scan(sourceBytes);
  try {
    configMod.validateScanAgainstConfig(cfg, scan);
  } catch (err) {
    fail(`${label}: ${err.message}`);
  }
  return transformer.transform(sourceBytes, scan.regions, "v2", notice);
}

function assertV2Signatures(cfg, v2Bytes) {
  for (const sig of cfg.v2ProhibitedSignatures) {
    if (v2Bytes.includes(sig)) fail(`variant v2 output contains prohibited legacy signature: ${sig}`);
  }
  for (const sig of cfg.sharedRequiredSignatures) {
    if (!v2Bytes.includes(sig)) fail(`variant v2 output missing required shared signature: ${sig}`);
  }
}

function stripNotice(bytes, notice, label) {
  const at = bytes.indexOf(notice);
  if (at === -1) fail(`${label}: generated notice not found`);
  return bytes.slice(0, at) + bytes.slice(at + notice.length);
}

// Deterministic final bytes of one variant build (no gate).
function renderVariant(cfg, variantSourceBytes) {
  const raw = buildV2(cfg, variantSourceBytes, neutralNotice(cfg.slug), "variant source");
  assertV2Signatures(cfg, raw);
  const relocated = relocateHtml(raw);
  if (relocateHtml(relocated.html).rewritten.length !== 0) {
    fail("relocation post-condition failed: relative references remain");
  }
  return relocated;
}

function assertContractEqual(canonicalBody, variantBody) {
  const mismatches = equivalence.diff(
    equivalence.buildContract(canonicalBody),
    equivalence.buildContract(variantBody),
  );
  if (mismatches.length === 0) return;
  const lines = mismatches.slice(0, 10).map(
    (m) => `  - ${m.path} (${m.kind})\n      canonical: ${JSON.stringify(m.v1)}\n      variant:   ${JSON.stringify(m.v2)}`,
  );
  fail(`instructional contract differs from the canonical lesson (${mismatches.length} field(s)):\n${lines.join("\n")}`);
}

// The committed revisions handed to a build, identity-checked (the repository
// wrapper passes assessmentRevisions.revisionsForLesson output; tests pass
// synthetic { name, payload } lists).
function committedRevisions(slug, assessmentPayloads) {
  const entries = [];
  const problems = [];
  for (const p of assessmentPayloads || []) {
    const d = assessmentRevisions.describeRevision(p.name, p.payload);
    problems.push(...d.problems);
    if (d.entry !== null && d.entry.slug === slug) entries.push(d.entry);
  }
  problems.push(...assessmentRevisions.validateRevisionSet(entries));
  if (problems.length > 0) fail(`committed assessment revisions are inconsistent:\n  - ${problems.join("\n  - ")}`);
  return entries.sort((a, b) => a.revisionOrdinal - b.revisionOrdinal);
}

// The assessment revision this variant displays (see the header).
function variantAssessmentRevision(cfg, variantKey, committed, repoRoot) {
  const variantConfig = cfg.variants[variantKey];
  let bound = null;
  const apId = variantConfig.assessmentPresentationRevisionId;
  if (apId !== undefined) {
    const checked = assessmentPresentation.checkCertifiedPresentation(apId, { repoRoot, lessonSlug: cfg.slug });
    if (checked.failures.length > 0 || !checked.record) {
      fail(`assessment presentation ${apId} cannot be rendered:\n  - ${checked.failures.join("\n  - ")}`);
    }
    bound = checked.record.assessmentRevisionId;
  }
  const declared = variantConfig.assessmentRevisionId;
  if (declared !== undefined && bound !== null && declared !== bound) {
    fail(`variant declares ${declared} but its assessment presentation ${apId} maps to ${bound}`);
  }
  const id = bound || declared || assessmentRevisions.revisionIdFor(cfg.slug, 1);
  const entry = committed.find((e) => e.assessmentRevisionId === id);
  if (!entry) fail(`variant assessment revision ${id} is not a committed revision of "${cfg.slug}"`);
  return { entry, basis: bound !== null ? "assessmentPresentation" : declared !== undefined ? "declared" : "legacy-r1" };
}

// The canonical v2 baseline for the variant's revision, and the variant html
// as compared against it. See the header for the normalization rule.
function revisionBaseline(cfg, canonicalV2, variantHtml, committed, variantRevision) {
  const slug = cfg.slug;
  const canonical = assessmentRevisions.resolveCanonicalRevision(cfg, committed);
  const canonicalProblems = fidelity.checkFidelity(slug, canonical.payload, fidelity.extractCanonicalQuiz(canonicalV2, slug));
  if (canonicalProblems.length > 0) {
    fail(`canonical quiz is not faithful to its configured revision ${canonical.file}:\n${canonicalProblems.join("\n")}`);
  }
  if (variantRevision.assessmentRevisionId === canonical.assessmentRevisionId) {
    return { baseline: canonicalV2, compared: variantHtml };
  }
  const rendered = renditions.renderRevisionQuiz(canonicalV2, slug, variantRevision);
  let variantQuestions;
  try {
    variantQuestions = fidelity.extractCanonicalQuizRaw(variantHtml, slug).questions;
  } catch (err) {
    fail(err.message);
  }
  if (JSON.stringify(variantQuestions) !== JSON.stringify(rendered.questions)) {
    fail(`variant quiz is not exactly ${variantRevision.assessmentRevisionId}`);
  }
  const literal = presentationRender.locateQuizLiteral(variantHtml);
  const compared = variantHtml.slice(0, literal.start) + presentationRender.literalSource(rendered.questions) + variantHtml.slice(literal.end);
  return { baseline: rendered.html, compared };
}

function assertAssessmentIdentity(slug, canonicalV2, variantHtml, variantRevision) {
  const canonicalQuiz = fidelity.extractCanonicalQuiz(canonicalV2, slug);
  const variantQuiz = fidelity.extractCanonicalQuiz(variantHtml, slug);
  if (JSON.stringify(canonicalQuiz) !== JSON.stringify(variantQuiz)) {
    fail("variant quiz differs from the canonical quiz");
  }
  const problems = fidelity.checkFidelity(slug, variantRevision.payload, variantQuiz);
  if (problems.length > 0) fail(`variant quiz is not faithful to ${variantRevision.file}:\n${problems.join("\n")}`);
  return [variantRevision.file];
}

// Pure build + gate. Inputs are bytes and an already-loaded config, so the
// whole pipeline is testable against synthetic fixtures.
function buildVariantArtifact({ cfg, variantKey, canonicalSourceBytes, variantSourceBytes, assessmentPayloads, repoRoot = paths.REPO_ROOT }) {
  configMod.validateConfigShape(cfg, cfg.slug);
  if (!cfg.variants || !cfg.variants[variantKey]) {
    fail(`lesson "${cfg.slug}" declares no authored "${variantKey}" variant`);
  }
  const variantConfig = cfg.variants[variantKey];
  identity.assertValidLessonSlugForVariant(cfg.slug);

  const committed = committedRevisions(cfg.slug, assessmentPayloads);
  const { entry: variantRevision, basis: revisionBasis } = variantAssessmentRevision(cfg, variantKey, committed, repoRoot);
  const currentV2 = buildV2(cfg, canonicalSourceBytes, cfg.generatedNotice.v2, "canonical source");
  const first = renderVariant(cfg, variantSourceBytes);
  const second = renderVariant(cfg, variantSourceBytes);
  if (first.html !== second.html) fail("variant build is not deterministic");
  const variantHtml = first.html;
  // Gates run on the canonical rendition of the variant's own revision.
  const { baseline: canonicalV2, compared: comparedVariantHtml } = revisionBaseline(cfg, currentV2, variantHtml, committed, variantRevision);

  const canonicalRelocated = relocateHtml(canonicalV2).html;
  const canonicalBody = stripNotice(canonicalRelocated, cfg.generatedNotice.v2, "canonical");
  const variantBody = stripNotice(comparedVariantHtml, neutralNotice(cfg.slug), "variant");

  const disclosureLiterals = [variantKey, path.basename(variantConfig.source)];
  const review = invariance.assertPresentationInvariance({
    canonicalHtml: canonicalBody,
    variantHtml: variantBody,
    variantConfig,
    disclosureLiterals,
  });
  // The notice is outside the compared bodies: prove the complete
  // delivered bytes disclose nothing either.
  invariance.assertNoDisclosure(canonicalRelocated, variantHtml, disclosureLiterals);
  assertContractEqual(canonicalBody, variantBody);
  const boundRevisions = assertAssessmentIdentity(cfg.slug, canonicalV2, comparedVariantHtml, variantRevision);

  let finalHtml = variantHtml;
  let assessmentBinding = null;
  const apId = variantConfig.assessmentPresentationRevisionId;
  if (apId !== undefined) {
    const render = () =>
      presentationRender.renderCertifiedAssessmentPresentation(variantHtml, {
        assessmentPresentationRevisionId: apId,
        lessonSlug: cfg.slug,
        repoRoot,
      });
    const a = render();
    const b = render();
    if (a.html !== b.html) fail("assessment-presentation rendering is not deterministic");
    finalHtml = a.html;
    assessmentBinding = {
      assessmentRevisionId: a.binding.assessmentRevisionId,
      assessmentPresentationRevisionId: a.binding.assessmentPresentationRevisionId,
    };
    invariance.assertNoDisclosure(canonicalRelocated, finalHtml, disclosureLiterals);
  }

  const presentationRevisionId = identity.computePresentationRevisionId(finalHtml);
  if (revisionBasis === "legacy-r1" && !LEGACY_R1_UNBOUND_REVISIONS.includes(presentationRevisionId)) {
    fail(
      `unbound variant "${variantKey}" builds to ${presentationRevisionId}, which is not a pinned historical legacy-r1 artifact; ` +
        `declare its assessment revision explicitly (variants["${variantKey}"].assessmentRevisionId)`,
    );
  }
  return {
    lessonSlug: cfg.slug,
    variantKey,
    bytes: finalHtml,
    sha256: sha256Hex(finalHtml),
    presentationRevisionId,
    path: identity.variantRelativeOutputPath(cfg.slug, presentationRevisionId),
    relocatedReferences: first.rewritten,
    assessmentRevisions: boundRevisions,
    assessmentRevisionBasis: revisionBasis,
    // F5.3 Slice 9C-2: the revision a manifest entry records (absent only for
    // a pinned legacy-r1 artifact).
    recordedAssessmentRevisionId: revisionBasis === "legacy-r1" ? undefined : variantRevision.assessmentRevisionId,
    assessmentBinding,
    review,
  };
}

// -- Repository wrappers ---------------------------------------------------

function readUnder(repoRoot, relPath, rootDir) {
  const abs = path.resolve(repoRoot, relPath);
  const root = path.join(repoRoot, rootDir);
  if (!paths.isWithin(root, abs)) fail(`${relPath} must live under ${rootDir}/`);
  if (!fs.existsSync(abs)) fail(`missing file: ${relPath}`);
  return fs.readFileSync(abs, "utf8");
}

// Every committed revision of the lesson, in ordinal order, discovered and
// identity-checked by the shared assessmentRevisions.cjs (F5.3 Slice 9A). An
// inconsistent payload directory fails closed rather than being filtered.
function loadAssessmentPayloads(slug, repoRoot = paths.REPO_ROOT) {
  const dir = path.join(repoRoot, ASSESSMENT_PAYLOAD_DIR);
  if (!fs.existsSync(dir)) return [];
  return assessmentRevisions
    .revisionsForLesson(slug, { repoRoot })
    .map((e) => ({ name: e.file, payload: e.payload }));
}

function buildAuthoredVariant({ slug, variantKey, repoRoot = paths.REPO_ROOT, cfg = null }) {
  const config = cfg || configMod.loadConfig(slug);
  if (!config.variants || !config.variants[variantKey]) {
    fail(`lesson "${slug}" declares no authored "${variantKey}" variant`);
  }
  return buildVariantArtifact({
    cfg: config,
    variantKey,
    canonicalSourceBytes: readUnder(repoRoot, config.canonicalSource, "lesson-sources"),
    variantSourceBytes: readUnder(repoRoot, config.variants[variantKey].source, "lesson-sources"),
    assessmentPayloads: loadAssessmentPayloads(slug, repoRoot),
    repoRoot,
  });
}

// Build, gate, and retain through the existing content-addressed
// generateVariantArtifact(). `publishedAt` is required and explicit.
function generateAuthoredVariant({ slug, variantKey, publishedAt, repoRoot = paths.REPO_ROOT, cfg = null, write = true }) {
  const built = buildAuthoredVariant({ slug, variantKey, repoRoot, cfg });
  const result = generateVariantArtifact({
    lessonSlug: slug,
    variantKey,
    bytes: built.bytes,
    publishedAt,
    repoRoot,
    write,
    assessmentBinding:
      built.assessmentBinding ||
      (built.recordedAssessmentRevisionId !== undefined ? { assessmentRevisionId: built.recordedAssessmentRevisionId } : null),
  });
  if (result.presentationRevisionId !== built.presentationRevisionId) {
    fail("generated revision id does not match the gated build");
  }
  return { ...built, fileWritten: result.fileWritten, appended: result.appended, publishedAt: result.publishedAt };
}

// Drift detection: every declared authored variant must still build, pass
// every gate against the CURRENT canonical lesson, and its current build
// must already be a retained, manifest-listed revision. A canonical edit
// that breaks invariance, or a variant-source edit that was never
// generated, fails here.
function checkAuthoredVariants({ repoRoot = paths.REPO_ROOT, configs = null } = {}) {
  const list = configs || configMod.listConfiguredSlugs().map((s) => configMod.loadConfig(s));
  const entries = manifestMod.readManifest(repoRoot);
  const failures = [];
  const checked = [];
  for (const cfg of list) {
    if (!cfg.variants) continue;
    for (const variantKey of Object.keys(cfg.variants).sort()) {
      const label = `${cfg.slug}/${variantKey}`;
      try {
        const built = buildAuthoredVariant({ slug: cfg.slug, variantKey, repoRoot, cfg });
        const binding = built.assessmentBinding || {};
        const retained = entries.some(
          (e) =>
            e.lessonSlug === cfg.slug &&
            e.variantKey === variantKey &&
            e.presentationRevisionId === built.presentationRevisionId &&
            e.assessmentRevisionId === built.recordedAssessmentRevisionId &&
            e.assessmentPresentationRevisionId === binding.assessmentPresentationRevisionId,
        );
        if (!retained) {
          failures.push(
            `${label}: authored source builds to ${built.presentationRevisionId}, which is not a retained manifest revision ` +
              `(run: node app/scripts/build-variants.cjs --generate --lesson=${cfg.slug} --variant=${variantKey} --published-at=<ISO-8601>)`,
          );
        }
        checked.push({ label, presentationRevisionId: built.presentationRevisionId, retained });
      } catch (err) {
        failures.push(`${label}: ${err.message}`);
      }
    }
  }
  return { ok: failures.length === 0, checked, failures };
}

// -- Uncertified local preview (F5.3 Slice 6A) -----------------------------
//
// Renders a DRAFT assessment-presentation record into the lesson exactly as
// a certified build would (same F5.2 gates on the instruction-only build,
// same pure renderer, rendered twice and compared, same no-disclosure check),
// WITHOUT requiring a retained record or an approved review. The result is
// for owner review only:
//   - the returned `html` is marked (UNCERTIFIED_PREVIEW_MARKER comment, a
//     visible banner, noindex, and a CSP that blocks third-party scripts and
//     beacons), and generateVariantArtifact refuses marked bytes, so a
//     preview can never be retained, entered in the manifest, or published;
//   - nothing is written here; the CLI writes only to a gitignored scratch
//     directory (scripts/assessment-presentation-review.cjs).
// `projectedPresentationRevisionId` is the id the UNMARKED bytes would have.
// It is informational: no artifact with that id is created.

const PREVIEW_CSP = "default-src 'self' https: data:; style-src 'self' 'unsafe-inline' https:; script-src 'self' 'unsafe-inline'; connect-src 'self'";

function markPreview(html, apId) {
  const headAt = html.indexOf("<head>");
  if (headAt === -1 || html.indexOf("<head>", headAt + 1) !== -1) fail("preview: expected exactly one <head>");
  const head =
    `<head>\n<!-- ${UNCERTIFIED_PREVIEW_MARKER} ${apId}: local owner-review preview. Not certified, never retained, never published. -->\n` +
    `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">\n<meta name="robots" content="noindex,nofollow">`;
  let out = html.slice(0, headAt) + head + html.slice(headAt + "<head>".length);
  const bodyMatch = /<body[^>]*>/.exec(out);
  if (!bodyMatch) fail("preview: no <body>");
  const at = bodyMatch.index + bodyMatch[0].length;
  const banner =
    `\n<div style="position:sticky;top:0;z-index:99999;background:#b00020;color:#fff;font:700 14px/1.4 sans-serif;padding:8px 16px;text-align:center;">` +
    `UNCERTIFIED PREVIEW - owner review only - ${apId}</div>`;
  out = out.slice(0, at) + banner + out.slice(at);
  return out;
}

function buildUncertifiedAssessmentPreview({ slug, variantKey, record, repoRoot = paths.REPO_ROOT, cfg = null }) {
  const config = cfg || configMod.loadConfig(slug);
  if (!config.variants || !config.variants[variantKey]) {
    fail(`lesson "${slug}" declares no authored "${variantKey}" variant`);
  }
  if (!record || record.lessonSlug !== slug) fail(`preview: the draft record does not belong to lesson "${slug}"`);
  // The instruction-only build: every F5.2 gate, and no configured binding.
  // Its explicit revision provenance is the draft record's revision.
  const { assessmentPresentationRevisionId: _bound, ...rest } = config.variants[variantKey];
  const unbound = { ...rest, assessmentRevisionId: record.assessmentRevisionId };
  const instructionCfg = { ...config, variants: { ...config.variants, [variantKey]: unbound } };
  const built = buildAuthoredVariant({ slug, variantKey, repoRoot, cfg: instructionCfg });

  const canonicalPayload = assessmentPresentation.loadCanonicalPayload(record.assessmentRevisionId, { repoRoot });
  const apId = assessmentPresentation.assessmentPresentationRevisionIdFor(record);
  const render = () =>
    presentationRender.renderAssessmentPresentation(built.bytes, {
      record,
      assessmentPresentationRevisionId: apId,
      canonicalPayload,
    });
  const a = render();
  const b = render();
  if (a.html !== b.html) fail("assessment-presentation rendering is not deterministic");

  const canonicalRelocated = relocateHtml(
    buildV2(config, readUnder(repoRoot, config.canonicalSource, "lesson-sources"), config.generatedNotice.v2, "canonical source"),
  ).html;
  invariance.assertNoDisclosure(canonicalRelocated, a.html, [variantKey, path.basename(config.variants[variantKey].source)]);

  const html = markPreview(a.html, apId);
  if (markPreview(b.html, apId) !== html) fail("preview marking is not deterministic");
  return {
    lessonSlug: slug,
    variantKey,
    assessmentPresentationRevisionId: apId,
    instructionPresentationRevisionId: built.presentationRevisionId,
    projectedPresentationRevisionId: identity.computePresentationRevisionId(a.html),
    unmarkedSha256: sha256Hex(a.html),
    binding: a.binding,
    html,
  };
}

module.exports = {
  ASSESSMENT_PAYLOAD_DIR,
  LEGACY_R1_UNBOUND_REVISIONS,
  neutralNotice,
  buildVariantArtifact,
  buildAuthoredVariant,
  generateAuthoredVariant,
  checkAuthoredVariants,
  loadAssessmentPayloads,
  buildUncertifiedAssessmentPreview,
};
