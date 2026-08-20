/*
 * nature-of-waves - declarative lesson build configuration.
 *
 * Sprint 28 Phase 5A.1 migration. Generated from the committed root v1 artifact
 * onto the hardened v2 assignment-aware contract (markers + shared runtime
 * wiring). Instructional content is preserved and enforced by the
 * instructional-equivalence contract.
 *
 * nature-of-waves was deferred from the Phase 5A batch because two quiz diagram
 * questions embedded SVG authoring comments (`<!-- A: crest -->` and similar)
 * inside a <script> template literal, which the marker scanner categorically
 * rejects. Phase 5A.1 removed only those safe authoring-only comments from the
 * canonical source; the SVG geometry, labels, question text, options, correct
 * answers, and accessibility text are unchanged. The scanner was not weakened
 * and no scanner exception was added.
 */

"use strict";

const V1_NOTICE = `<!--
GENERATED FILE. DO NOT EDIT DIRECTLY.
Canonical source: lesson-sources/lesson_nature-of-waves.html
Build target: v1
Regenerate: npm --prefix app run lessons:build -- --only=nature-of-waves --target=v1
-->
`;

const V2_NOTICE = `<!--
GENERATED FILE. DO NOT EDIT DIRECTLY.
Canonical source: lesson-sources/lesson_nature-of-waves.html
Build target: v2
Regenerate: npm --prefix app run lessons:build -- --only=nature-of-waves --target=v2
-->
`;

module.exports = {
  slug: "nature-of-waves",
  canonicalSource: "lesson-sources/lesson_nature-of-waves.html",
  outputs: {
    v1: "lesson_nature-of-waves.html",
    v2: "app/lessons/lesson_nature-of-waves.html",
  },
  generatedNotice: { v1: V1_NOTICE, v2: V2_NOTICE },
  requiredLabels: {
    v1Only: [
      "legacy-mode-toggle-markup",
      "legacy-student-info-markup",
      "legacy-classroom-styles",
      "legacy-student-info-styles",
      "legacy-classroom-touchtarget",
      "legacy-endpoint",
      "legacy-mode-state",
      "legacy-set-quiz-mode",
      "legacy-mode-init-iife",
      "legacy-validate-student-info",
      "legacy-classroom-validation-guard",
      "legacy-practice-completion",
      "legacy-apps-script-submit",
      "o2-results-region-v1",
    ],
    v2Only: [
      "platform-standalone-completion",
      "o2-results-style",
      "o2-results-region-v2",
      "o2-results-focus",
      "o3-return-style",
      "o3-return-markup",
      "o3-return-reveal",
    ],
  },
  expectedContexts: {
    "legacy-mode-toggle-markup": "html",
    "legacy-student-info-markup": "html",
    "legacy-classroom-styles": "css",
    "legacy-student-info-styles": "css",
    "legacy-classroom-touchtarget": "css",
    "legacy-endpoint": "js",
    "legacy-mode-state": "js",
    "legacy-set-quiz-mode": "js",
    "legacy-mode-init-iife": "js",
    "legacy-validate-student-info": "js",
    "legacy-classroom-validation-guard": "js",
    "legacy-practice-completion": "js",
    "legacy-apps-script-submit": "js",
    "o2-results-region-v1": "html",
    "platform-standalone-completion": "js",
    "o2-results-style": "css",
    "o2-results-region-v2": "html",
    "o2-results-focus": "js",
    "o3-return-style": "css",
    "o3-return-markup": "html",
    "o3-return-reveal": "js",
  },
  v2ProhibitedSignatures: [
    "quiz-mode-toggle",
    "mode-btn",
    "student-info-box",
    "nw-teacher-select",
    "nw-block-select",
    "nw-student-name",
    "nw-err-name",
    "nw-err-teacher",
    "nw-err-block",
    "NW_ENDPOINT",
    "script.google.com",
    "nwSetQuizMode",
    "nwValidateStudentInfo",
    "nwQuizMode",
    "mr-brown",
    "ms-gay",
  ],
  v1RequiredSignatures: [
    "quiz-mode-toggle",
    "student-info-box",
    "NW_ENDPOINT",
    "script.google.com",
    "nwSetQuizMode",
    "nwValidateStudentInfo",
    "Practice Mode",
    "Classroom Mode",
  ],
  equivalenceExclusions: {
    // v1-only DOM ids inside the legacy classroom submission form.
    interactiveIds: [
      "nw-block-select",
      "nw-err-block",
      "nw-err-name",
      "nw-err-teacher",
      "nw-student-name",
      "nw-teacher-select",
    ],
    // v1-only scroll target used by the legacy classroom validation path.
    scrollTargets: ["student-info-box"],
  },
  sharedRequiredSignatures: [
    "<script defer src=\"/assets/lyfelabz-assessment-runtime.js\"></script>",
    "window.lyfelabz.lessonQuiz.autosave",
    "window.lyfelabz.lessonQuiz.finalize",
    "window.lyfelabz.lessonQuiz.hasAssignmentContext",
    "id=\"nw-quiz-questions\"",
    "id=\"nw-submit-btn\"",
    "id=\"nw-score\"",
    "id=\"nw-submit-status\"",
    "id=\"nw-thinking\"",
    "id=\"nw-think-model\"",
  ],
};
