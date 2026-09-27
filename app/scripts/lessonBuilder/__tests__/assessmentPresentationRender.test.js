/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * F5.3 Slice 4 - build-time rendering of a certified assessment presentation
 * into a lesson artifact, and its integration with the authored-variant
 * build. Synthetic fixtures only (fixtures/assessmentPresentationFixtures.js);
 * the cross-lesson check renders canonical-language presentations derived
 * mechanically from each lesson's own canonical quiz, in memory, and writes
 * nothing.
 */

const fs = require("fs");
const path = require("path");
const acorn = require("acorn");

const AP = require("../assessmentPresentation.cjs");
const R = require("../assessmentPresentationRender.cjs");
const fidelity = require("../assessmentFidelity.cjs");
const variantSource = require("../variantSource.cjs");
const manifestMod = require("../variantManifest.cjs");
const F = require("./fixtures/assessmentPresentationFixtures");

let roots = [];
afterEach(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  roots = [];
});
function repo(payload) {
  const r = F.makeRepo(payload);
  roots.push(r);
  return r;
}

function render(record, html = F.lessonHtml(), payload = F.canonicalPayload()) {
  return R.renderAssessmentPresentation(html, {
    record,
    assessmentPresentationRevisionId: AP.assessmentPresentationRevisionIdFor(record),
    canonicalPayload: payload,
  });
}

// What a student's click submits: the canonical optionId the page's binding
// attaches to the displayed choice (the runtime mapping, entry.ts).
function submitted(html, itemIndex, displayIndex) {
  return R.readBindingBlock(html).items[itemIndex].optionIds[displayIndex];
}

function renderedQuiz(html) {
  return fidelity.extractCanonicalQuiz(html, F.SLUG).questions;
}

describe("rendering choices with canonical option identity", () => {
  test("three displayed choices: omitted distractor not rendered, identity preserved", () => {
    const payload = F.canonicalPayload();
    const record = F.adaptedThreeChoice(payload);
    const { html, binding } = render(record);
    const quiz = renderedQuiz(html);
    record.items.forEach((item, i) => {
      expect(quiz[i].options).toEqual(item.displayedOptions.map((o) => o.text));
      expect(binding.items[i]).toEqual({ itemId: item.itemId, optionIds: item.displayedOptions.map((o) => o.optionId) });
      const omittedText = `Simple ${item.omittedOptions[0].optionId} for ${i + 1}`;
      expect(quiz[i].options).not.toContain(omittedText);
      // Clicking the displayed correct choice submits the canonical correct optionId.
      expect(submitted(html, i, quiz[i].correct)).toBe(payload.items[i].correctOptionId);
    });
  });

  test("four reordered choices: display position never implies identity", () => {
    const payload = F.canonicalPayload();
    const record = F.adaptedFourChoiceReordered(payload);
    const { html } = render(record);
    const quiz = renderedQuiz(html);
    payload.items.forEach((item, i) => {
      expect(quiz[i].options).toHaveLength(4);
      for (let d = 0; d < 4; d += 1) {
        const id = submitted(html, i, d);
        expect(id).not.toBe(F.IDS[d]); // rotated: letter at position d is never the identity
        expect(quiz[i].options[d]).toBe(`Simple ${id} for ${i + 1}`);
      }
      expect(submitted(html, i, quiz[i].correct)).toBe(item.correctOptionId);
    });
  });

  test("canonical language + three choices renders canonical text for the displayed subset", () => {
    const payload = F.canonicalPayload();
    const record = F.canonicalThreeChoice(payload);
    const { html } = render(record);
    const quiz = renderedQuiz(html);
    quiz.forEach((q, i) => {
      expect(q.q).toBe(payload.items[i].stem);
      expect(q.options).toHaveLength(3);
      expect(q.explanation).toBe(payload.items[i].explanation);
    });
  });
});

