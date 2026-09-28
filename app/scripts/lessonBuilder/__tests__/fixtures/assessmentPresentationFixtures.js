/* eslint-disable */
"use strict";

/*
 * Synthetic fixtures for F5.3 assessment-presentation tests (Slices 3-4):
 * a lesson-shaped page using the canonical quiz / Show Your Thinking markup
 * shared by the LyfeLabz lessons, its canonical r1 payload, presentation
 * record builders, and an approved certification review. No real lesson or
 * assessment content is used.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const AP = require("../../assessmentPresentation.cjs");
const fidelity = require("../../assessmentFidelity.cjs");

const SLUG = "fixture-lesson";
const REVISION_ID = `assessment_${SLUG}__r1`;
const IDS = ["A", "B", "C", "D"];
const CANONICAL_CORRECT = "ACBDBADCAB"; // A3 B3 C2 D2: meets the position standard
const THREE_CHOICE_POSITIONS = [0, 1, 2, 1, 2, 0, 2, 0, 1, 2];
const CANONICAL_DIRECTIONS = "Ten questions. Answer every question, then submit.";
const CANONICAL_PROMPT_HTML = "Explain how heat from the core drives <strong>convection</strong> in the mantle.";
const CANONICAL_MODEL = "Canonical model answer: heat rises, the mantle flows in convection currents, and plates move.";

function quizLiteral(prefix = "fx") {
  const qs = CANONICAL_CORRECT.split("").map((c, i) => ({
    q: `Synthetic question ${i + 1}?`,
    options: IDS.map((id) => `Option ${id} of q${i + 1}`),
    correct: IDS.indexOf(c),
    explanation: `Because ${c} for q${i + 1}.`,
  }));
  return `var ${prefix}QuizQuestions = ${JSON.stringify(qs, null, 2)};`;
}

// A page with the canonical quiz and Show Your Thinking anchors. `markers`
// adds the V1/V2 markers the lesson builder config requires.
function lessonHtml({ prefix = "fx", markers = true, thinkBox = true, literal = quizLiteral(prefix) } = {}) {
  const v1 = markers
    ? `<!-- LYFELABZ:V1-ONLY:BEGIN legacy-form -->\n<div class="legacy">LEGACY_ONLY classroom form</div>\n<!-- LYFELABZ:V1-ONLY:END legacy-form -->\n`
    : "";
  const v2 = markers ? `/* LYFELABZ:V2-ONLY:BEGIN platform-hook */\nwindow.fxPlatform = true;\n/* LYFELABZ:V2-ONLY:END platform-hook */\n` : "";
  const think = thinkBox
    ? `    <div class="think-box" id="${prefix}-think">
      <div class="think-eyebrow">Show Your Thinking</div>
      <p class="think-prompt">${CANONICAL_PROMPT_HTML}</p>
      <textarea class="think-input" id="${prefix}-thinking" placeholder="Write your explanation here..." aria-label="Explain how heat from the core drives convection"></textarea>
      <div class="think-model" id="${prefix}-think-model">
        <span class="tm-label">One strong way to say it</span>
        ${CANONICAL_MODEL}
      </div>
    </div>
`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>LyfeLabz | Fixture Lesson</title>
</head>
<body>
${v1}<section id="explore">
  <div class="container">
    <h2 class="section-title">Inside the Fixture</h2>
    <p class="section-desc">The fixture has three parts that depend on each other.</p>
  </div>
</section>
<section id="quiz" class="quiz-section">
  <div class="container">
    <h2 class="section-title">Check Your Understanding</h2>
    <p class="section-desc">${CANONICAL_DIRECTIONS}</p>
    <div id="${prefix}-quiz-questions"></div>
${think}  </div>
</section>
<script>
${literal}
${v2}</script>
</body>
</html>
`;
}

function canonicalPayload(html = lessonHtml()) {
  return fidelity.buildPayload(SLUG, fidelity.extractCanonicalQuiz(html, SLUG), "synthetic-fixture", 1);
}

function recordBase(traits) {
  return {
    schemaVersion: 1,
    kind: "lyfelabz.assessmentPresentation",
    lessonSlug: SLUG,
    assessmentRevisionId: REVISION_ID,
    traits,
    directions: null,
    items: [],
    showYourThinking: null,
  };
}

const ADAPTED_SYT = {
  prompt: "Tell how heat from the core makes the mantle move by convection.",
  modelAnswer: "Adapted model: hot rock rises, cool rock sinks, and this convection moves the plates.",
  requiredTerms: ["convection"],
};

