/**
 * @jest-environment jsdom
 */
/* eslint-disable */
"use strict";

/*
 * Quiz Results Polish - reference implementation contract.
 *
 * The rollout template for two confirmed quiz-results defects, proven first
 * on one ordinary lesson (photosynthesis) before any mechanical rollout:
 *
 * 1. Post-submit landing. The sticky quiz-progress tray was pinned at a fixed
 *    `top: 64px` (52px on phones via #mobile-canonical) and the results board
 *    used fixed scroll offsets (v2: 120px/104px; v1: none), while the real
 *    sticky nav wraps to about 74px (Chromebook) and 118-122px (tablet,
 *    phone). The tray hid behind the nav and the score landed under it. The
 *    fix publishes the MEASURED nav and tray heights (--quiz-nav-h,
 *    --quiz-progress-h) from #quiz-chrome-offsets-js and derives the tray
 *    `top` and the `.score-board` scroll-margin-top from them, in a
 *    #quiz-chrome-offsets style block placed after the untouched
 *    #mobile-canonical block.
 *
 * 2. Refused submission. The lesson renders the locally calculated score
 *    before finalize settles. When finalize resolves `ok:false`, resolves
 *    null / an invalid result, or rejects, the board now reads
 *    "Score not recorded" with the reason directly beneath it. Success is
 *    unchanged. Scoring, the finalize payload, and fail-closed runtime
 *    behavior are not touched.
 *
 * jsdom has no layout engine: the true viewport landing at 1280/820/375px is
 * certified in a real browser. These tests pin the wiring and run the
 * lesson's REAL built quiz script against its REAL built markup with a
 * stubbed window.lyfelabz.lessonQuiz adapter.
 *
 * To roll the transformation out, add a lesson here (and mark it
 * `offset: "measured", offsetVars: "quiz"` in w2-results-contract.test.js).
 */

const builder = require("../index.cjs");

const QUIZ_RESULTS_REFERENCE_LESSONS = [{ slug: "photosynthesis", prefix: "el" }];

// A lesson that has not received the transformation. Its #mobile-canonical
// block is the repository-wide canonical copy the reference must not alter.
const CANONICAL_BLOCK_SOURCE_SLUG = "energy-flow";

const NOT_RECORDED = "Score not recorded";

function build(slug, target) {
  return builder.buildLesson({ slug, target, write: false }).bytes;
}

function blockById(html, tag, id) {
  const open = html.indexOf(`<${tag} id="${id}">`);
  if (open < 0) return null;
  const close = html.indexOf(`</${tag}>`, open);
  return html.slice(open, close + tag.length + 3);
}

function scriptBody(html, id) {
  const block = blockById(html, "script", id);
  expect(block).not.toBeNull();
  return block.slice(block.indexOf(">") + 1, block.lastIndexOf("</script>"));
}

function bodyMarkup(html) {
  const open = html.indexOf("<body>");
  const close = html.lastIndexOf("</body>");
  return html.slice(open + "<body>".length, close);
}