describe("rendering stems, directions, feedback, and Show Your Thinking", () => {
  test("adapted stem, directions, feedback, and Show Your Thinking all render", () => {
    const record = F.adaptedThreeChoice();
    const { html } = render(record);
    const quiz = renderedQuiz(html);
    expect(quiz[0].q).toBe("Simple question 1?");
    expect(quiz[0].explanation).toBe("Simple feedback 1.");
    expect(html).toContain('<p class="section-desc">Pick the best answer for each question.</p>');
    expect(html).not.toContain(F.CANONICAL_DIRECTIONS);
    expect(html).toContain('<p class="think-prompt">Tell how heat from the core makes the mantle move by <strong>convection</strong>.</p>');
    expect(html).toContain('aria-label="Tell how heat from the core makes the mantle move by convection."');
    expect(html).toContain(F.ADAPTED_SYT.modelAnswer);
    expect(html).not.toContain(F.CANONICAL_MODEL);
    // Show Your Thinking V2 wiring is untouched.
    expect(html).toContain('<textarea class="think-input" id="fx-thinking"');
    expect(html).toContain('<div class="think-model" id="fx-think-model">');
  });

  test("null fields keep canonical content: canonical explanation, directions, and prompt", () => {
    const payload = F.canonicalPayload();
    const record = F.canonicalThreeChoice(payload); // directions, feedback, SYT all null
    const { html } = render(record);
    expect(html).toContain(`<p class="section-desc">${F.CANONICAL_DIRECTIONS}</p>`);
    expect(html).toContain(F.CANONICAL_MODEL);
    expect(html).toContain("drives <strong>convection</strong> in the mantle.");
    const reordered = F.adaptedFourChoiceReordered(payload); // feedback null, SYT adapted
    expect(renderedQuiz(render(reordered).html)[3].explanation).toBe(payload.items[3].explanation);
  });

  test("text is HTML-escaped so presentation wording cannot inject markup", () => {
    const record = F.adaptedThreeChoice();
    record.items[0].stem = 'Which is < 5 & "odd"?';
    const { html } = render(record);
    expect(renderedQuiz(html)[0].q).toBe("Which is &lt; 5 &amp; &quot;odd&quot;?");
    expect(html).not.toContain('Which is < 5');
  });

  test("rendering is deterministic", () => {
    expect(render(F.adaptedThreeChoice()).html).toBe(render(F.adaptedThreeChoice()).html);
  });
});

describe("student HTML carries no review, omission, or new correctness data", () => {
  test("binding block holds only identity, and nothing review-only reaches the page", () => {
    const record = F.adaptedThreeChoice();
    const { html } = render(record);
    const block = R.readBindingBlock(html);
    expect(Object.keys(block).sort()).toEqual(["assessmentPresentationRevisionId", "assessmentRevisionId", "items", "lessonSlug", "schemaVersion"]);
    for (const item of block.items) expect(Object.keys(item).sort()).toEqual(["itemId", "optionIds"]);
    for (const needle of ["REVIEW-ONLY", "rationale", "omittedOptions", "traits", "reviewer", "determination", "choiceCount", "correctOptionId", "answerKey"]) {
      expect(html).not.toContain(needle);
    }
  });

  test("the only correctness in the page is the lesson literal's pre-existing correct index (D7), not more", () => {
    const canonicalHtml = F.lessonHtml();
    const { html } = render(F.adaptedThreeChoice());
    const count = (s) => (s.match(/"?correct"?\s*:/g) || []).length;
    expect(count(html)).toBe(count(canonicalHtml));
    expect(R.readBindingBlock(html).items.every((it) => !("correct" in it))).toBe(true);
  });

  test("the rendered page still parses and exposes exactly one binding block", () => {
    const { html } = render(F.adaptedThreeChoice());
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    for (const [, attrs, body] of scripts) {
      if (/application\/json/.test(attrs)) JSON.parse(body);
      else acorn.parse(body, { ecmaVersion: "latest" });
    }
    expect(html.match(/id="lyfelabz-assessment-presentation"/g)).toHaveLength(1);
  });
});

