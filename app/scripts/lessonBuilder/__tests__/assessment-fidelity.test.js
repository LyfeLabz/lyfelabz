/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * Sprint 28 Phase 5B - Assessment answer-key fidelity contract.
 *
 * Durable, systematic guard that every assignable lesson has committed
 * assessment revision payloads (`<slug>.r<N>.json`) and that the lesson's
 * canonical quiz faithfully transcribes the revision it represents. It exists
 * so a future lesson edit cannot silently desynchronize the canonical quiz
 * from the deployed answer key.
 *
 * This is NOT a file-equals-itself check. For each lesson the expected
 * assessment semantics are re-derived INDEPENDENTLY from the canonical
 * source (`lesson-sources/lesson_<slug>.html`) by statically parsing the
 * quiz literal (assessmentFidelity.extractCanonicalQuiz, acorn AST, no code
 * execution) and are then compared field-by-field against the committed
 * payload.
 *
 * F5.3 Slice 9A (addendum section 21.3): each committed payload is the
 * authority for its own revision. Every committed revision is checked for
 * schema and identity on its own; the canonical source must be faithful to
 * the ONE revision its lesson config declares (canonicalAssessmentRevisionId,
 * or r1 while r1 is the only committed revision). Other committed revisions
 * are never compared with the mutable source literal; Slice 9B adds their
 * faithful renditions.
 *
 * Coverage is derived from the canonical sources on disk, so a newly added
 * assignable lesson that lacks a payload, or a payload that drifts from its
 * quiz, fails here.
 *
 * The payload SCHEMA mirrored by assertSchemaValid matches the production
 * deployment validator in
 * platform/functions/src/assessments/assessment-deployment.ts
 * (validateDeploymentInput), which remains the deployment-time authority
 * (Sprint 29). Deployment is out of scope here.
 */

const fs = require("fs");
const path = require("path");
const F = require("../assessmentFidelity.cjs");
const R = require("../assessmentRevisions.cjs");
const configMod = require("../config.cjs");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const SRC_DIR = path.join(ROOT, "lesson-sources");

// The assignable curriculum surface: every canonical lesson source. Sprint 28
// Phase 5A made all 49 assignable lessons v2, each with a canonical source
// here, and Phase 5B authors an answer key for each.
const SLUGS = fs
  .readdirSync(SRC_DIR)
  .filter((f) => /^lesson_.+\.html$/.test(f))
  .map((f) => f.replace(/^lesson_/, "").replace(/\.html$/, ""))
  .sort();

// Every committed revision, discovered and identity-checked once.
const DISCOVERED = R.discoverRevisions({ repoRoot: ROOT });

function readSource(slug) {
  return fs.readFileSync(path.join(SRC_DIR, `lesson_${slug}.html`), "utf8");
}

describe("Phase 5B assessment coverage", () => {
  test("the assignable curriculum surface is the expected 49 lessons", () => {
    expect(SLUGS.length).toBe(49);
    // Anchor the four original Category A lessons are present.
    for (const anchor of ["earths-layers", "plate-tectonics", "water-cycle", "earthquakes"]) {
      expect(SLUGS).toContain(anchor);
    }
  });

  test("every committed payload has a consistent revision identity", () => {
    expect(DISCOVERED.failures).toEqual([]);
  });

  test("every assignable lesson has at least one committed revision", () => {
    const missing = SLUGS.filter((slug) => !DISCOVERED.bySlug.has(slug));
    expect(missing).toEqual([]);
  });

  test("no orphan payload exists without a matching assignable lesson", () => {
    const orphans = [...DISCOVERED.bySlug.keys()].filter((slug) => !SLUGS.includes(slug));
    expect(orphans).toEqual([]);
  });

  test("every lesson commits r1; Earth's Layers, Water Cycle, and Renewable Resources also commit r2", () => {
    const expected = SLUGS.flatMap((slug) => (["earths-layers", "water-cycle", "renewable-and-nonrenewable-resources"].includes(slug) ? [`${slug}.r1.json`, `${slug}.r2.json`] : [`${slug}.r1.json`]));
    expect(DISCOVERED.revisions.map((e) => e.file)).toEqual(expected);
  });
});

describe.each(DISCOVERED.revisions.map((e) => [e.file, e]))("committed revision: %s", (_file, entry) => {
  const { payload } = entry;

  test("payload is schema-valid (production schema mirror)", () => {
    expect(F.assertSchemaValid(payload, entry.slug)).toEqual([]);
  });

  test("payload identity matches its file name", () => {
    expect(payload.activityId).toBe(entry.slug);
    expect(payload.revisionOrdinal).toBe(entry.revisionOrdinal);
    expect(entry.assessmentRevisionId).toBe(`assessment_${entry.slug}__r${entry.revisionOrdinal}`);
    expect(payload.schemaVersion).toBe(1);
    expect(payload.itemOrderingRule).toBe("authoredOrder");
  });
});

describe.each(SLUGS)("assessment fidelity: %s", (slug) => {
  const html = readSource(slug);
  const cfg = configMod.loadConfig(slug);
  const committed = DISCOVERED.bySlug.get(slug) || [];
  const { revision, quiz, problems } = F.checkCanonicalRevisionFidelity(cfg, html, committed);
  const payload = revision.payload;

  test("the canonical lesson resolves to one committed revision", () => {
    expect(committed).toContain(revision);
    expect(revision.assessmentRevisionId).toBe(cfg.canonicalAssessmentRevisionId || `assessment_${slug}__r1`);
  });

  test("payload question count equals the canonical quiz count", () => {
    expect(payload.items.length).toBe(quiz.questions.length);
  });

  test("canonical revision transcribes the canonical quiz exactly (order, wording, choices, correct answer, explanation)", () => {
    // Independent re-derivation of expected semantics from the canonical
    // source, compared field-by-field against the committed payload.
    expect(problems).toEqual([]);
  });

  test("re-authoring from canonical reproduces the canonical revision exactly", () => {
    // The transform is deterministic; the canonical revision must equal a
    // fresh build from the same canonical quiz (with the payload's own
    // publishedBy and revision ordinal).
    const rebuilt = F.buildPayload(slug, quiz, payload.publishedBy, revision.revisionOrdinal);
    expect(rebuilt).toEqual(payload);
  });
});
