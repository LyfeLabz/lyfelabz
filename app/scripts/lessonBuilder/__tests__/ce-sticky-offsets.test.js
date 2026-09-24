/**
 * @jest-environment jsdom
 */
/* eslint-disable */
"use strict";

/*
 * Conducting Experiments post-submit landing pilot.
 *
 * Root cause being guarded: the sticky quiz-progress tray was pinned at a
 * fixed `top: 64px` and the results board used fixed scroll offsets
 * (v2: 120px/104px; v1: none), while the real sticky nav wraps to about
 * 74px (Chromebook), 113px (tablet), and 125px (phone). The tray slid under
 * the nav and the score landed partly under the sticky chrome.
 *
 * The fix publishes the MEASURED nav and tray heights as CSS variables
 * (--ce-nav-h, --ce-progress-h) and derives both the tray `top` and the
 * `.score-board` scroll-margin-top from them, in v1 and v2 alike.
 *
 * jsdom has no layout engine, so the true viewport landing is verified in a
 * real browser. These tests pin the wiring: the CSS reads the variables, the
 * script writes them from the live elements and keeps them current, and the
 * submission confirmation sits directly under the score.
 */

const builder = require("../index.cjs");

const SLUG = "conducting-experiments";
const SCRIPT_START = "<!-- ===== STICKY QUIZ CHROME OFFSETS =====";

function build(target) {
  return builder.buildLesson({ slug: SLUG, target, write: false }).bytes;
}

function extractOffsetScript(html) {
  const at = html.indexOf(SCRIPT_START);
  expect(at).toBeGreaterThan(-1);
  const open = html.indexOf("<script>", at) + "<script>".length;
  const close = html.indexOf("</script>", open);
  return html.slice(open, close);
}

function mountChrome() {
  document.documentElement.removeAttribute("style");
  document.body.innerHTML =
    '<nav></nav><div class="quiz-progress-sticky"></div>';
  const nav = document.querySelector("nav");
  const tray = document.querySelector(".quiz-progress-sticky");
  const heights = new Map([[nav, 74], [tray, 49]]);
  for (const el of [nav, tray]) {
    Object.defineProperty(el, "offsetHeight", {
      configurable: true,
      get: () => heights.get(el),
    });
  }
  return { nav, tray, heights };
}

function cssVar(name) {
  return document.documentElement.style.getPropertyValue(name);
}

describe.each(["v1", "v2"])("Conducting Experiments sticky chrome (%s)", (target) => {
  let html;
  let script;

  beforeAll(() => {
    html = build(target);
    script = extractOffsetScript(html);
  });

  afterEach(() => {
    delete window.ResizeObserver;
  });

  test("progress tray docks under the measured nav, not a fixed 64px", () => {
    expect(html).toContain("top: var(--ce-nav-h, 64px);");
    expect(html).not.toMatch(/\.quiz-progress-sticky \{\s*position: sticky;\s*top: 64px;/);
  });

  test("results board clears the measured nav + tray with breathing room", () => {
    expect(html).toContain(
      "scroll-margin-top: calc(var(--ce-nav-h, 64px) + var(--ce-progress-h, 56px) + 1rem);",
    );
    // The landing still uses the existing offset-aware scrollIntoView.
    expect(html).toContain("sb.scrollIntoView({ behavior: 'smooth', block: 'start' });");
  });

  test("submission confirmation sits directly under the score message", () => {
    const board = html.slice(html.indexOf('id="ce-score"'));
    const msg = board.indexOf('<p id="ce-score-msg"></p>');
    const status = board.indexOf('<div id="ce-submit-status"></div>');
    const mystery = board.indexOf('<div class="mystery-loop">');
    expect(msg).toBeGreaterThan(-1);
    expect(status).toBeGreaterThan(msg);
    expect(mystery).toBeGreaterThan(status);
  });

  test("script publishes measured heights and follows a nav wrap (ResizeObserver)", () => {
    const { nav, tray, heights } = mountChrome();
    let onResize = null;
    const observed = [];
    window.ResizeObserver = class {
      constructor(cb) { onResize = cb; }
      observe(el) { observed.push(el); }
    };
    new Function(script)();

    expect(cssVar("--ce-nav-h")).toBe("74px");
    expect(cssVar("--ce-progress-h")).toBe("49px");
    expect(observed).toEqual([nav, tray]);

    // Narrow viewport: the nav wraps to two rows.
    heights.set(nav, 125);
    onResize([]);
    expect(cssVar("--ce-nav-h")).toBe("125px");
    expect(cssVar("--ce-progress-h")).toBe("49px");
  });

  test("script falls back to window resize when ResizeObserver is missing", () => {
    const { nav, heights } = mountChrome();
    new Function(script)();
    expect(cssVar("--ce-nav-h")).toBe("74px");
    heights.set(nav, 113);
    window.dispatchEvent(new Event("resize"));
    expect(cssVar("--ce-nav-h")).toBe("113px");
  });

  test("script is inert when the sticky chrome is absent", () => {
    document.documentElement.removeAttribute("style");
    document.body.innerHTML = "<main></main>";
    expect(() => new Function(script)()).not.toThrow();
    expect(cssVar("--ce-nav-h")).toBe("");
  });
});
