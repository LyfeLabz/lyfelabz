/*
 * LyfeLabz Assessment Runtime - Canonical Shim
 *
 * Sprint 17 Slice 5. Contract defined in
 * docs/platform/SPRINT_17_IMPLEMENTATION_SPECIFICATION.md, Section 5.
 *
 * This file is the ONE canonical include added to every instructional
 * page in Sprint 17 Slice 1. It performs three jobs and nothing else:
 *
 *   1. Detects whether the current page was opened from the certified
 *      assignment launcher (assignment context) or as a standalone
 *      lesson (legacy practice mode). Detection is inferred from the
 *      launch parameters handed off by the launcher; nothing in the
 *      lesson body participates.
 *
 *   2. In assignment mode, loads the shared host-aware Firebase client
 *      configuration, then lazy-loads the certified active runtime bundle
 *      (assets/lyfelabz-assessment-runtime-active.js). The bundle carries
 *      Firebase Auth, Firebase Functions, and the orchestrator that drives
 *      the certified session lifecycle (assessmentSessionsBegin,
 *      assessmentSessionsAutosave, assessmentAttemptsFinalize,
 *      assessmentAttemptGet).
 *
 *   3. On pages under /app/lessons/ only (the Policy E educational-delivery
 *      zone), prepares the target of an ordinary same-tab link to another
 *      /app/lessons/ page before the browser follows it. See
 *      installDeliveryNavigationPreparation below.
 *
 *   4. On the same pages, in student assignment delivery, turns the
 *      header's existing return link into "Back to My Science"
 *      (installStudentNavigation).
 *
 * In standalone mode the shim is otherwise inert: no dynamic script
 * injection, no Firebase initialization, no network traffic beyond the
 * fetch of this file itself and the job 3 request a student triggers by
 * following such a link. Standalone lesson pages therefore pay only
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
  var FIREBASE_CONFIG = '/assets/lyfelabz-firebase-config.js';
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

  // Policy E cache transition (docs/platform/SECURITY_BACKLOG_LAUNCH_URL_ANALYTICS.md).
  //
  // Policy E governs /app/lessons/** through Hosting response headers; the
  // lesson bytes and ETags did not change, and Firebase Hosting omits those
  // headers on 304 responses. A browser holding a copy of a page cached before
  // Policy E keeps reusing it without the Content-Security-Policy, so Google
  // Analytics would run there. The application prepares its own launches
  // (app/src/assignments/studentList/deliveryNavigation.ts); this covers the
  // ordinary links between delivery pages (Connections, companion pages, the
  // home link), whose HTML is immutable.
  //
  // For a plain same-tab click on a same-origin link to another /app/lessons/
  // page, the shim holds the navigation, requests the target once with
  //   GET, cache: 'reload', credentials: 'same-origin'
  // (an unconditional request whose full 200 response, carrying the current
  // headers, replaces the browser's cached copy), reads the body to the end,
  // and then follows the link's unchanged href. Preparation is best-effort: on
  // failure or after DELIVERY_PREPARE_TIMEOUT_MS the link is followed anyway.
  // Everything else keeps native behavior: links on other origins or outside
  // /app/lessons/, fragment links within the page, modified or non-primary
  // clicks, links with a target or download attribute, and any click a lesson
  // handler already handled. Pages outside /app/lessons/ (the public root
  // lessons) install nothing. Quiz controls are buttons, not links, and are
  // never touched.
  var DELIVERY_ZONE_PREFIX = '/app/lessons/';
  var DELIVERY_PREPARE_TIMEOUT_MS = 4000;

  function prepareDeliveryTarget(requestUrl) {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = null;
      function settle() {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        resolve();
      }
      timer = setTimeout(settle, DELIVERY_PREPARE_TIMEOUT_MS);
      try {
        window.fetch(requestUrl, {
          method: 'GET',
          cache: 'reload',
          credentials: 'same-origin',
          mode: 'same-origin',
          redirect: 'follow'
        }).then(function (response) {
          return response.arrayBuffer();
        }).then(settle, settle);
      } catch (_err) {
        settle();
      }
    });
  }

  function deliveryNavigationTarget(event, loc) {
    if (event.defaultPrevented) return null;
    if (event.button !== 0) return null;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
    var node = event.target;
    if (node && node.nodeType !== 1) node = node.parentNode;
    if (!node || typeof node.closest !== 'function') return null;
    var anchor = node.closest('a[href], area[href]');
    if (!anchor || typeof anchor.href !== 'string') return null;
    var targetAttr = anchor.getAttribute('target');
    if (targetAttr && targetAttr.toLowerCase() !== '_self') return null;
    if (anchor.hasAttribute('download')) return null;
    var href = anchor.href;
    var url;
    var here;
    try {
      url = new URL(href);
      here = new URL(loc.href);
    } catch (_err) {
      return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.origin !== here.origin) return null;
    if (url.pathname.indexOf(DELIVERY_ZONE_PREFIX) !== 0) return null;
    // A link to this same page with a fragment (including a bare '#') is a
    // same-document scroll, never a page load.
    if (href.indexOf('#') !== -1 && url.pathname === here.pathname && url.search === here.search) {
      return null;
    }
    url.hash = '';
    return { href: href, requestUrl: url.href };
  }

  function installDeliveryNavigationPreparation() {
    try {
      var loc = window.location;
      if (!loc || typeof loc.pathname !== 'string') return;
      if (loc.pathname.indexOf(DELIVERY_ZONE_PREFIX) !== 0) return;
      if (typeof window.fetch !== 'function' || typeof URL !== 'function') return;
      var doc = window.document;
      if (!doc || typeof doc.addEventListener !== 'function') return;
      var latest = 0;
      // Bubble phase on the document: every lesson handler on the link or
      // its ancestors runs first and may prevent the navigation itself.
      doc.addEventListener('click', function (event) {
        var target = deliveryNavigationTarget(event, loc);
        if (target === null) return;
        event.preventDefault();
        // Only the most recent click navigates, so a double click or a quick
        // second choice never produces two navigations.
        var token = ++latest;
        prepareDeliveryTarget(target.requestUrl).then(function () {
          if (token === latest) loc.assign(target.href);
        });
      }, false);
    } catch (_err) {
      // Leave native link behavior in place.
    }
  }

  installDeliveryNavigationPreparation();

  // Student navigation: Back to My Science in the lesson header.
  //
  // No control is added. In student assignment delivery the page's existing
  // header return link (nav a.nav-back, e.g. "Earth & Space") becomes the
  // student's global exit, "Back to My Science" -> /app/student. Every other
  // context keeps its normal header navigation.
  //
  // Applies only under /app/lessons/ (app-hosted content; the public root
  // lessons, catalog, and marketing pages never match) and never in Present
  // Mode. Then, by page:
  //
  //   - Assigned page (carries assignment context, e.g. #assignment=): the
  //     header return link becomes Back to My Science, and the LYFELABZ
  //     wordmark (which also leads to My Science through the app shell) goes
  //     through the same check. Leaving an UNFINISHED assignment asks first.
  //     The legacy post-submit "Back to My Assignments" link is hidden so the
  //     student has one exit.
  //   - Any other page in a tab the student launch put in assignment mode
  //     (sessionStorage lyfelabz.studentNav.v1 = "assignment"; see
  //     app/src/assignments/studentList/deliveryContext.ts), i.e. companion
  //     or connected pages reached from an assigned lesson: a header link to
  //     the catalog (which under /app/lessons/ is the application shell)
  //     becomes Back to My Science. A link to a parent lesson stays exactly as
  //     it is. Nothing is submittable on such a page, so it never warns.
  //   - Teacher Preview (fresh noopener tab), exploration, public visitors:
  //     unchanged.
  //
  // "Unfinished" comes from runtime state, not page text: the active bundle
  // reports finalizeStarted / finalizeSettled(ok) around lessonQuiz.finalize,
  // and only a successful finalize latches 'finalized'. A failed or refused
  // finalize returns to 'open'. Using the exit never begins, autosaves,
  // finalizes, or clears anything.
  var STUDENT_NAV_KEY = 'lyfelabz.studentNav.v1';
  var STUDENT_NAV_ASSIGNMENT = 'assignment';
  var PRESENT_MODE_KEY = 'lyfelabz.presentMode.returnContext';
  var MY_SCIENCE_PATH = '/app/student';
  var MY_SCIENCE_LABEL = 'Back to My Science';
  var APP_SHELL_PATHS = ['/app/lessons/index.html', '/app/lessons/', '/app/', '/app/index.html'];
  var NAV_STATE_KEY = 'deliveryNavigation';
  var navState = 'open';

  window[NAMESPACE][NAV_STATE_KEY] = {
    state: function () { return navState; },
    finalizeStarted: function () {
      if (navState === 'open') navState = 'submitting';
    },
    finalizeSettled: function (finalized) {
      if (finalized === true) navState = 'finalized';
      else if (navState === 'submitting') navState = 'open';
    }
  };

  function readSession(key) {
    try {
      return window.sessionStorage ? window.sessionStorage.getItem(key) : null;
    } catch (_err) {
      return null;
    }
  }

  // The leave warning (approved presentation) and the single-exit rule.
  var NAV_CSS =
    '#back-to-assignments{display:none!important}' +
    '.lyfelabz-leave-overlay{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;' +
    'justify-content:center;padding:16px;background:rgba(0,0,0,.65)}' +
    '.lyfelabz-leave-dialog{box-sizing:border-box;max-width:26rem;width:100%;padding:1.4rem;border-radius:14px;' +
    'background:#111820;color:#f0e4c8;border:1.5px solid rgba(159,184,204,.7);' +
    'font:600 1rem/1.5 Nunito,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
    '.lyfelabz-leave-dialog h2{margin:0 0 .5rem;font-size:1.2rem;font-weight:900}' +
    '.lyfelabz-leave-dialog p{margin:0 0 1.1rem}' +
    '.lyfelabz-leave-actions{display:flex;flex-wrap:wrap;gap:.6rem}' +
    '.lyfelabz-leave-actions button{min-height:44px;padding:0 1.1rem;border-radius:10px;cursor:pointer;' +
    'font-weight:800;font-size:.95rem;font-family:inherit;border:1.5px solid rgba(159,184,204,.7);' +
    'background:transparent;color:#f0e4c8}' +
    '.lyfelabz-leave-actions button.lyfelabz-leave-stay{background:#f5c842;border-color:#f5c842;color:#0a0e14}' +
    '.lyfelabz-leave-actions button:focus-visible{outline:3px solid #f5c842;outline-offset:2px}';

  function leaveCopy() {
    if (navState === 'submitting') {
      return {
        title: 'Still submitting',
        body: 'Your assignment is still being submitted. If you leave now, it might not be recorded.'
      };
    }
    return {
      title: 'Leave this assignment?',
      body: "You haven't submitted this assignment yet. If you leave now, your current work may not appear when you return."
    };
  }

  function showLeaveWarning(doc, opener, leave) {
    var copy = leaveCopy();
    var overlay = doc.createElement('div');
    overlay.className = 'lyfelabz-leave-overlay';
    overlay.setAttribute('data-testid', 'leave-warning');
    var dialog = doc.createElement('div');
    dialog.className = 'lyfelabz-leave-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'lyfelabz-leave-title');
    dialog.setAttribute('aria-describedby', 'lyfelabz-leave-body');
    var title = doc.createElement('h2');
    title.id = 'lyfelabz-leave-title';
    title.textContent = copy.title;
    var body = doc.createElement('p');
    body.id = 'lyfelabz-leave-body';
    body.textContent = copy.body;
    var actions = doc.createElement('div');
    actions.className = 'lyfelabz-leave-actions';
    var stay = doc.createElement('button');
    stay.type = 'button';
    stay.className = 'lyfelabz-leave-stay';
    stay.textContent = 'Stay';
    stay.setAttribute('data-testid', 'leave-stay');
    var go = doc.createElement('button');
    go.type = 'button';
    go.className = 'lyfelabz-leave-go';
    go.textContent = MY_SCIENCE_LABEL;
    go.setAttribute('data-testid', 'leave-confirm');
    actions.appendChild(stay);
    actions.appendChild(go);
    dialog.appendChild(title);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);

    function close() {
      doc.removeEventListener('keydown', onKey, true);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (opener && typeof opener.focus === 'function') opener.focus();
    }
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'Tab') {
        // Keep focus inside the two-button dialog.
        var active = doc.activeElement;
        if (event.shiftKey && active === stay) {
          event.preventDefault();
          go.focus();
        } else if (!event.shiftKey && active === go) {
          event.preventDefault();
          stay.focus();
        } else if (active !== stay && active !== go) {
          event.preventDefault();
          stay.focus();
        }
      }
    }
    stay.addEventListener('click', close);
    go.addEventListener('click', leave);
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) close();
    });
    doc.addEventListener('keydown', onKey, true);
    doc.body.appendChild(overlay);
    stay.focus();
  }

  // True when a header link leads to the catalog. Under /app/lessons/ that
  // target is the application shell (index.html), which shows a signed-in
  // student My Science anyway; a link to a lesson or other page is local
  // navigation and is never a catalog link.
  function isCatalogLink(anchor, loc) {
    try {
      var url = new URL(anchor.getAttribute('href'), loc.href);
      var here = new URL(loc.href);
      if (url.origin !== here.origin) return false;
      return APP_SHELL_PATHS.indexOf(url.pathname) !== -1;
    } catch (_err) {
      return false;
    }
  }

  // Leave for My Science, asking first only while this page holds an
  // unfinished assignment.
  function guardMyScienceExit(doc, loc, link) {
    link.addEventListener('click', function (event) {
      // Modified or non-primary clicks open elsewhere and leave this page in
      // place; native behavior.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!hasAssignmentContext || navState === 'finalized') return;
      event.preventDefault();
      if (doc.querySelector('.lyfelabz-leave-overlay')) return;
      showLeaveWarning(doc, link, function () { loc.assign(MY_SCIENCE_PATH); });
    });
  }

  function becomeMyScienceExit(doc, link) {
    while (link.firstChild) link.removeChild(link.firstChild);
    var arrow = doc.createElement('span');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '←';
    link.appendChild(arrow);
    link.appendChild(doc.createTextNode(MY_SCIENCE_LABEL));
    link.setAttribute('href', MY_SCIENCE_PATH);
    link.setAttribute('data-testid', 'back-to-my-science');
  }

  function installStudentNavigation() {
    try {
      var loc = window.location;
      if (!loc || typeof loc.pathname !== 'string' || typeof loc.href !== 'string') return;
      if (loc.pathname.indexOf(DELIVERY_ZONE_PREFIX) !== 0) return;
      if (readSession(PRESENT_MODE_KEY) !== null) return;
      var assignmentTab = readSession(STUDENT_NAV_KEY) === STUDENT_NAV_ASSIGNMENT;
      if (!hasAssignmentContext && !assignmentTab) return;
      var doc = window.document;
      if (!doc || typeof doc.querySelector !== 'function') return;

      function apply() {
        var back = doc.querySelector('nav a.nav-back');
        if (!back || back.getAttribute('data-testid') === 'back-to-my-science') return false;
        if (hasAssignmentContext) {
          var style = doc.createElement('style');
          style.id = 'lyfelabz-student-nav-style';
          style.textContent = NAV_CSS;
          (doc.head || doc.body).appendChild(style);
          becomeMyScienceExit(doc, back);
          guardMyScienceExit(doc, loc, back);
          var logo = doc.querySelector('nav a.nav-logo');
          if (logo) {
            logo.setAttribute('href', MY_SCIENCE_PATH);
            guardMyScienceExit(doc, loc, logo);
          }
        } else if (isCatalogLink(back, loc)) {
          becomeMyScienceExit(doc, back);
        }
        return true;
      }

      // The shim loads with defer, so the header is normally parsed already.
      if (!apply() && doc.readyState === 'loading' && typeof doc.addEventListener === 'function') {
        doc.addEventListener('DOMContentLoaded', apply);
      }
    } catch (_err) {
      // Never let navigation chrome break the lesson.
    }
  }

  installStudentNavigation();

  // Quiz session continuity: keep the launch context on the URL across
  // in-page navigation. The launcher hands the assignment context over in the
  // URL FRAGMENT (`#assignment=<id>[&launchRef=<ref>]`). Following any
  // ordinary in-page link (sticky nav "Quiz" is `href="#quiz"`, the skip link
  // is `#main`) REPLACES the whole fragment, so a later reload of `...#quiz`
  // carried no assignment context and booted as a standalone lesson: no
  // session, no restored answers, and answers not saved. When a same-document
  // navigation drops the launch parameters this re-attaches the ORIGINAL ones
  // to the current history entry (`#quiz&assignment=<id>`; the runtime reads
  // the fragment as URL parameters). It never navigates, never scrolls, and
  // never touches a page that was not launched with fragment context
  // (standalone, practice, or a legacy query-form launch whose query already
  // survives in-page links). The fragment never reaches the server.
  function installLaunchContextPreservation() {
    try {
      var loc = window.location;
      var hist = window.history;
      if (!loc || !hist || typeof hist.replaceState !== 'function') return;
      if (typeof window.addEventListener !== 'function') return;
      var launchHash = (loc.hash || '').replace(/^#/, '');
      var launchParams = [];
      var parts = launchHash.split('&');
      for (var i = 0; i < parts.length; i++) {
        var key = parts[i].split('=')[0];
        if (key === 'assignment' || key === 'launchRef') launchParams.push(parts[i]);
      }
      var hasFragmentAssignment = false;
      for (var j = 0; j < launchParams.length; j++) {
        if (launchParams[j].split('=')[0] === 'assignment') hasFragmentAssignment = true;
      }
      if (!hasFragmentAssignment) return;

      window.addEventListener('hashchange', function () {
        try {
          var current = (loc.hash || '').replace(/^#/, '');
          var present = {};
          var currentParts = current.length > 0 ? current.split('&') : [];
          for (var k = 0; k < currentParts.length; k++) {
            present[currentParts[k].split('=')[0]] = true;
          }
          var missing = [];
          for (var m = 0; m < launchParams.length; m++) {
            if (!present[launchParams[m].split('=')[0]]) missing.push(launchParams[m]);
          }
          if (missing.length === 0) return;
          var restored = current.length > 0 ? current + '&' + missing.join('&') : missing.join('&');
          hist.replaceState(hist.state, '', loc.pathname + loc.search + '#' + restored);
        } catch (_err) {
          // Never let launch-context upkeep break in-page navigation.
        }
      });
    } catch (_err) {
      // Never let launch-context upkeep break the lesson.
    }
  }

  if (hasAssignmentContext) installLaunchContextPreservation();

  if (!hasAssignmentContext) return;

  try {
    var doc = window.document;
    if (!doc || !doc.createElement) return;
    var parent = doc.head || doc.body || doc.documentElement;
    if (!parent || !parent.appendChild) return;

    function loadActiveBundle() {
      var script = doc.createElement('script');
      script.src = ACTIVE_BUNDLE;
      script.defer = true;
      script.async = false;
      script.setAttribute('data-lyfelabz-runtime', 'active');
      parent.appendChild(script);
    }

    function hasUsableFirebaseConfig() {
      try {
        var config = window.__lyfelabzFirebaseConfig;
        return !!config &&
          typeof config === 'object' &&
          typeof config.apiKey === 'string' && config.apiKey.length > 0 &&
          typeof config.authDomain === 'string' && config.authDomain.length > 0 &&
          typeof config.projectId === 'string' && config.projectId.length > 0;
      } catch (_err) {
        return false;
      }
    }

    function loadActiveBundleIfConfigured() {
      if (hasUsableFirebaseConfig()) loadActiveBundle();
    }

    // The authenticated shell and lesson runtime share one authoritative
    // environment selector. Lesson pages are fresh documents, so when the
    // shell's injected global is absent or unusable, load that same selector
    // and wait for it before allowing the active bundle to initialize Firebase.
    // The load event is not sufficient by itself: if selector execution failed
    // without installing a usable configuration, leave the stub in place and
    // fail closed. An already installed valid configuration is preserved.
    if (!hasUsableFirebaseConfig()) {
      var configScript = doc.createElement('script');
      configScript.src = FIREBASE_CONFIG;
      configScript.async = false;
      configScript.onload = loadActiveBundleIfConfigured;
      configScript.setAttribute('data-lyfelabz-runtime', 'firebase-config');
      parent.appendChild(configScript);
      return;
    }

    loadActiveBundle();
  } catch (_err) {
    // A DOM failure here leaves the inert stub in place; the lesson
    // page still functions as a standalone instructional resource.
  }
})();
