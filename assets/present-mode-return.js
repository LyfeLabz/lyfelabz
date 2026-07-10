/*
 * LyfeLabz Present Mode return script.
 *
 * Certified by docs/platform/PRESENT_MODE_ARCHITECTURE.md section 14.4
 * through 14.6 and docs/platform/PLATFORM_CONTRACTS.md sections 4, 5, 6, 8, 9.
 *
 * Behavior contract:
 *   - Always loads on the canonical instructional experience.
 *   - Immediately inspects sessionStorage under the certified key.
 *   - If the marker is absent, malformed, has an unsupported version,
 *     or names an unsupported returnSurface, the script no-ops and
 *     leaves the page untouched (safe failure).
 *   - Never reads Firebase Authentication, Firestore, or Functions.
 *   - Never renders teacher, class, or student identifiers.
 *   - When a valid marker is present, injects a single semantic button
 *     whose only capability is same-tab navigation back to the
 *     Teacher Workspace. On click, clears the marker and calls
 *     window.location.assign(target).
 *
 * The TypeScript reference implementation for this script lives at
 * app/src/presentMode/returnControl.ts and is verified against this
 * artifact by app/src/presentMode/returnControl.test.ts.
 */
(function () {
  var KEY = "lyfelabz.presentMode.returnContext";
  var LABEL = "Return to Teacher Workspace";
  var TESTID = "present-mode-return";
  var SURFACES = { curriculum: "/app/teacher" };
  var doc = document;

  function readMarker() {
    try {
      var raw = window.sessionStorage.getItem(KEY);
      if (raw === null || typeof raw !== "string") return null;
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        return null;
      }
      if (parsed === null || typeof parsed !== "object") return null;
      if (parsed.version !== 1) return null;
      if (typeof parsed.returnSurface !== "string") return null;
      if (!Object.prototype.hasOwnProperty.call(SURFACES, parsed.returnSurface))
        return null;
      return { version: 1, returnSurface: parsed.returnSurface };
    } catch (e) {
      return null;
    }
  }

  function clearMarker() {
    try {
      window.sessionStorage.removeItem(KEY);
    } catch (e) {
      // safe failure
    }
  }

  function inject(ctx) {
    var btn = doc.createElement("button");
    btn.type = "button";
    btn.textContent = LABEL;
    btn.setAttribute("data-testid", TESTID);
    btn.setAttribute("aria-label", LABEL);
    btn.className = "present-mode-return";
    var s = btn.style;
    s.position = "fixed";
    s.top = "12px";
    s.right = "12px";
    s.zIndex = "99999";
    s.padding = "10px 16px";
    s.borderRadius = "6px";
    s.border = "2px solid #222";
    s.background = "#fff";
    s.color = "#111";
    s.font = "600 14px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
    s.cursor = "pointer";
    s.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
    btn.addEventListener("click", function () {
      var target = SURFACES[ctx.returnSurface];
      clearMarker();
      window.location.assign(target);
    });
    doc.body.appendChild(btn);
    return btn;
  }

  function boot() {
    var ctx = readMarker();
    if (ctx === null) return;
    inject(ctx);
  }

  if (!doc.body) {
    doc.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