function quizScript(html, prefix) {
  const start = html.indexOf(`var ${prefix}QuizState`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</script>", start));
}

function cssVar(name) {
  return document.documentElement.style.getPropertyValue(name);
}

describe.each(QUIZ_RESULTS_REFERENCE_LESSONS)("quiz results reference: $slug", ({ slug, prefix }) => {
  const P = prefix;

  describe.each(["v1", "v2"])("A. measured post-submit geometry (%s)", (target) => {
    let html;
    beforeAll(() => {
      html = build(slug, target);
    });
    afterEach(() => {
      delete window.ResizeObserver;
      document.documentElement.removeAttribute("style");
      document.body.innerHTML = "";
    });

    test("no fixed nav-height assumption remains for the tray or the landing", () => {
      expect(html).not.toMatch(/\.quiz-progress-sticky \{\s*position: sticky;\s*top: 64px;/);
      expect(html).not.toContain("scroll-margin-top: 120px");
      expect(html).not.toContain("scroll-margin-top: 104px");
    });

    test("the tray docks under the MEASURED nav, with padding on every side", () => {
      const css = blockById(html, "style", "quiz-chrome-offsets");
      expect(css).not.toBeNull();
      expect(css).toContain("top: var(--quiz-nav-h, 64px);");
      expect(css).toContain("padding: 0.6rem 1.1rem;");
      // Phone keeps the canonical 52px only as the no-JS fallback.
      expect(css).toMatch(/@media \(max-width: 600px\) \{\s*\.quiz-progress-sticky \{ top: var\(--quiz-nav-h, 52px\); \}/);
    });

    test("the results board lands below the measured nav + tray with breathing room", () => {
      const css = blockById(html, "style", "quiz-chrome-offsets");
      expect(css).toContain(
        "scroll-margin-top: calc(var(--quiz-nav-h, 64px) + var(--quiz-progress-h, 56px) + 1rem);",
      );
      // The landing still uses the existing offset-aware scrollIntoView.
      expect(html).toContain("sb.scrollIntoView({ behavior: 'smooth', block: 'start' });");
    });

    test("the geometry block follows an UNCHANGED #mobile-canonical, so it wins the cascade", () => {
      const canonical = blockById(html, "style", "mobile-canonical");
      const reference = blockById(build(CANONICAL_BLOCK_SOURCE_SLUG, target), "style", "mobile-canonical");
      expect(canonical).toBe(reference);
      // The canonical menu-open rule still lifts the tray out of flow.
      expect(canonical).toContain("body:has(nav.menu-open) .quiz-progress-sticky { position: static; }");
      expect(html.indexOf('<style id="quiz-chrome-offsets">')).toBeGreaterThan(
        html.indexOf('<style id="mobile-canonical">'),
      );
    });

    test("the submission status sits directly under the score message", () => {
      const board = html.slice(html.indexOf(`id="${P}-score"`));
      const msg = board.indexOf(`<p id="${P}-score-msg"></p>`);
      const status = board.indexOf(`<div id="${P}-submit-status"></div>`);
      const mystery = board.indexOf('<div class="mystery-loop">');
      expect(msg).toBeGreaterThan(-1);
      expect(status).toBeGreaterThan(msg);
      expect(mystery).toBeGreaterThan(status);
      expect(board.split(`id="${P}-submit-status"`).length - 1).toBe(1);
    });

    // Desktop (Chromebook), tablet, and phone nav heights measured in a real
    // browser for this lesson family. The script must follow each wrap.
    test.each([
      ["desktop", 74],
      ["tablet", 122],
      ["phone", 118],
    ])("the script publishes the measured %s nav (%ipx) and follows a wrap", (_label, navHeight) => {
      document.body.innerHTML = '<nav></nav><div class="quiz-progress-sticky"></div>';
      const nav = document.querySelector("nav");
      const tray = document.querySelector(".quiz-progress-sticky");
      const heights = new Map([[nav, 64], [tray, 46]]);
      for (const el of [nav, tray]) {
        Object.defineProperty(el, "offsetHeight", { configurable: true, get: () => heights.get(el) });
      }
      let onResize = null;
      const observed = [];
      window.ResizeObserver = class {
        constructor(cb) { onResize = cb; }
        observe(el) { observed.push(el); }
      };
      new Function(scriptBody(html, "quiz-chrome-offsets-js"))();
      expect(cssVar("--quiz-nav-h")).toBe("64px");
      expect(cssVar("--quiz-progress-h")).toBe("46px");
      expect(observed).toEqual([nav, tray]);

      heights.set(nav, navHeight);
      heights.set(tray, 49);
      onResize([]);
      expect(cssVar("--quiz-nav-h")).toBe(`${navHeight}px`);
      expect(cssVar("--quiz-progress-h")).toBe("49px");
    });

    test("the script falls back to window resize without ResizeObserver", () => {
      document.body.innerHTML = '<nav></nav><div class="quiz-progress-sticky"></div>';
      const nav = document.querySelector("nav");
      let h = 74;
      Object.defineProperty(nav, "offsetHeight", { configurable: true, get: () => h });
      new Function(scriptBody(html, "quiz-chrome-offsets-js"))();
      expect(cssVar("--quiz-nav-h")).toBe("74px");
      h = 122;
      window.dispatchEvent(new Event("resize"));
      expect(cssVar("--quiz-nav-h")).toBe("122px");
    });

    test("the script is inert when the sticky chrome is absent", () => {
      document.body.innerHTML = "<main></main>";
      expect(() => new Function(scriptBody(html, "quiz-chrome-offsets-js"))()).not.toThrow();
      expect(cssVar("--quiz-nav-h")).toBe("");
    });
  });

  describe("B-D. submission result presentation (v2, assignment context)", () => {
    let html;
    let scrolled;
    let finalizeCalls;

    beforeAll(() => {
      html = build(slug, "v2");
    });

    function mount(finalizeImpl) {
      scrolled = [];
      finalizeCalls = [];
      Element.prototype.scrollIntoView = function () {
        scrolled.push(this.id || this.className);
      };
      document.body.innerHTML = bodyMarkup(html);
      window.lyfelabz = {
        lessonQuiz: {
          hasAssignmentContext: () => true,
          autosave: async () => null,
          finalize: (selected, options) => {
            finalizeCalls.push({ selected: [...selected], options });
            return finalizeImpl();
          },
        },
      };
      new Function(
        quizScript(html, P) +
          `\nwindow.__q={select:${P}SelectAnswer,submit:${P}SubmitQuiz,reset:${P}ResetQuiz,state:${P}QuizState,questions:${P}QuizQuestions};`,
      )();
    }

    // Answers `correctCount` questions correctly (the first N), the rest wrong.
    function answerAndSubmit(correctCount) {
      const q = window.__q;
      q.questions.forEach((item, qi) => {
        q.select(qi, qi < correctCount ? item.correct : (item.correct + 1) % item.options.length);
      });
      document.getElementById(`${P}-thinking`).value = "Plants build glucose from carbon dioxide and water using light.";
      q.submit();
      return q.questions.length;
    }

    async function settle() {
      for (let i = 0; i < 50; i++) await Promise.resolve();
    }

    const el = (id) => document.getElementById(id);

    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
      delete window.lyfelabz;
      delete window.__q;
      document.body.innerHTML = "";
    });

    function expectFinalizePayload(total) {
      // D. The scored payload is exactly the index selections plus the written
      // response, sent once: no retry, no alteration.
      expect(finalizeCalls).toHaveLength(1);
      expect(finalizeCalls[0].selected).toHaveLength(total);
      expect(finalizeCalls[0].selected).toEqual(window.__q.state.selected);
      expect(finalizeCalls[0].options).toEqual({
        writtenResponse: "Plants build glucose from carbon dioxide and water using light.",
      });
    }

    test("B. successful finalize keeps the normal score, message, and confirmation", async () => {
      mount(async () => ({ ok: true, result: { attemptId: "a1" } }));
      const total = answerAndSubmit(7);
      // Local scoring is unchanged while the submission is in flight.
      expect(el(`${P}-score-num`).textContent).toBe(`7/${total}`);
      expect(el(`${P}-submit-status`).textContent).toContain("Submitting...");
      await settle();
      expect(el(`${P}-score-num`).textContent).toBe(`7/${total}`);
      expect(el(`${P}-score-msg`).textContent).toContain("Solid effort");
      expect(el(`${P}-submit-status`).textContent).toContain("Submitted to your teacher");
      expect(el(`${P}-score`).classList.contains("show")).toBe(true);
      expect(el(`${P}-score`).classList.contains("score-not-recorded")).toBe(false);
      expect(el("back-to-assignments").classList.contains("show")).toBe(true);
      expect(el(`${P}-think-model`).classList.contains("show")).toBe(true);
      expect(el(`${P}-thinking`).disabled).toBe(true);
      expect(scrolled).toEqual([`${P}-score`]);
      expectFinalizePayload(total);
    });

    test("B. a perfect successful submission still moves on to More Learning", async () => {
      mount(async () => ({ ok: true, result: { attemptId: "a1" } }));
      const total = answerAndSubmit(10);
      await settle();
      expect(el(`${P}-score-num`).textContent).toBe(`${total}/${total}`);
      jest.advanceTimersByTime(1900);
      expect(scrolled).toEqual([`${P}-score`, "continue"]);
      expect(window.__q.state.continueTimer).toBeNull();
    });

    const FAILURES = [
      ["finalize resolves ok:false", () => Promise.resolve({ ok: false, message: "This assignment needs to be opened again, so your answers were not submitted.", recoverable: false }), "This assignment needs to be opened again"],
      ["finalize resolves null", () => Promise.resolve(null), "Submission did not complete"],
      ["finalize resolves an invalid result", () => Promise.resolve({}), "Submission did not complete"],
      ["finalize rejects", () => Promise.reject(new Error("network")), "Submission did not complete"],
    ];

    test.each(FAILURES)("C. %s: 'Score not recorded' leads, with the reason beneath it", async (_label, impl, reason) => {
      mount(impl);
      const total = answerAndSubmit(3);
      await settle();
      const board = el(`${P}-score`);
      const status = el(`${P}-submit-status`);
      // The prominent result says nothing was recorded (text, not color).
      expect(board.classList.contains("score-not-recorded")).toBe(true);
      expect(el(`${P}-score-num`).textContent).toBe(NOT_RECORDED);
      // The locally calculated score is not presented as a result, and no
      // zero is claimed.
      expect(board.textContent).not.toContain(`3/${total}`);
      expect(board.textContent).not.toMatch(/\b0\/\d+/);
      expect(el(`${P}-score-msg`).textContent).toContain("Your teacher did not receive this attempt.");
      // The explanatory reason is kept and sits directly under the headline
      // area, inside the results region.
      expect(status.textContent).toContain("Could not submit:");
      expect(status.textContent).toContain(reason);
      expect(board.contains(status)).toBe(true);
      expect(status.previousElementSibling.id).toBe(`${P}-score-msg`);
      // No successful-attempt UI.
      expect(board.textContent).not.toContain("Submitted to your teacher");
      expect(status.querySelector(".score-submitted")).toBeNull();
      // Per-question feedback and Show Your Thinking are untouched.
      expect(document.querySelectorAll(".option-feedback.correct-fb, .option-feedback.incorrect-fb")).toHaveLength(total);
      expect(el(`${P}-think-model`).classList.contains("show")).toBe(true);
      expect(el(`${P}-thinking`).disabled).toBe(true);
      // The recovery route back to My Assignments stays available.
      expect(el("back-to-assignments").classList.contains("show")).toBe(true);
      expectFinalizePayload(total);
      jest.advanceTimersByTime(5000);
      expect(finalizeCalls).toHaveLength(1);
    });

    test("C. a refused perfect submission cancels the pending jump to More", async () => {
      mount(() => Promise.resolve({ ok: false, message: "Refused.", recoverable: false }));
      answerAndSubmit(10);
      await settle();
      jest.advanceTimersByTime(5000);
      expect(el(`${P}-score-num`).textContent).toBe(NOT_RECORDED);
      expect(scrolled).toEqual([`${P}-score`]);
    });

    test("C. a refusal that arrives after the jump to More brings the result back", async () => {
      let reject;
      mount(() => new Promise((_resolve, rej) => { reject = rej; }));
      answerAndSubmit(10);
      jest.advanceTimersByTime(1900);
      expect(scrolled).toEqual([`${P}-score`, "continue"]);
      reject(new Error("late"));
      await settle();
      expect(el(`${P}-score-num`).textContent).toBe(NOT_RECORDED);
      expect(scrolled).toEqual([`${P}-score`, "continue", `${P}-score`]);
    });

    test("C. Try Again clears the not-recorded state", async () => {
      mount(() => Promise.resolve(null));
      answerAndSubmit(3);
      await settle();
      window.__q.reset();
      expect(el(`${P}-score`).classList.contains("score-not-recorded")).toBe(false);
      expect(el(`${P}-score`).classList.contains("show")).toBe(false);
      expect(el(`${P}-submit-status`).innerHTML).toBe("");
    });
  });
});
