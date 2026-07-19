/*
 * LyfeLabz Assessment Runtime
 *
 * Canonical, single integration point between instructional lesson pages and
 * the certified LyfeLabz assessment backend. Contract defined in
 * docs/platform/SPRINT_17_IMPLEMENTATION_SPECIFICATION.md, Section 5.
 *
 * Sprint 17 Slice 1 - Skeleton only.
 *
 * Responsibilities in this slice:
 *   1. Load safely on every instructional page.
 *   2. Detect whether the current page was opened from the certified
 *      assignment launcher (assignment context) or as a standalone lesson
 *      (legacy practice mode).
 *   3. Remain fully inert when no assignment context is detected: no network
 *      calls, no DOM mutations, no lesson behavior changes.
 *
 * Session begin, autosave, finalize, and results handling are intentionally
 * NOT implemented in this slice. They land in Slice 5 against the certified
 * callables (assessmentSessionsBegin, assessmentSessionsAutosave,
 * assessmentAttemptsFinalize, assessmentAttemptGet).
 *
 * Prohibitions (Section 5.2) apply from the first line: this file contains no
 * teacher dashboard logic, no lesson content, no scoring, no direct Firestore
 * writes, no lesson-specific code.
 */
(function () {
  'use strict';

  var VERSION = '17.1.0';
  var NAMESPACE = 'lyfelabz';
  var RUNTIME_KEY = 'assessmentRuntime';

  if (typeof window === 'undefined') return;

  var existing = window[NAMESPACE] && window[NAMESPACE][RUNTIME_KEY];
  if (existing && existing.version === VERSION) return;

  /**
   * Detect assignment context handed off by the certified assignment launcher.
   *
   * The launcher (Slice 4) will encode assignment id, session intent, and the
   * authenticated identity handle into a well-known launch parameter. In this
   * skeleton slice the detector only reports presence or absence; it does not
   * consume the payload.
   *
   * Detection is conservative: any ambiguity resolves to "no context", which
   * keeps the runtime inert and preserves legacy practice mode.
   */
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

  var runtime = {
    version: VERSION,
    mode: 'inert',
    hasAssignmentContext: false,
    /**
     * Reserved for Slice 5. Kept as an inert no-op so lesson pages can hold a
     * stable reference across future upgrades without conditional guards.
     */
    begin: function () {},
    autosave: function () {},
    finalize: function () {},
    getAttempt: function () {}
  };

  runtime.hasAssignmentContext = detectAssignmentContext();
  runtime.mode = runtime.hasAssignmentContext ? 'pending' : 'inert';

  window[NAMESPACE] = window[NAMESPACE] || {};
  window[NAMESPACE][RUNTIME_KEY] = runtime;
})();
