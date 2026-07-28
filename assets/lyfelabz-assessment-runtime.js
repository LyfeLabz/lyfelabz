/*
 * LyfeLabz Assessment Runtime - Canonical Shim
 *
 * Sprint 17 Slice 5. Contract defined in
 * docs/platform/SPRINT_17_IMPLEMENTATION_SPECIFICATION.md, Section 5.
 *
 * This file is the ONE canonical include added to every instructional
 * page in Sprint 17 Slice 1. It performs two jobs and nothing else:
 *
 *   1. Detects whether the current page was opened from the certified
 *      assignment launcher (assignment context) or as a standalone
 *      lesson (legacy practice mode). Detection is inferred from the
 *      launch parameters handed off by the launcher; nothing in the
 *      lesson body participates.
 *
 *   2. In assignment mode, lazy-loads the certified active runtime
 *      bundle (assets/lyfelabz-assessment-runtime-active.js). The
 *      bundle carries Firebase Auth, Firebase Functions, and the
 *      orchestrator that drives the certified session lifecycle
 *      (assessmentSessionsBegin, assessmentSessionsAutosave,
 *      assessmentAttemptsFinalize, assessmentAttemptGet).
 *
 * In standalone mode the shim is fully inert: no dynamic script
 * injection, no Firebase initialization, no network traffic beyond the
 * fetch of this file itself. Standalone lesson pages therefore pay only
 * the cost of a tiny script (this file); the ~334 KB active bundle
 * loads only on assignment-mode navigations.
 *
 * The shim installs a stable, no-op runtime object at
 * window.lyfelabz.assessmentRuntime so callers observe a consistent API
 * shape whether or not the active bundle is present. When the active
 * bundle finishes loading, it replaces the stub with the real runtime.
 *
 * Prohibitions (Section 5.2) apply from the first line: this file
 * contains no teacher dashboard logic, no lesson content, no scoring,
 * no direct Firestore writes, and no lesson-specific code.
 */