describe("fail-closed rendering", () => {
  test.each([
    ["an invalid record (duplicate displayed optionId)", (r) => { r.items[0].displayedOptions[1].optionId = r.items[0].displayedOptions[0].optionId; }, "is displayed more than once"],
    ["an invalid record (missing canonical option identity)", (r) => { delete r.items[0].displayedOptions[0].optionId; }, "is not an option of item"],
    ["an invalid record (malformed displayed mapping)", (r) => { r.items[0].displayedOptions = "C,A,D"; }, "displayedOptions must be an array"],
    ["incomplete item coverage", (r) => { r.items.pop(); }, "items are incomplete"],
  ])("refuses %s", (_label, mutate, message) => {
    const record = F.adaptedThreeChoice();
    mutate(record);
    expect(() => R.renderAssessmentPresentation(F.lessonHtml(), {
      record,
      assessmentPresentationRevisionId: `ap${"0".repeat(64)}`,
      canonicalPayload: F.canonicalPayload(),
    })).toThrow(message);
  });

  test("refuses a record whose content does not match the given id", () => {
    const record = F.adaptedThreeChoice();
    expect(() => R.renderAssessmentPresentation(F.lessonHtml(), {
      record,
      assessmentPresentationRevisionId: `ap${"0".repeat(64)}`,
      canonicalPayload: F.canonicalPayload(),
    })).toThrow("record content hashes to");
  });

  test("refuses an unsupported item type", () => {
    const payload = F.canonicalPayload();
    payload.items[2].itemType = "multiSelect";
    expect(() => render(F.adaptedThreeChoice(F.canonicalPayload()), F.lessonHtml(), payload)).toThrow('unsupported itemType "multiSelect"');
  });

  test("refuses a lesson whose quiz is not the presentation's canonical revision (item mismatch)", () => {
    const other = F.lessonHtml({ literal: F.quizLiteral().replace("Synthetic question 4?", "A different question 4?") });
    expect(() => render(F.adaptedThreeChoice(), other)).toThrow("lesson quiz is not the canonical quiz of assessment_fixture-lesson__r1");
  });

  test("refuses an unsupported quiz literal shape", () => {
    const literal = F.quizLiteral().replace('"correct": 0,', '"correct": 0,\n    "visual": "diagram-1",');
    expect(() => render(F.adaptedThreeChoice(), F.lessonHtml({ literal }))).toThrow("unsupported literal shape");
  });

  test("refuses an adapted Show Your Thinking on a lesson without the think-box anchors", () => {
    expect(() => render(F.adaptedThreeChoice(), F.lessonHtml({ thinkBox: false }))).toThrow("lesson has 0 think-prompt anchor(s)");
    // A canonical-language presentation needs no Show Your Thinking anchors.
    expect(() => render(F.canonicalThreeChoice(), F.lessonHtml({ thinkBox: false }))).not.toThrow();
  });

  test("refuses a page that already carries a binding block", () => {
    const { html } = render(F.adaptedThreeChoice());
    expect(() => render(F.adaptedThreeChoice(), html)).toThrow("already carries an assessment-presentation binding block");
  });
});

describe("certified rendering (the one Slice 3 check)", () => {
  function certified(root, apId, lessonSlug = F.SLUG) {
    return R.renderCertifiedAssessmentPresentation(F.lessonHtml(), { assessmentPresentationRevisionId: apId, lessonSlug, repoRoot: root });
  }

  test("a retained, valid, approved presentation renders", () => {
    const root = repo();
    const apId = F.retain(root, F.adaptedThreeChoice());
    const { binding } = certified(root, apId);
    expect(binding.assessmentPresentationRevisionId).toBe(apId);
    expect(binding.assessmentRevisionId).toBe(F.REVISION_ID);
  });

  test.each([
    ["unknown presentation id", (root) => `ap${"e".repeat(64)}`, "is not retained"],
    ["missing certification", (root) => F.retain(root, F.adaptedThreeChoice(), { review: false }), "has no human certification review record"],
    ["unapproved certification", (root) => F.retain(root, F.adaptedThreeChoice(), { reviewMutate: (v) => { v.determination = "rejected"; } }), 'is not approved (determination "rejected")'],
    ["hash/content mismatch", (root) => {
      const record = F.adaptedThreeChoice();
      const wrong = `ap${"f".repeat(64)}`;
      F.retain(root, record, { fileName: `${wrong}.json`, review: false });
      return wrong;
    }, "content hashes to"],
  ])("refuses %s", (_label, arrange, message) => {
    const root = repo();
    const apId = arrange(root);
    expect(() => certified(root, apId)).toThrow(message);
  });

  test("refuses a lesson mismatch", () => {
    const root = repo();
    const apId = F.retain(root, F.adaptedThreeChoice());
    expect(() => certified(root, apId, "other-lesson")).toThrow('belongs to lesson "fixture-lesson", not "other-lesson"');
  });

  test("refuses an assessment revision mismatch (payload for another revision)", () => {
    const payload = F.canonicalPayload();
    payload.items[0].correctOptionId = "B"; // the committed revision no longer matches the lesson quiz
    const root = repo(payload);
    const record = F.adaptedThreeChoice(F.canonicalPayload());
    const apId = AP.assessmentPresentationRevisionIdFor(record);
    fs.mkdirSync(AP.retainedRecordDir(root), { recursive: true });
    fs.writeFileSync(path.join(AP.retainedRecordDir(root), `${apId}.json`), AP.serializeRecord(record));
    expect(() => certified(root, apId)).toThrow("omits the canonical correct option");
  });
});

