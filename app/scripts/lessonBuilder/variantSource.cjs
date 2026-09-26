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
 *     every committed payload the canonical quiz is faithful to;
 *   - built twice and required to be byte-identical (determinism).
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
const identity = require("./variantIdentity.cjs");
const manifestMod = require("./variantManifest.cjs");
const { generateVariantArtifact } = require("./variantBuild.cjs");
const { relocateHtml } = require("./variantLinks.cjs");
const invariance = require("./variantInvariance.cjs");
const { sha256Hex } = require("./hash.cjs");

const ASSESSMENT_PAYLOAD_DIR = path.join("platform", "functions", "src", "scripts", "assessments");

function fail(message) {
  throw new Error(`[variant-source] ${message}`);
}

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

function assertAssessmentIdentity(slug, canonicalV2, variantHtml, assessmentPayloads) {
  const canonicalQuiz = fidelity.extractCanonicalQuiz(canonicalV2, slug);
  const variantQuiz = fidelity.extractCanonicalQuiz(variantHtml, slug);
  if (JSON.stringify(canonicalQuiz) !== JSON.stringify(variantQuiz)) {
    fail("variant quiz differs from the canonical quiz");
  }
  const faithful = (assessmentPayloads || []).filter(
    (p) => fidelity.checkFidelity(slug, p.payload, canonicalQuiz).length === 0,
  );
  if (faithful.length === 0) {
    fail(`no committed assessment payload is faithful to the canonical quiz for "${slug}"; a variant cannot be bound to an assessment revision`);
  }
  for (const p of faithful) {
    const problems = fidelity.checkFidelity(slug, p.payload, variantQuiz);
    if (problems.length > 0) fail(`variant quiz is not faithful to ${p.name}:\n${problems.join("\n")}`);
  }
  return faithful.map((p) => p.name);
}

// Pure build + gate. Inputs are bytes and an already-loaded config, so the
// whole pipeline is testable against synthetic fixtures.
function buildVariantArtifact({ cfg, variantKey, canonicalSourceBytes, variantSourceBytes, assessmentPayloads }) {
  configMod.validateConfigShape(cfg, cfg.slug);
  if (!cfg.variants || !cfg.variants[variantKey]) {
    fail(`lesson "${cfg.slug}" declares no authored "${variantKey}" variant`);
  }
  const variantConfig = cfg.variants[variantKey];
  identity.assertValidLessonSlugForVariant(cfg.slug);

  const canonicalV2 = buildV2(cfg, canonicalSourceBytes, cfg.generatedNotice.v2, "canonical source");
  const first = renderVariant(cfg, variantSourceBytes);
  const second = renderVariant(cfg, variantSourceBytes);
  if (first.html !== second.html) fail("variant build is not deterministic");
  const variantHtml = first.html;

  const canonicalRelocated = relocateHtml(canonicalV2).html;
  const canonicalBody = stripNotice(canonicalRelocated, cfg.generatedNotice.v2, "canonical");
  const variantBody = stripNotice(variantHtml, neutralNotice(cfg.slug), "variant");

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
  const assessmentRevisions = assertAssessmentIdentity(cfg.slug, canonicalV2, variantHtml, assessmentPayloads);

  const presentationRevisionId = identity.computePresentationRevisionId(variantHtml);
  return {
    lessonSlug: cfg.slug,
    variantKey,
    bytes: variantHtml,
    sha256: sha256Hex(variantHtml),
    presentationRevisionId,
    path: identity.variantRelativeOutputPath(cfg.slug, presentationRevisionId),
    relocatedReferences: first.rewritten,
    assessmentRevisions,
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

function loadAssessmentPayloads(slug, repoRoot = paths.REPO_ROOT) {
  const dir = path.join(repoRoot, ASSESSMENT_PAYLOAD_DIR);
  if (!fs.existsSync(dir)) return [];
  const re = new RegExp(`^${slug.replace(/-/g, "\\-")}\\.r[0-9]+\\.json$`);
  return fs
    .readdirSync(dir)
    .filter((f) => re.test(f))
    .sort()
    .map((f) => ({ name: f, payload: JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) }));
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
        const retained = entries.some(
          (e) => e.lessonSlug === cfg.slug && e.variantKey === variantKey && e.presentationRevisionId === built.presentationRevisionId,
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

module.exports = {
  ASSESSMENT_PAYLOAD_DIR,
  neutralNotice,
  buildVariantArtifact,
  buildAuthoredVariant,
  generateAuthoredVariant,
  checkAuthoredVariants,
  loadAssessmentPayloads,
};