(function () {
  'use strict';

  if (typeof window !== 'undefined' && !window.__lyfelabzFirebaseConfig) {
    window.__lyfelabzFirebaseConfig = {
      apiKey: 'AIzaSyDIQrzMKo3CfSzTgVON3PtvxW2jFrDECzc',
      authDomain: 'lyfelabz-prod.firebaseapp.com',
      projectId: 'lyfelabz-prod',
      appId: '1:182791689935:web:047a9e33cc45b9567809ba',
      messagingSenderId: '182791689935',
      storageBucket: 'lyfelabz-prod.firebasestorage.app'
    };
  }

  // The shim advertises a distinct version identifier from the active
  // bundle. The active bundle's bootstrap gate replaces any runtime whose
  // version does not match its own compiled VERSION; if the shim shared
  // that string the gate would treat the inert placeholder as the real
  // runtime and never bootstrap, leaving lessonQuiz.finalize() resolving
  // to null and stranding students on "Submitting...". The '-shim'
  // suffix guarantees the strings never collide across coordinated
  // releases.
  var VERSION = '17.5.0-shim';
  var NAMESPACE = 'lyfelabz';
  var RUNTIME_KEY = 'assessmentRuntime';
  var LESSON_QUIZ_KEY = 'lessonQuiz';
  var ACTIVE_BUNDLE = '/assets/lyfelabz-assessment-runtime-active.js';
  var OPTION_LETTERS = ['A', 'B', 'C', 'D'];

  if (typeof window === 'undefined') return;

  // If anything is already installed - a prior shim load, or the active
  // runtime that replaced the shim - do not overwrite it. The shim only
  // ever installs an inert placeholder, so replacing a real runtime with
  // it would regress the page.
  var existing = window[NAMESPACE] && window[NAMESPACE][RUNTIME_KEY];
  if (existing) return;

  function detectAssignmentContext() {
    try {
      var search = (window.location && window.location.search) || '';
      if (search.indexOf('assignment=') !== -1) return true;

      var hash = (window.location && window.location.hash) || '';
      if (hash.indexOf('assignment=') !== -1) return true;

      var launch = window.__lyfelabzLaunch;
      if (launch && typeof launch === 'object' && launch.assignmentId) return true;
    } catch (_err) {
      return false;
    }
    return false;
  }

  function inertRejection() {
    return Promise.reject(new Error('assessment runtime is not yet available'));
  }

  var hasAssignmentContext = detectAssignmentContext();

  var runtime = {
    version: VERSION,
    mode: hasAssignmentContext ? 'pending' : 'inert',
    hasAssignmentContext: hasAssignmentContext,
    begin: function () { return Promise.resolve(); },
    autosave: function () { return Promise.resolve({ persisted: false }); },
    finalize: function () { return inertRejection(); },
    getAttempt: function () { return inertRejection(); }
  };

  // Shared lesson-quiz adapter. This is the reusable seam every Family A
  // lesson uses: instead of duplicating the index-to-response mapping
  // (`0 -> A, 1 -> B, ...`) and the hasAssignmentContext guard, lessons
  // call `autosave(indexSelections)` and `finalize(indexSelections)` with
  // their own selection array. In standalone practice mode both methods
  // resolve to `null` synchronously so lessons never need a try/catch.
  // The active runtime replaces this stub with the Firebase-backed
  // implementation the moment the active bundle loads.
  function mapIndexSelectionsToResponses(indexSelections) {
    if (!indexSelections || typeof indexSelections.length !== 'number') return [];
    var out = [];
    for (var qi = 0; qi < indexSelections.length; qi++) {
      var idx = indexSelections[qi];
      if (idx === null || idx === undefined) continue;
      if (typeof idx !== 'number' || idx < 0 || idx >= OPTION_LETTERS.length) continue;
      out.push({ itemId: 'q' + (qi + 1), response: OPTION_LETTERS[idx] });
    }
    return out;
  }
  // The shim installs a placeholder lessonQuiz. Once the active bundle
  // loads it replaces window.lyfelabz.lessonQuiz with the certified
  // helper. If a student clicks Submit before that replacement lands
  // (slow network, deferred script load), the old behavior resolved to
  // `null` immediately, which the lesson UI has no branch for and
  // therefore leaves the student stuck on "Submitting..." indefinitely.
  //
  // In assignment context the shim now waits for the active bundle to
  // install a real helper and then delegates. A bounded timeout produces
  // a truthful, actionable error result if the active bundle never
  // loads. In practice mode (no assignment context) autosave/finalize
  // continue to resolve to `null` so the lesson practice paths stay
  // byte-for-byte identical.
  var ACTIVE_WAIT_TIMEOUT_MS = 15000;
  var ACTIVE_WAIT_STEP_MS = 100;
  var shimHelper;

  function delegateWhenActive(methodName, callArgs) {
    return new Promise(function (resolve) {
      var elapsed = 0;
      function tick() {
        var current =
          (window[NAMESPACE] && window[NAMESPACE][LESSON_QUIZ_KEY]) || null;
        if (current && current !== shimHelper && typeof current[methodName] === 'function') {
          try {
            resolve(current[methodName].apply(current, callArgs));
          } catch (err) {
            resolve({
              ok: false,
              message: 'Submission service failed to start. Please refresh and try again.',
              recoverable: false
            });
          }
          return;
        }
        elapsed += ACTIVE_WAIT_STEP_MS;
        if (elapsed >= ACTIVE_WAIT_TIMEOUT_MS) {
          resolve({
            ok: false,
            message: "Your submission service didn't load. Please refresh and try again.",
            recoverable: true
          });
          return;
        }
        setTimeout(tick, ACTIVE_WAIT_STEP_MS);
      }
      tick();
    });
  }

  shimHelper = {
    version: VERSION,
    optionLetters: OPTION_LETTERS.slice(),
    hasAssignmentContext: function () { return hasAssignmentContext; },
    mapIndexSelectionsToResponses: mapIndexSelectionsToResponses,
    autosave: function () {
      if (!hasAssignmentContext) return Promise.resolve(null);
      return delegateWhenActive('autosave', arguments);
    },
    finalize: function () {
      if (!hasAssignmentContext) return Promise.resolve(null);
      return delegateWhenActive('finalize', arguments);
    }
  };
  var lessonQuiz = shimHelper;

  window[NAMESPACE] = window[NAMESPACE] || {};
  window[NAMESPACE][RUNTIME_KEY] = runtime;
  window[NAMESPACE][LESSON_QUIZ_KEY] = lessonQuiz;

  if (!hasAssignmentContext) return;

  try {
    var doc = window.document;
    if (!doc || !doc.createElement) return;
    var script = doc.createElement('script');
    script.src = ACTIVE_BUNDLE;
    script.defer = true;
    script.async = false;
    script.setAttribute('data-lyfelabz-runtime', 'active');
    var parent = doc.head || doc.body || doc.documentElement;
    if (parent && parent.appendChild) parent.appendChild(script);
  } catch (_err) {
    // A DOM failure here leaves the inert stub in place; the lesson
    // page still functions as a standalone instructional resource.
  }
})();