describe("authored-variant build integration", () => {
  const KEY = "reading-adapted";
  function cfg(apId) {
    return {
      slug: F.SLUG,
      canonicalSource: `lesson-sources/lesson_${F.SLUG}.html`,
      outputs: { v1: `lesson_${F.SLUG}.html`, v2: `app/lessons/lesson_${F.SLUG}.html` },
      generatedNotice: {
        v1: `<!--\nGENERATED FILE. DO NOT EDIT DIRECTLY.\nCanonical source: lesson-sources/lesson_${F.SLUG}.html\nBuild target: v1\n-->\n`,
        v2: `<!--\nGENERATED FILE. DO NOT EDIT DIRECTLY.\nCanonical source: lesson-sources/lesson_${F.SLUG}.html\nBuild target: v2\n-->\n`,
      },
      requiredLabels: { v1Only: ["legacy-form"], v2Only: ["platform-hook"] },
      expectedContexts: { "legacy-form": "html", "platform-hook": "js" },
      v2ProhibitedSignatures: ["LEGACY_ONLY"],
      v1RequiredSignatures: ["LEGACY_ONLY"],
      sharedRequiredSignatures: ["var fxQuizQuestions"],
      equivalenceExclusions: {},
      variants: {
        [KEY]: {
          source: `lesson-sources/variants/${F.SLUG}.${KEY}.html`,
          adaptableSections: ["explore"],
          adaptableSelectors: ["p"],
          lockedSelectors: [],
          ...(apId ? { assessmentPresentationRevisionId: apId } : {}),
        },
      },
    };
  }
  function build(root, apId, variantBytes = F.lessonHtml()) {
    return variantSource.buildVariantArtifact({
      cfg: cfg(apId),
      variantKey: KEY,
      canonicalSourceBytes: F.lessonHtml(),
      variantSourceBytes: variantBytes,
      assessmentPayloads: [{ name: `${F.SLUG}.r1.json`, payload: F.canonicalPayload() }],
      repoRoot: root,
    });
  }

  test("an unbound variant keeps the canonical quiz and carries no binding (F5.2 behavior)", () => {
    const root = repo();
    const built = build(root, undefined);
    expect(built.assessmentBinding).toBeNull();
    expect(R.readBindingBlock(built.bytes)).toBeNull();
  });

  test("a bound variant renders the certified presentation, gets a new content-addressed id, and records the binding", () => {
    const root = repo();
    const apId = F.retain(root, F.adaptedThreeChoice());
    const unbound = build(root, undefined);
    const bound = build(root, apId);
    expect(bound.presentationRevisionId).not.toBe(unbound.presentationRevisionId);
    expect(bound.presentationRevisionId).toBe(`pr${bound.sha256}`);
    expect(bound.assessmentBinding).toEqual({ assessmentRevisionId: F.REVISION_ID, assessmentPresentationRevisionId: apId });
    expect(R.readBindingBlock(bound.bytes).assessmentPresentationRevisionId).toBe(apId);
    expect(build(root, apId).bytes).toBe(bound.bytes); // deterministic
    expect(bound.bytes).not.toMatch(/reading-adapted|REVIEW-ONLY/);

    const { generateVariantArtifact } = require("../variantBuild.cjs");
    const out = generateVariantArtifact({
      lessonSlug: F.SLUG,
      variantKey: KEY,
      bytes: bound.bytes,
      publishedAt: "2026-09-28T00:00:00.000Z",
      repoRoot: root,
      assessmentBinding: bound.assessmentBinding,
    });
    expect(out.appended).toBe(true);
    const entry = manifestMod.readManifest(root)[0];
    expect(entry.assessmentPresentationRevisionId).toBe(apId);
    expect(entry.assessmentRevisionId).toBe(F.REVISION_ID);
    expect(manifestMod.verifyRetention({ repoRoot: root })).toEqual({ ok: true, failures: [] });
  });

  test("the instruction gates still run first: a hand-edited quiz in the variant source is refused", () => {
    const root = repo();
    const apId = F.retain(root, F.adaptedThreeChoice());
    const edited = F.lessonHtml().replace("Synthetic question 1?", "Hand edited question 1?");
    expect(() => build(root, apId, edited)).toThrow();
  });

  test("an uncertified binding refuses the build", () => {
    const root = repo();
    const apId = F.retain(root, F.adaptedThreeChoice(), { review: false });
    expect(() => build(root, apId)).toThrow("has no human certification review record");
  });

  test("a malformed configured presentation id is refused by config validation", () => {
    const root = repo();
    expect(() => build(root, "ap123")).toThrow("must be ap<sha256>");
  });
});

