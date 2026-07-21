/*
 * Earth's Layers - declarative lesson build configuration.
 *
 * Sprint 18 pilot lesson. Every path, label, signature, and expected
 * context is declared here. The generic builder engine reads this file;
 * no Earth's-Layers-specific string appears in the engine.
 */

"use strict";

const V1_NOTICE = `<!--
GENERATED FILE. DO NOT EDIT DIRECTLY.
Canonical source: lesson-sources/lesson_earths-layers.html
Build target: v1
Regenerate: npm --prefix app run lessons:build -- --only=earths-layers --target=v1
-->
`;

const V2_NOTICE = `<!--
GENERATED FILE. DO NOT EDIT DIRECTLY.
Canonical source: lesson-sources/lesson_earths-layers.html
Build target: v2
Regenerate: npm --prefix app run lessons:build -- --only=earths-layers --target=v2
-->
`;

module.exports = {
  slug: "earths-layers",
  canonicalSource: "lesson-sources/lesson_earths-layers.html",
  outputs: {
    v1: "lesson_earths-layers.html",
    v2: "app/lessons/lesson_earths-layers.html",
  },
  generatedNotice: { v1: V1_NOTICE, v2: V2_NOTICE },
  requiredLabels: {
    v1Only: [
      "legacy-mode-toggle-markup",
      "legacy-student-info-markup",
      "legacy-classroom-styles",
      "legacy-classroom-touchtarget",
      "legacy-endpoint",
      "legacy-mode-state",
      "legacy-set-quiz-mode",
      "legacy-mode-init-iife",
      "legacy-validate-student-info",
      "legacy-classroom-validation-guard",
      "legacy-practice-completion",
      "legacy-apps-script-submit",
    ],
    v2Only: [
      "platform-standalone-completion",
    ],
  },
  expectedContexts: {
    "legacy-mode-toggle-markup": "html",
    "legacy-student-info-markup": "html",
    "legacy-classroom-styles": "css",
    "legacy-classroom-touchtarget": "css",
    "legacy-endpoint": "js",
    "legacy-mode-state": "js",
    "legacy-set-quiz-mode": "js",
    "legacy-mode-init-iife": "js",
    "legacy-validate-student-info": "js",
    "legacy-classroom-validation-guard": "js",
    "legacy-practice-completion": "js",
    "legacy-apps-script-submit": "js",
    "platform-standalone-completion": "js",
  },
  v2ProhibitedSignatures: [
    "quiz-mode-toggle",
    "mode-btn",
    "student-info-box",
    "el-teacher-select",
    "el-block-select",
    "el-student-name",
    "el-err-name",
    "el-err-teacher",
    "el-err-block",
    "EL_ENDPOINT",
    "script.google.com",
    "elSetQuizMode",
    "elValidateStudentInfo",
    "elQuizMode",
    "mr-kankel",
    "mr-rovner",
    "Practice Mode",
    "Classroom Mode",
    "Practice mode - score not submitted",
  ],
  v1RequiredSignatures: [
    "quiz-mode-toggle",
    "student-info-box",
    "EL_ENDPOINT",
    "script.google.com",
    "elSetQuizMode",
    "elValidateStudentInfo",
    "Practice Mode",
    "Classroom Mode",
  ],
  equivalenceExclusions: {
    // v1-only DOM identifiers that live inside the legacy classroom
    // submission form. These are explicit, declared delivery-only
    // differences and are excluded from the instructional contract.
    interactiveIds: [
      "el-block-select",
      "el-err-block",
      "el-err-name",
      "el-err-teacher",
      "el-student-name",
      "el-teacher-select",
    ],
    // v1-only scroll target used by the legacy classroom validation
    // path. Excluded for the same reason.
    scrollTargets: ["student-info-box"],
  },
  // Lesson-specific pilot minimums. These are the sensible non-empty
  // assertions the Earth's Layers pilot must satisfy on every build.
  // They live here, not in the generic engine, so no other lesson is
  // constrained by Earth's Layers-specific expected counts.
  pilotContractMinimums: {
    vocabularyMin: 10,
    connectionsMin: 3,
    quizExactCount: 10,
    learningGoalsMin: 1,
    svgAccessibilityMin: 1,
    interactiveIdsMin: 8,
    requiredScrollTargets: ["el-score", "continue", "#quiz"],
    requiredScrollDestinations: [
      { function: "elSubmitQuiz", target: "el-score" },
      { function: "elSubmitQuiz", target: "continue" },
      { function: "elResetQuiz", target: "#quiz" },
    ],
  },
  sharedRequiredSignatures: [
    '<script defer src="/assets/lyfelabz-assessment-runtime.js"></script>',
    "window.lyfelabz.lessonQuiz.autosave",
    "window.lyfelabz.lessonQuiz.finalize",
    "window.lyfelabz.lessonQuiz.hasAssignmentContext",
    "var elQuizQuestions",
    'id="el-think"',
    'id="el-thinking"',
    'id="el-think-model"',
    'id="el-quiz-questions"',
    'id="el-submit-btn"',
    'id="el-score"',
    'id="el-submit-status"',
  ],
};
