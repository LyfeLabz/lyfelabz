/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * Sprint 28 Phase 5B - Assessment answer-key fidelity contract.
 *
 * Durable, systematic guard that every assignable lesson has an assessment
 * revision payload (`<slug>.r1.json`) that faithfully transcribes that
 * lesson's canonical quiz. It exists so a future lesson edit cannot silently
 * desynchronize the canonical quiz from the deployed answer key.
 *
 * This is NOT a file-equals-itself check. For each lesson the expected
 * assessment semantics are re-derived INDEPENDENTLY from the canonical
 * source (`lesson-sources/lesson_<slug>.html`) by statically parsing the
 * quiz literal (assessmentFidelity.extractCanonicalQuiz, acorn AST, no code
 * execution) and are then compared field-by-field against the committed
 * payload. The canonical lesson quiz is the single authority.
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

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const SRC_DIR = path.join(ROOT, "lesson-sources");
const PAYLOAD_DIR = path.join(
  ROOT,
  "platform",
  "functions",
  "src",
  "scripts",
  "assessments",
);

// The assignable curriculum surface: every canonical lesson source. Sprint 28
// Phase 5A made all 49 assignable lessons v2, each with a canonical source
// here, and Phase 5B authors an answer key for each.
const SLUGS = fs
  .readdirSync(SRC_DIR)
  .filter((f) => /^lesson_.+\.html$/.test(f))
  .map((f) => f.replace(/^lesson_/, "").replace(/\.html$/, ""))
  .sort();

function readSource(slug) {
  return fs.readFileSync(path.join(SRC_DIR, `lesson_${slug}.html`), "utf8");
}
function payloadPath(slug) {
  return path.join(PAYLOAD_DIR, `${slug}.r1.json`);
}

describe("Phase 5B assessment coverage", () => {
  test("the assignable curriculum surface is the expected 49 lessons", () => {
    expect(SLUGS.length).toBe(49);
    // Anchor the four original Category A lessons are present.
    for (const anchor of ["earths-layers", "plate-tectonics", "water-cycle", "earthquakes"]) {
      expect(SLUGS).toContain(anchor);
    }
  });

  test("every assignable lesson has an authored answer-key payload", () => {
    const missing = SLUGS.filter((slug) => !fs.existsSync(payloadPath(slug)));
    expect(missing).toEqual([]);
  });

  test("no orphan payload exists without a matching assignable lesson", () => {
    const payloadSlugs = fs
      .readdirSync(PAYLOAD_DIR)
      .filter((f) => f.endsWith(".r1.json"))
      .map((f) => f.replace(/\.r1\.json$/, ""))
      .sort();
    const orphans = payloadSlugs.filter((slug) => !SLUGS.includes(slug));
    expect(orphans).toEqual([]);
  });
});

describe.each(SLUGS)("assessment fidelity: %s", (slug) => {
  const html = readSource(slug);
  const quiz = F.extractCanonicalQuiz(html, slug);
  const payload = JSON.parse(fs.readFileSync(payloadPath(slug), "utf8"));

  test("payload is schema-valid (production schema mirror)", () => {
    expect(F.assertSchemaValid(payload, slug)).toEqual([]);
  });

  test("payload identity matches the lesson slug", () => {
    expect(payload.activityId).toBe(slug);
    expect(payload.revisionOrdinal).toBe(1);
    expect(payload.schemaVersion).toBe(1);
    expect(payload.itemOrderingRule).toBe("authoredOrder");
  });

  test("payload question count equals the canonical quiz count", () => {
    expect(payload.items.length).toBe(quiz.questions.length);
  });

  test("payload transcribes the canonical quiz exactly (order, wording, choices, correct answer, explanation)", () => {
    // Independent re-derivation of expected semantics from the canonical
    // source, compared field-by-field against the committed payload.
    expect(F.checkFidelity(slug, payload, quiz)).toEqual([]);
  });

  test("re-authoring from canonical reproduces the committed payload byte-for-byte", () => {
    // The transform is deterministic; a committed payload must equal a fresh
    // build from the same canonical quiz (with the payload's own publishedBy).
    const rebuilt = F.buildPayload(slug, quiz, payload.publishedBy);
    expect(rebuilt).toEqual(payload);
  });
});