// Adapted language, three choices: correct + two distractors, the first
// alphabetical distractor deliberately omitted, correct at a designed display
// position.
function adaptedThreeChoice(payload = canonicalPayload()) {
  const r = recordBase({ language: "adapted", choiceCount: 3 });
  r.directions = "Pick the best answer for each question.";
  r.items = payload.items.map((item, i) => {
    const distractors = IDS.filter((id) => id !== item.correctOptionId);
    const [omitted, ...kept] = distractors;
    const shown = kept.map((id) => ({ optionId: id, text: `Simple ${id} for ${i + 1}` }));
    shown.splice(THREE_CHOICE_POSITIONS[i], 0, { optionId: item.correctOptionId, text: `Simple ${item.correctOptionId} for ${i + 1}` });
    return {
      itemId: item.itemId,
      stem: `Simple question ${i + 1}?`,
      displayedOptions: shown,
      omittedOptions: [{ optionId: omitted, rationale: `REVIEW-ONLY rationale ${i + 1}: distractor ${omitted} repeats another misconception.` }],
      feedback: `Simple feedback ${i + 1}.`,
    };
  });
  r.showYourThinking = ADAPTED_SYT;
  return r;
}

// Adapted language, four choices, every item's options rotated by one so
// display position never equals the canonical letter.
function adaptedFourChoiceReordered(payload = canonicalPayload()) {
  const r = recordBase({ language: "adapted", choiceCount: 4 });
  r.items = payload.items.map((item, i) => ({
    itemId: item.itemId,
    stem: `Simple question ${i + 1}?`,
    displayedOptions: [...IDS.slice(3), ...IDS.slice(0, 3)].map((id) => ({ optionId: id, text: `Simple ${id} for ${i + 1}` })),
    omittedOptions: [],
    feedback: null,
  }));
  r.showYourThinking = ADAPTED_SYT;
  return r;
}

// Canonical language, three choices: canonical text, one distractor omitted.
function canonicalThreeChoice(payload = canonicalPayload()) {
  const r = adaptedThreeChoice(payload);
  r.traits = { language: "canonical", choiceCount: 3 };
  r.directions = null;
  r.showYourThinking = null;
  r.items = r.items.map((it, i) => {
    const canonical = payload.items[i];
    const textById = new Map(canonical.options.map((o) => [o.optionId, o.text]));
    return {
      ...it,
      stem: canonical.stem,
      displayedOptions: it.displayedOptions.map((o) => ({ optionId: o.optionId, text: textById.get(o.optionId) })),
      feedback: null,
    };
  });
  return r;
}

function approvedReview(record, apId) {
  const applicable = AP.applicableCriteria(record);
  const criteria = {};
  for (const c of AP.REVIEW_CRITERIA) criteria[c] = { result: applicable.has(c) ? "pass" : "notApplicable", notes: "REVIEW-ONLY note" };
  return {
    schemaVersion: 1,
    assessmentPresentationRevisionId: apId,
    reviewer: { role: "scienceContentReviewer", reviewerId: "reviewer-fixture-001" },
    reviewedAt: "2026-09-28T12:00:00.000Z",
    determination: "approved",
    criteria,
    items: record.items.map((it) => ({ itemId: it.itemId, result: "pass", notes: "REVIEW-ONLY item note" })),
  };
}

// Temp repository root with the fixture payload, and helpers to retain a
// record and its review there.
function makeRepo(payload = canonicalPayload()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-render-"));
  fs.mkdirSync(AP.canonicalPayloadDir(root), { recursive: true });
  fs.writeFileSync(path.join(AP.canonicalPayloadDir(root), `${SLUG}.r1.json`), JSON.stringify(payload));
  return root;
}

function retain(root, record, { review = true, reviewMutate = null, fileName = null } = {}) {
  const apId = AP.assessmentPresentationRevisionIdFor(record);
  fs.mkdirSync(AP.retainedRecordDir(root), { recursive: true });
  fs.writeFileSync(path.join(AP.retainedRecordDir(root), fileName || `${apId}.json`), AP.serializeRecord(record));
  if (review) {
    const r = approvedReview(record, apId);
    if (reviewMutate) reviewMutate(r);
    fs.mkdirSync(AP.reviewDir(root), { recursive: true });
    fs.writeFileSync(path.join(AP.reviewDir(root), `${apId}.json`), JSON.stringify(r));
  }
  return apId;
}

module.exports = {
  SLUG,
  REVISION_ID,
  IDS,
  CANONICAL_DIRECTIONS,
  CANONICAL_MODEL,
  ADAPTED_SYT,
  quizLiteral,
  lessonHtml,
  canonicalPayload,
  adaptedThreeChoice,
  adaptedFourChoiceReordered,
  canonicalThreeChoice,
  approvedReview,
  makeRepo,
  retain,
};
