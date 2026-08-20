/*
 * reproductive-success - declarative lesson build configuration.
 *
 * Sprint 28 Phase 5A migration. Generated from the committed root v1 artifact
 * onto the hardened v2 assignment-aware contract (markers + shared runtime
 * wiring). Instructional content is preserved and enforced by the
 * instructional-equivalence contract.
 */

"use strict";

const V1_NOTICE = `<!--
GENERATED FILE. DO NOT EDIT DIRECTLY.
Canonical source: lesson-sources/lesson_reproductive-success.html
Build target: v1
Regenerate: npm --prefix app run lessons:build -- --only=reproductive-success --target=v1
-->
`;

const V2_NOTICE = `<!--
GENERATED FILE. DO NOT EDIT DIRECTLY.
Canonical source: lesson-sources/lesson_reproductive-success.html
Build target: v2
Regenerate: npm --prefix app run lessons:build -- --only=reproductive-success --target=v2
-->
`;

module.exports = {
  slug: "reproductive-success",
  canonicalSource: "lesson-sources/lesson_reproductive-success.html",
  outputs: {
    v1: "lesson_reproductive-success.html",
    v2: "app/lessons/lesson_reproductive-success.html",
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
    "rs-teacher-select",
    "rs-block-select",
    "rs-student-name",
    "rs-err-name",
    "rs-err-teacher",
    "rs-err-block",
    "RS_ENDPOINT",
    "script.google.com",
    "rsSetQuizMode",
    "rsValidateStudentInfo",
    "rsQuizMode",
    "mr-kankel",
    "mr-rovner",
  ],
  v1RequiredSignatures: [
    "quiz-mode-toggle",
    "student-info-box",
    "RS_ENDPOINT",
    "script.google.com",
    "rsSetQuizMode",
    "rsValidateStudentInfo",
    "Practice Mode",
    "Classroom Mode",
  ],
  equivalenceExclusions: {
    // v1-only DOM ids inside the legacy classroom submission form.
    interactiveIds: [
      "rs-block-select",
      "rs-err-block",
      "rs-err-name",
      "rs-err-teacher",
      "rs-student-name",
      "rs-teacher-select",
    ],
    // v1-only scroll target used by the legacy classroom validation path.
    scrollTargets: ["student-info-box"],
  },
  sharedRequiredSignatures: [
    "<script defer src=\"/assets/lyfelabz-assessment-runtime.js\"></script>",
    "window.lyfelabz.lessonQuiz.autosave",
    "window.lyfelabz.lessonQuiz.finalize",
    "window.lyfelabz.lessonQuiz.hasAssignmentContext",
    "id=\"rs-quiz-questions\"",
    "id=\"rs-submit-btn\"",
    "id=\"rs-score\"",
    "id=\"rs-submit-status\"",
    "id=\"rs-thinking\"",
    "id=\"rs-think-model\"",
  ],
};