describe("real lesson markup compatibility (in memory, canonical text only)", () => {
  // For every generated v2 lesson: derive the payload from the lesson's own
  // canonical quiz and render a canonical-language three-choice presentation
  // (canonical wording, first alphabetical distractor omitted). This authors
  // no adapted wording; it proves the renderer's anchors exist in real lesson
  // output and the rendered page still parses. Nothing is written.
  const lessonsDir = path.join(__dirname, "..", "..", "..", "lessons");
  const files = fs.readdirSync(lessonsDir).filter((f) => /^lesson_.+\.html$/.test(f)).sort();
  const POSITIONS = [0, 1, 2, 1, 2, 0, 2, 0, 1, 2, 1, 0, 1, 2, 0];
  const UNSUPPORTED_LITERAL_LESSONS = ["nature-of-waves"];

  test("covers every generated v2 lesson", () => {
    expect(files.length).toBeGreaterThanOrEqual(49);
  });

  test.each(files)("%s renders a canonical-language three-choice presentation", (file) => {
    const slug = file.slice("lesson_".length, -".html".length);
    const html = fs.readFileSync(path.join(lessonsDir, file), "utf8");
    const payload = fidelity.buildPayload(slug, fidelity.extractCanonicalQuiz(html, slug), "synthetic-compat");
    const record = {
      schemaVersion: 1,
      kind: "lyfelabz.assessmentPresentation",
      lessonSlug: slug,
      assessmentRevisionId: `assessment_${slug}__r1`,
      traits: { language: "canonical", choiceCount: 3 },
      directions: null,
      items: payload.items.map((item, i) => {
        const distractors = item.options.map((o) => o.optionId).filter((id) => id !== item.correctOptionId);
        const [omitted, ...kept] = distractors;
        const shown = kept.map((id) => item.options.find((o) => o.optionId === id));
        shown.splice(POSITIONS[i % POSITIONS.length], 0, item.options.find((o) => o.optionId === item.correctOptionId));
        return {
          itemId: item.itemId,
          stem: item.stem,
          displayedOptions: shown.map((o) => ({ optionId: o.optionId, text: o.text })),
          omittedOptions: [{ optionId: omitted, rationale: "compat" }],
          feedback: null,
        };
      }),
      showYourThinking: null,
    };
    const run = () =>
      R.renderAssessmentPresentation(html, {
        record,
        assessmentPresentationRevisionId: AP.assessmentPresentationRevisionIdFor(record),
        canonicalPayload: payload,
      });
    if (UNSUPPORTED_LITERAL_LESSONS.includes(slug)) {
      // Its quiz literal carries an extra per-question field ("visual"); the
      // renderer refuses it explicitly rather than guess (fail closed).
      expect(run).toThrow("unsupported literal shape");
      return;
    }
    const result = run();
    expect(R.readBindingBlock(result.html).items).toHaveLength(payload.items.length);
    expect(fidelity.extractCanonicalQuiz(result.html, slug).questions.every((q) => q.options.length === 3)).toBe(true);
  });
});
